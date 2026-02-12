# Techton AD Resilience Suite (Enterprise Edition)

**Active Directory Stress Testing & Security Audit Tool**

Techton is a specialized dashboard for testing the performance, stability, and security of Active Directory (AD) infrastructure. It simulates real-world load using virtual users (VUs) to perform LDAP operations (Bind, Search, Recursive Query) and provides detailed reports with grading.

## Key Features

- **Real-Time Stress Testing**: Simulate hundreds/thousands of concurrent users binding and searching the directory.
- **Aggressive Load Mode**: Uses recursive `ScopeWholeSubtree` searches in tight loops to maximize CPU load on Domain Controllers.
- **LDAP Auto-Discovery**: Automatically detects the correct Base DN (Naming Context) from user credentials.
- **Base DN Override**: Advanced option to target specific OUs (e.g., `OU=User,OU=BRIN,DC=net...`).
- **Trend Analysis**: Visualize historical performance (Load vs Survival Time) to track infrastructure health over time.
- **Security Audit**: Checks for common vulnerabilities like Anonymous Bind and RootDSE exposure.
- **Detailed Reporting**: Generates HTML executive reports with A-F grading based on latency, error rate, and survival duration.

## Architecture

- **Frontend**: React.js (Single Page Application) with Tailwind CSS for styling and Chart.js for visualization.
- **Backend**: FastAPI (Python) handles API requests, process management, and report generation.
- **Engine**: k6 (with `xk6-ldap` extension) executes the high-performance load tests.
- **Communication**: WebSocket for real-time log streaming and status updates.

## Prerequisites

- **Python 3.8+**
- **k6** (Custom build with xk6-ldap required, binary included in `../techton-project/bin/k6`)
- **LDAP Server** (Target AD)

## Installation

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/your-org/techton-web.git
    cd techton-web
    ```

2.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

3.  **Verify K6 Binary**:
    Ensure the custom k6 binary exists at `../techton-project/bin/k6`. If not, build it using `xk6 build --with github.com/grafana/xk6-ldap`.

## Usage

1.  **Start the Dashboard**:
    ```bash
    bash start.sh
    ```
    Access the UI at `http://localhost:8000`.

2.  **Configure Test**:
    - **Target IP**: IP Address of the Domain Controller.
    - **Mode**: `Load` (Stress) or `Audit` (Security).
    - **VUs**: Number of Virtual Users (Threads). Recommended: 50-500 for initial tests.
    - **Duration**: Test length (e.g., `60s`).
    - **User Credential**: Use NetBIOS format `DOMAIN\User` (e.g., `BRIN\dity001`).
    - **Base DN (Optional)**: If empty, auto-discovery is attempted. Else, specify full DN (e.g., `OU=User,OU=BRIN,DC=net,DC=brin,DC=go,DC=id`).

3.  **Analyze Results**:
    - Watch the **System Log** for real-time errors (`timeout`, `refused`).
    - Check the **Trend Analysis** chart for performance degradation over multiple runs.
    - Click **View Report** in history to see detailed metrics and the final grade.

## Grading System

| Grade | Condition | Description |
| :--- | :--- | :--- |
| **A** | Excellent | Full duration survival, Latency < 2s, Errors < 0.1%. |
| **B** | Good | Full duration, minor latency spikes or manually stopped. |
| **C** | Stressed | High Latency (>2s) OR High Error Rate (>5%). |
| **D** | Risk | Security Audit Failed (e.g., Anonymous Bind enabled). |
| **F** | Critical | Server collapsed (stopped responding) before test completion. |

## Troubleshooting

- **No CPU Load on AD?**: Check credentials. If bind fails, no search is performed. Ensure `DOMAIN\User` format is used.
- **"Connection Refused"?**: The server is overloaded or firewall is blocking port 389.
- **Report Generation Failed?**: Ensure `python3` is in your PATH and `../techton-project/results/` is writable.

## License

Enterprise Internal Use Only.