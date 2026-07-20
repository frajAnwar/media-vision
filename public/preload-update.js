const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, status, progress) => {
      callback(status, progress);
    });
  }
});
