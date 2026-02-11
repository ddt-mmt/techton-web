#!/bin/bash
echo "Starting Techton Web Dashboard..."
echo "Access at http://localhost:8000"
cd "$(dirname "$0")"
export TZ="Asia/Jakarta"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
