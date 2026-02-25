const { contextBridge } = require('electron');

// Minimal safe bridge: expose only what you need
contextBridge.exposeInMainWorld('electronAPI', {
  // Example: expose a method to get app version or other non-sensitive data
  getVersion: () => process.versions.electron
});

// No Node APIs are exposed to the renderer for security
