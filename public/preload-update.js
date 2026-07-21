const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, status, progress) => {
      callback(status, progress);
    });
  }
});
