const { app, Tray, Menu, Notification, clipboard, globalShortcut, shell, nativeImage } = require('electron');
const path = require('path');
const http = require('http');

let tray = null;
const SERVER_DRAFT_URL = 'http://localhost:4545/api/draft';
const ADD_PROBLEM_URL = 'http://localhost:4545/add-problem.html?draft=latest';
const DASHBOARD_URL = 'http://localhost:4545';

const HOTKEY = process.platform === 'darwin' ? 'Command+Shift+H' : 'Control+Shift+H';

/**
 * Reads system clipboard code and posts to local tracker server.
 */
function captureClipboardAndOpen() {
  const code = clipboard.readText();

  if (!code || !code.trim()) {
    if (Notification.isSupported()) {
      new Notification({
        title: 'DSA Tracker Helper',
        body: 'Clipboard is empty. Please copy code before pressing hotkey.'
      }).show();
    }
    return;
  }

  const payload = JSON.stringify({
    platform: 'hive',
    code: code,
    capturedAt: new Date().toISOString()
  });

  const req = http.request(SERVER_DRAFT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'DSA Tracker Helper',
          body: 'Draft saved — opening form...'
        }).show();
      }
      shell.openExternal(ADD_PROBLEM_URL);
    });
  });

  req.on('error', (err) => {
    console.error('[Helper App] Server POST error:', err.message);
    if (Notification.isSupported()) {
      new Notification({
        title: 'DSA Tracker Helper',
        body: 'Failed to connect to local server on port 4545.'
      }).show();
    }
  });

  req.write(payload);
  req.end();
}

app.whenReady().then(() => {
  // Hide macOS dock icon to run strictly as a background tray application
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  // Create System Tray Icon
  const iconPath = path.join(__dirname, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('DSA Tracker Helper (Active)');

  // Build System Tray Context Menu
  const contextMenu = Menu.buildFromTemplate([
    { label: 'DSA Tracker Helper (Running)', enabled: false },
    { type: 'separator' },
    {
      label: `Capture Clipboard (${HOTKEY})`,
      click: () => captureClipboardAndOpen()
    },
    {
      label: 'Open Tracker Dashboard',
      click: () => shell.openExternal(DASHBOARD_URL)
    },
    { type: 'separator' },
    {
      label: 'Quit Helper App',
      click: () => {
        globalShortcut.unregisterAll();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Register Global Keyboard Shortcut
  const registered = globalShortcut.register(HOTKEY, () => {
    console.log(`[Helper App] Global shortcut ${HOTKEY} triggered!`);
    captureClipboardAndOpen();
  });

  if (!registered) {
    console.error(`[Helper App] Failed to register global shortcut ${HOTKEY}`);
  } else {
    console.log(`[Helper App] System tray app active. Press ${HOTKEY} to capture clipboard.`);
  }
});

// Unregister shortcuts when quitting
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
