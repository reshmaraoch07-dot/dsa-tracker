#!/bin/bash

TARGET_DIR="$HOME/Library/LaunchAgents"

echo "[Stop Services] Unloading com.dsatracker.server and com.dsatracker.helper..."
launchctl unload "$TARGET_DIR/com.dsatracker.server.plist" 2>/dev/null
launchctl unload "$TARGET_DIR/com.dsatracker.helper.plist" 2>/dev/null

lsof -ti :4545 | xargs kill -9 2>/dev/null

echo "[Stop Services] DSA Tracker Express Server and Helper App stopped."
