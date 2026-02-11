# Techton Web ⚡

> A web-based dashboard for the Techton Active Directory Stress Testing Suite.

Techton Web provides a user-friendly graphical interface for running and monitoring stress tests with Techton. It also provides a way to view historical reports.

## Features

- **Web-based Test Configuration:** Easily configure and launch stress tests from your browser.
- **Live Telemetry:** Monitor the status of your tests in real-time.
- **Executive Reports:** Get a high-level summary of your test results.
- **Historical Reports:** Browse and view detailed reports from past test runs.

## Installation and Usage

1.  **Navigate to the `techton-web` directory:**
    ```bash
    cd techton-web
    ```

2.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Start the web server:**
    ```bash
    ./start.sh
    ```

4.  **Access the dashboard:**
    Open your web browser and go to `http://localhost:8000`.

## Historical Reports

The "Historical Reports" section at the bottom of the page lists all previous test runs. You can click the "View Report" button to see a detailed report for each run. This report is generated on-the-fly and provides in-depth analysis of the test, including latency, throughput, and error rates.
