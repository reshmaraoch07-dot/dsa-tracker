#!/bin/bash

# Setup script for installing macOS LaunchAgents for Express Server & Electron Helper App
TARGET_DIR="$HOME/Library/LaunchAgents"

mkdir -p "$TARGET_DIR"

SERVER_PLIST="/Users/chinnurohit/Desktop/dsa-tracker/scripts/com.dsatracker.server.plist"
HELPER_PLIST="/Users/chinnurohit/Desktop/dsa-tracker/scripts/com.dsatracker.helper.plist"

cp "$SERVER_PLIST" "$TARGET_DIR/"
cp "$HELPER_PLIST" "$TARGET_DIR/"

echo "[Auto-Start Setup] Installed LaunchAgents to $TARGET_DIR"

# Unload previous instances if present
launchctl unload "$TARGET_DIR/com.dsatracker.server.plist" 2>/dev/null
launchctl unload "$TARGET_DIR/com.dsatracker.helper.plist" 2>/dev/null

# Load LaunchAgents
launchctl load "$TARGET_DIR/com.dsatracker.server.plist"
launchctl load "$TARGET_DIR/com.dsatracker.helper.plist"

echo "[Auto-Start Setup] Loaded com.dsatracker.server and com.dsatracker.helper."
echo "[Auto-Start Setup] Both services will now automatically run on login and auto-restart if terminated!"
