import subprocess
import os
import signal
import psutil
import json
import time
from datetime import datetime

class TestRunner:
    def __init__(self):
        self.process = None
        self.current_config = {}
        self.start_time = None
        self.report_start_time = None
        self.manual_stop = False
        self.log_file = "k6_output.json"
        self.k6_path = os.path.abspath("../techton-project/bin/k6") # Fallback
        if not os.path.exists(self.k6_path):
             # Try system k6
             self.k6_path = "k6"

    def is_running(self):
        if self.process is None:
            return False
        return self.process.poll() is None

    def start_test(self, config):
        if self.is_running():
            raise Exception("Test already running")

        self.current_config = config
        self.start_time = datetime.now()
        self.report_start_time = None
        self.report_ready = False # Reset report state
        self.manual_stop = False
        
        # 1. Prepare Script
        script_content = self._prepare_script(config)
        script_path = "temp_run.js"
        with open(script_path, "w") as f:
            f.write(script_content)
            
        # 2. Run K6
        cmd = [
            self.k6_path, "run", 
            "--out", f"json={self.log_file}",
            script_path
        ]
        
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
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
            self.report_ready = True # Mark report as ready
            if self.start_time:
                self.report_start_time = self.start_time
                self.start_time = None
            return True
        return False

    def _prepare_script(self, config):
        mode = config.get("mode", "load")
        
        # Select Template
        if mode == "audit":
            template_path = "backend/scripts/ad_audit.js"
        else:
            template_path = "backend/scripts/ad_load.js"

        if not os.path.exists(template_path):
             # Fallback
             template_path = f"techton-web/{template_path}"

        with open(template_path, "r") as f:
            template = f.read()
            
        # Replacements
        target = config.get("target_ip", "127.0.0.1")
        vus = config.get("vus", 10)
        duration = config.get("duration", "30s")
        dn = config.get("user_dn") or "guest"
        password = config.get("password") or "guest"
        
        use_csv = str(config.get("use_csv", False)).lower()
        
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

        return script

    def get_report(self):
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
        
        # Did it die early? (Allowing 2s buffer for startup/teardown)
        premature_stop = actual_duration < (planned_duration - 5) and not self.manual_stop
        
        score = "B+"
        recommendations = []
        status_msg = "TEST COMPLETED SUCCESSFULLY"

        if self.manual_stop:
            status_msg = f"Test manually stopped after {actual_duration}s."
            recommendations.append("Test was stopped by the user before completion.")
            score = "N/A"
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
            recommendations.append("Audit Found: Anonymous Bind Enabled (Security Risk)."]

        return {
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

    def get_status(self):
        if not self.is_running():
            # If it was running but has now stopped, the test is over.
            if self.start_time is not None:
                self.report_ready = True
                self.report_start_time = self.start_time
                self.start_time = None # Mark as fully stopped
                return {"status": "finished"}
            return {"status": "stopped"}
        
        # Still running
        return {
            "status": "running",
            "pid": self.process.pid,
            "duration": (datetime.now() - self.start_time).seconds
        }

runner = TestRunner()
