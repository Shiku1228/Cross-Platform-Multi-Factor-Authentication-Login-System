const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Add any needed APIs here
  getVersion: () => process.versions.electron,
  getPlatform: () => process.platform
})

// Expose required globals for Firebase to work with contextIsolation
contextBridge.exposeInMainWorld('require', require)
contextBridge.exposeInMainWorld('process', process)

console.log('Electron preload loaded successfully')
