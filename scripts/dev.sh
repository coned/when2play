#!/usr/bin/env bash
set -euo pipefail

# Run backend and frontend dev servers concurrently
# Backend: wrangler dev on port 8787
# Frontend: vite dev on port 5173 (proxies /api to backend)

cleanup() {
	kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting when2play dev servers..."

wrangler dev --port 8787 &
BACKEND_PID=$!

cd frontend && npx vite --port 5173 &
FRONTEND_PID=$!

echo "Backend:  http://localhost:8787"
echo "Frontend: http://localhost:5173"

wait
