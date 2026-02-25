const { app, BrowserWindow } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');

let mainWindow;
let server;
const PORT = 3456;

// Start local Express server to serve the existing Firebase web UI
function startServer() {
  const webApp = express();
  const webRoot = path.join(__dirname, '../../OneDrive/Documents/Multi-Factor Authentication');

  webApp.use(express.static(webRoot));

  // Fallback to index.html for SPA-like behavior
  webApp.get('*', (req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
  });

  server = http.createServer(webApp);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Local server running at http://127.0.0.1:${PORT}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'MFA Auth Desktop'
  });

  // Load the local web UI
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Optional: Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close();
  }
});
