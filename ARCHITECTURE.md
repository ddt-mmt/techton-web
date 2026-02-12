# Techton Web - Architecture Overview

## System Components

Techton Web is a modern, responsive dashboard built for conducting **stress tests** and **security audits** on Active Directory (AD) environments. It leverages a high-performance load generation engine (k6) orchestrated by a lightweight Python backend.

### 1. Frontend (SPA)
- **Framework**: React.js (via CDN/Babel for simplified deployment without complex build steps).
- **Styling**: Tailwind CSS (Utility-first CSS).
- **Visualization**: Chart.js (Interactive line/bar charts for trend analysis).
- **State Management**: React Hooks (`useState`, `useEffect`).
- **Communication**: 
  - REST API (`fetch`) for command/control.
  - WebSocket (`ws://`) for real-time log streaming and status updates.

### 2. Backend (API & Orchestrator)
- **Framework**: FastAPI (Python 3.8+).
- **Server**: Uvicorn (ASGI).
- **Responsibilities**:
  - **Process Management**: Spawns and monitors the `k6` subprocess.
  - **Configuration Injection**: Dynamically generates test scripts (`temp_run.js`) based on user input (VUs, Duration, Base DN).
  - **Log Streaming**: Reads the `k6` stdout/stderr in real-time and pushes to WebSocket clients.
  - **Report Generation**: Invokes `report_gen.py` to process CSV metrics into HTML reports.
  - **History Management**: Maintains a CSV-based history of test runs (`../techton-project/results/history.csv`).

### 3. Load Engine (k6)
- **Binary**: Custom build of k6 (`xk6-ldap`).
- **Extension**: `xk6-ldap` for native LDAP protocol support (Bind, Search, Add, Delete).
- **Scripts**: JavaScript (ES6) scenarios defined in `backend/scripts/`.
  - `ad_load.js`: The core stress test logic.
  - `ad_audit.js`: Security vulnerability checks.
- **Output**: 
  - JSON Summary (`k6_summary.json`).
  - CSV Metrics (`k6_metrics.csv`) for detailed post-run analysis.

## Data Flow

1.  **User Input**: User configures test parameters (IP, Users, Duration) on the Dashboard.
2.  **API Request**: Frontend sends `POST /api/start` to Backend.
3.  **Script Preparation**: Backend reads `ad_load.js` template, injects variables (including `__BASE_DN__` and `__USER_DN__`), and writes `temp_run.js`.
4.  **Execution**: Backend spawns `k6 run ...` as a subprocess.
5.  **Real-Time Feedback**: 
    - `k6` writes logs to `k6_run.log`.
    - Backend reads `k6_run.log` and broadcasts new lines via WebSocket.
    - Frontend displays logs in the "System Log" console.
6.  **Completion**: 
    - `k6` finishes and outputs metrics to `results/run_timestamp/k6_metrics.csv`.
    - Backend detects process exit.
    - Backend updates history CSV.
    - Frontend receives "finished" status and refreshes history table.
7.  **Reporting**: User clicks "View Report", Backend runs `report_gen.py` against the CSV, generates HTML, and serves it.

## Directory Structure

```
/usr/lib/gemini-cli/
├── techton-web/              # Frontend & API Source
│   ├── main.py               # FastAPI Entry Point
│   ├── backend/              # Python Modules & Scripts
│   │   ├── runner.py         # Test Execution Logic
│   │   └── scripts/          # JS Templates for k6
│   ├── static/               # Frontend Assets (app.js)
│   └── templates/            # HTML Templates (index.html)
└── techton-project/          # Load Test Engine & Data
    ├── bin/                  # k6 Binary
    └── results/              # Test Artifacts (CSV, HTML Reports)
```

## Security Considerations

- **Credential Handling**: Passwords are passed to the backend but never stored permanently. They are injected into temporary run scripts which are overwritten on the next run.
- **Resource Limits**: The `k6` process is monitored, and users can manually abort tests via the UI to prevent prolonged denial of service on the target AD.
