#!/bin/bash

echo "=== DSA Tracker Background Services Status ==="
echo ""
echo "--- Launchctl Services ---"
launchctl list | grep dsatracker || echo "No dsatracker LaunchAgent services loaded."

echo ""
echo "--- Server Health Check (http://localhost:4545/api/health) ---"
curl -s http://localhost:4545/api/health || echo "Server is offline."
echo ""
