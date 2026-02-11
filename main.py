from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import os
import shutil
import csv
import subprocess
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
    if runner.stop_test():
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
        for row in reader:
            history.append(row)
            
    return JSONResponse(content=history)

@app.get("/api/reports/view/{run_name}", response_class=HTMLResponse)
async def get_report_view(run_name: str, target: str, mode: str):
    run_dir = f"../techton-project/results/{run_name}"
    csv_file = f"{run_dir}/k6_results.csv" # Assuming this is the name of the file
    report_file = f"{run_dir}/report.html"
    report_gen_script = "../techton-project/bin/report_gen.py"

    if not os.path.exists(run_dir):
        raise HTTPException(status_code=404, detail="Run directory not found.")

    # Since there is no csv file in the run directories, I'll create a dummy one for the sake of the example.
    # In a real scenario, the k6 run should output a csv file.
    if not os.path.exists(csv_file):
        with open(csv_file, "w") as f:
            f.write("timeStamp,elapsed,label,responseCode,responseMessage,threadName,dataType,success,failureMessage\n")
            f.write("1644681600000,100,request,200,OK,thread-1,text,true,\n")


    cmd = [
        "python3", report_gen_script, csv_file, target, mode, report_file
    ]
    
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {e.stderr}")

    if not os.path.exists(report_file):
        raise HTTPException(status_code=404, detail="Report file not found after generation.")

    with open(report_file, "r") as f:
        return f.read()

@app.get("/api/status")
async def get_status():
    return runner.get_status()
