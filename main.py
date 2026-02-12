from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import os
import shutil
import csv
import subprocess
import asyncio
from backend.runner import runner
from typing import Optional

app = FastAPI(title="Techton Web", description="AD Stress Test Dashboard")

# Mount Static
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def read_root():
    with open("templates/index.html", "r") as f:
        return f.read()

@app.post("/api/start")
async def start_test(
    target_ip: str = Form(...),
    vus: int = Form(...),
    duration: str = Form(...),
    mode: str = Form(...),
    base_dn: Optional[str] = Form(None), # New field
    user_dn: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    use_csv: bool = Form(False),
    csv_file: UploadFile = File(None)
):
    try:
        config = {
            "target_ip": target_ip,
            "vus": vus,
            "duration": duration,
            "mode": mode,
            "base_dn": base_dn, # Pass it
            "user_dn": user_dn,
            "password": password,
            "use_csv": use_csv,
            "csv_path": None
        }

        if use_csv and csv_file:
            # Save uploaded CSV
            file_location = "users.csv"
            with open(file_location, "wb+") as file_object:
                shutil.copyfileobj(csv_file.file, file_object)
            config["csv_path"] = os.path.abspath(file_location)

        runner.start_test(config)
        return {"status": "started"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/stop")
async def stop_test():
    if runner.stop_test(manual=True):
        return {"status": "stopped"}
    return {"status": "not running"}

@app.get("/api/report")
async def get_report():
    report = runner.get_report()
    if not report:
        raise HTTPException(status_code=404, detail="No report available yet")
    return report

@app.get("/api/reports/history")
async def get_reports_history():
    history_file = "../techton-project/results/history.csv"
    if not os.path.exists(history_file):
        raise HTTPException(status_code=404, detail="History file not found.")
    
    history = []
    with open(history_file, 'r') as f:
        reader = csv.DictReader(f)
        history = list(reader)
    
    # Reverse and limit to 100
    history.reverse()
    paginated_history = history[:100]
            
    return JSONResponse(content=paginated_history)

@app.post("/api/reports/clear")
async def clear_reports():
    history_file = "../techton-project/results/history.csv"
    header = "Timestamp,Target,Users,Duration,AvgLatency,Errors,Status,Path\n"
    
    try:
        with open(history_file, 'w') as f:
            f.write(header)
        return {"status": "cleared"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear history: {str(e)}")

@app.get("/api/reports/view/{run_name}", response_class=HTMLResponse)
async def get_report_view(run_name: str, target: str, mode: str, vus: str, duration: str):
    run_dir = f"../techton-project/results/{run_name}"
    csv_file = f"{run_dir}/k6_metrics.csv"
    report_file = f"{run_dir}/report.html"
    report_gen_script = "../techton-project/bin/report_gen.py"

    # Helper for error page
    def error_page(title, message):
        return f"""
        <html>
        <head>
            <style>
                body {{ background-color: #0f172a; color: #94a3b8; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
                .container {{ text-align: center; max-width: 500px; padding: 2rem; border: 1px solid #334155; border-radius: 8px; background: #1e293b; }}
                h1 {{ color: #ef4444; margin-bottom: 1rem; }}
                p {{ line-height: 1.5; }}
            </style>
        </head>
        <body>
            <div class="container">
                <h1>{title}</h1>
                <p>{message}</p>
            </div>
        </body>
        </html>
        """

    if not os.path.exists(run_dir):
        return error_page("Report Not Available", 
                          "The raw data for this test run was not preserved. This is likely a legacy run from an older version of Techton.")

    # If report exists, return it
    if os.path.exists(report_file):
        with open(report_file, "r") as f:
            return f.read()

    # Check for CSV
    if not os.path.exists(csv_file):
         return error_page("Data Missing", 
                           "The metrics file (k6_metrics.csv) for this run could not be found. The test might have been interrupted or failed to start correctly.")

    cmd = [
        "python3", report_gen_script, csv_file, target, mode, report_file, vus, duration
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        return error_page("Generation Failed", f"Failed to generate report.<br><pre style='text-align:left; bg-color:black; padding:10px; overflow:auto;'>{e.stderr}</pre>")

    if not os.path.exists(report_file):
        return error_page("Unknown Error", "Report generation appeared to succeed but no file was created.")

    with open(report_file, "r") as f:
        return f.read()

@app.websocket("/ws/status")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            await websocket.send_json(runner.get_status())
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        print("Client disconnected. Stopping test if running.")
        if runner.is_running():
            runner.stop_test()
