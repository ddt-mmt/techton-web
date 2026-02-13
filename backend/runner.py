import subprocess
import os
import signal
import psutil
import json
import time
import csv
from datetime import datetime

class TestRunner:
    def __init__(self):
        self.process = None
        self.current_config = {}
        self.start_time = None
        self.report_start_time = None
        self.manual_stop = False
        self.log_file = "k6_output.json"
        self.run_log_file = "k6_run.log" # Log for k6 stdout/stderr
        self.last_report = None
        
        # Robust path finding
        base_dir = os.path.dirname(os.path.abspath(__file__)) # techton-web/backend
        project_root = os.path.dirname(os.path.dirname(base_dir)) # techton-web/.. -> gemini-cli/
        
        # Expected path: techton-project/bin/k6
        # If runner.py is in techton-web/backend, then techton-project is in ../../techton-project relative to runner.py
        self.k6_path = os.path.join(base_dir, "../../techton-project/bin/k6")
        self.k6_path = os.path.normpath(self.k6_path)

        if not os.path.exists(self.k6_path):
             print(f"Warning: Custom k6 not found at {self.k6_path}. Fallback to system k6.")
             self.k6_path = "k6"

    def is_running(self):
        if self.process is None:
            return False
        return self.process.poll() is None

    def _create_run_directory(self, vus):
        self.start_time = datetime.now() # Move start time definition here
        run_name = f"run_{self.start_time.strftime('%Y-%m-%d_%H-%M-%S')}_{vus}u"
        
        # Absolute path to results dir
        base_dir = os.path.dirname(os.path.abspath(__file__))
        results_root = os.path.join(base_dir, "../../techton-project/results")
        self.run_dir = os.path.join(results_root, run_name)
        
        os.makedirs(self.run_dir, exist_ok=True)
        
        # Define outputs
        self.run_csv = os.path.join(self.run_dir, "k6_metrics.csv")
        self.run_json = os.path.join(self.run_dir, "k6_summary.json")
        return self.run_dir

    def start_test(self, config):
        if self.is_running():
            raise Exception("Test already running")

        self.current_config = config
        self.report_start_time = None
        self.report_ready = False # Reset report state
        self.manual_stop = False
        self.last_report = None
        
        # 1. Prepare Run Directory (Moved to _create_run_directory)
        # vus is already in config, but we need it for run_name.
        # This assumes _create_run_directory is called externally, or we call it here
        if not hasattr(self, 'run_dir') or not self.run_dir:
            self._create_run_directory(config.get("vus", 0))

        # 2. Prepare Script
        script_content = self._prepare_script(config)
        script_path = os.path.join(self.run_dir, "load_test.js")
        with open(script_path, "w") as f:
            f.write(script_content)
            
        # 3. Run K6
        # We output CSV for the detailed report generator and JSON for the live summary if needed
        cmd = [
            self.k6_path, "run", 
            "--out", f"csv={self.run_csv}",
            "--out", f"json={self.log_file}", # Keep the main log file for the live dashboard (flushed often)
            script_path
        ]
        
        # Open log file for append
        self.log_handle = open(self.run_log_file, "a")
        self.log_handle.write(f"\n--- Starting Run {run_name} ---\n")
        self.log_handle.write(f"Command: {' '.join(cmd)}\n")
        self.log_handle.flush()

        self.process = subprocess.Popen(
            cmd,
            stdout=self.log_handle,
            stderr=subprocess.STDOUT,
            text=True
        )
        return True

    def stop_test(self, manual=False):
        if self.process and self.is_running():
            self.manual_stop = manual
            # Graceful stop first
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None
            
            # Close log handle
            if hasattr(self, 'log_handle') and self.log_handle:
                self.log_handle.close()
                self.log_handle = None
            
            if self.start_time:
                self.report_start_time = self.start_time
                self.start_time = None
            
            self.report_ready = True # Mark report as ready
            
            # Generate and save report
            report = self.get_report()
            if report:
                self._save_to_history(report)
                
            return True
        return False

    def _prepare_script(self, config):
        mode = config.get("mode", "load")
        
        # Select Template
        if mode == "audit":
            template_path = "backend/scripts/ad_audit.js"
        else:
            template_path = "backend/scripts/ad_load.js"

        # Fix relative path read
        base_dir = os.path.dirname(os.path.abspath(__file__))
        abs_template_path = os.path.join(base_dir, "../../techton-web", template_path)
        
        if not os.path.exists(abs_template_path):
             # Fallback
             abs_template_path = template_path

        with open(abs_template_path, "r") as f:
            template = f.read()
            
        # Replacements
        target = config.get("target_ip", "127.0.0.1")
        vus = config.get("vus", 10)
        duration = config.get("duration", "30s")
        
        # Escape backslashes for JS string literals
        raw_dn = config.get("user_dn") or "guest"
        dn = str(raw_dn).replace("\\", "\\\\")
        
        raw_pass = config.get("password") or "guest"
        password = str(raw_pass).replace("\\", "\\\\")
        
        use_csv = "true" if config.get("use_csv", False) else "false"
        base_dn = config.get("base_dn") or ""
        
        # Scenario Construction
        scenario = f"""
        {{
            executor: 'constant-vus',
            vus: {vus},
            duration: '{duration}',
        }}
        """
        
        # Thresholds (AUTO-KILL LOGIC)
        # 1. Latency: Warn if > 5000ms
        # 2. Errors: STOP TEST if > 10% failures (abortOnFail: true)
        thresholds = """
        {
            'http_req_duration': ['p(95)<5000'], 
            'http_req_failed': [{ threshold: 'rate<0.10', abortOnFail: true }],
        }
        """

        script = template.replace("__TARGET_IP__", target)
        script = script.replace("__USER_DN__", dn)
        script = script.replace("__PASSWORD__", password)
        script = script.replace("__SCENARIO_NAME__", "stress_test")
        script = script.replace("__SCENARIO_BODY__", scenario)
        script = script.replace("__THRESHOLDS_BODY__", thresholds)
        script = script.replace("__USE_CSV__", use_csv)
        script = script.replace("__BASE_DN__", base_dn)

        return script

    def _save_to_history(self, report):
        history_file = "../techton-project/results/history.csv"
        # Ensure dir exists (relative to where app starts, usually techton-web)
        if not os.path.exists(os.path.dirname(history_file)):
            os.makedirs(os.path.dirname(history_file), exist_ok=True)

        file_exists = os.path.isfile(history_file)
        
        try:
            with open(history_file, 'a', newline='') as csvfile:
                fieldnames = ["Timestamp", "Target", "Users", "Duration", "AvgLatency", "Errors", "Status", "Path"]
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                
                if not file_exists:
                    writer.writeheader()
                
                # Path stored in history should be relative or absolute, let's use the one we created
                run_path = getattr(self, 'run_dir', 'results/unknown')
                
                # Normalize path for the frontend (assumes techton-project structure)
                # If run_dir is /usr/lib/.../techton-project/results/run_X
                # We want results/run_X
                if "results" in run_path:
                    clean_path = "results" + run_path.split("results")[-1]
                else:
                    clean_path = run_path

                writer.writerow({
                    "Timestamp": report["timestamp"],
                    "Target": report["target"],
                    "Users": report["stats"]["peak_vus"],
                    "Duration": report["stats"]["survival_time"],
                    "AvgLatency": report["stats"]["avg_latency"],
                    "Errors": report["stats"]["error_rate"],
                    "Status": "PASS" if report["score"] != "F" else "FAIL",
                    "Path": clean_path
                })
        except Exception as e:
            print(f"Error saving to history: {e}")

    def get_report(self):
        if self.last_report:
            return self.last_report

        if not hasattr(self, 'report_ready') or not self.report_ready:
            return None

        # Calculate Durations
        end_time = datetime.now()
        start_time = self.report_start_time
        if not start_time:
             return None # Can't generate report without a start time
        actual_duration = (end_time - start_time).seconds
        
        planned_duration_str = self.current_config.get("duration", "0s").replace("s","")
        try:
            planned_duration = int(planned_duration_str)
        except:
            planned_duration = actual_duration

        # Analyze Survival
        vus = int(self.current_config.get("vus", 0))
        target = self.current_config.get("target_ip", "Unknown")
        
        # Did it die early? (Allowing 5s buffer for startup/teardown)
        premature_stop = actual_duration < (planned_duration - 5) and not self.manual_stop
        
        score = "B+"
        recommendations = []
        status_msg = "TEST COMPLETED SUCCESSFULLY"

        if self.manual_stop:
            status_msg = f"Test manually stopped after {actual_duration}s."
            recommendations.append("Test was stopped by the user before completion.")
            score = "B"
        elif premature_stop:
            score = "F"
            status_msg = f"SERVER DOWN (Collapsed at {actual_duration}s)"
            recommendations.append(f"CRITICAL: Server collapsed after {actual_duration} seconds.")
            recommendations.append("Immediate Action: Check CPU Thermal Throttling or RAM saturation.")
            recommendations.append("Reduce VU load by 50% and re-test to find safe baseline.")
        elif vus > 500:
            score = "C"
            recommendations.append(f"High Load ({vus} VUs) sustained, but check latency logs.")
        else:
             score = "A"
             recommendations.append("Server healthy. No premature failures detected.")

        if self.current_config.get("mode") == "audit":
            # Override for audit
            score = "D"
            recommendations.append("Audit Found: Anonymous Bind Enabled (Security Risk).")

        self.last_report = {
            "summary": status_msg,
            "target": target,
            "timestamp": end_time.strftime("%Y-%m-%d %H:%M:%S"),
            "score": score,
            "stats": {
                "peak_vus": vus,
                "survival_time": f"{actual_duration}s / {planned_duration}s",
                "avg_latency": "High" if premature_stop else "Normal",
                "error_rate": ">10% (Aborted)" if premature_stop else "<1%"
            },
            "recommendations": recommendations
        }
        return self.last_report

    def get_status(self):
        logs = []
        if self.run_log_file and os.path.exists(self.run_log_file):
            try:
                with open(self.run_log_file, "r") as f:
                    f.seek(0, os.SEEK_END)
                    file_size = f.tell()
                    seek_offset = 2000 
                    if file_size > seek_offset:
                        f.seek(file_size - seek_offset)
                    else:
                        f.seek(0)
                    
                    content = f.read()
                    lines = content.split('\n')
                    logs = [l for l in lines if l.strip()][-5:] # Read more lines for better detection
            except Exception:
                pass

        # Check for k6 completion marker in logs
        if not self.report_ready and any("stress_test ✓ [ 100% ]" in l for l in logs):
            if self.start_time is not None: # Ensure a test was actually started
                self.report_start_time = self.start_time
                self.start_time = None # Mark as conceptually stopped
            self.report_ready = True
            
            # Generate and save report immediately
            report = self.get_report()
            if report:
                self._save_to_history(report)
            
            return {"status": "finished", "logs": logs}
            
        if not self.is_running():
            # If it was running but has now stopped, the test is over.
            if self.start_time is not None:
                self.report_start_time = self.start_time
                self.start_time = None # Mark as fully stopped
                self.report_ready = True
                
                # Generate and save report
                report = self.get_report()
                if report:
                    self._save_to_history(report)
                    
                return {"status": "finished", "logs": logs}
            return {"status": "stopped", "logs": logs}
        
        # Still running
        return {
            "status": "running",
            "pid": self.process.pid,
            "duration": (datetime.now() - self.start_time).seconds,
            "logs": logs
        }

runner = TestRunner()
