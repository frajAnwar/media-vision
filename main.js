const { app, BrowserWindow, dialog, Tray, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// Set db path to user data directory for production
const userDataPath = app.getPath('userData');
const dbDir = path.join(userDataPath, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
process.env.DB_PATH = path.join(dbDir, 'mediavision.db');

// Initialize the Express server
require('./server');

let mainWindow;
let tray = null;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    titleBarStyle: 'hidden', // Hides the default title bar for a native feel
    titleBarOverlay: {
      color: '#0f172a',
      symbolColor: '#ffffff',
      height: 40
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'public', 'favicon.png')
  });

  // Give Express a moment to bind to the port
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000');
  }, 1000);

  // Hide to tray instead of closing
  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Create System Tray Icon
  const iconPath = path.join(__dirname, 'public', 'favicon.png');
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Ouvrir Visionary AI', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Quitter', click: () => {
        app.isQuiting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip('Visionary AI');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    mainWindow.show();
  });

  // Check for updates seamlessly
  autoUpdater.checkForUpdatesAndNotify();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

autoUpdater.on('update-downloaded', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update Ready',
    message: 'A new version of Visionary AI has been downloaded. Restart the application to apply the updates.',
    buttons: ['Restart', 'Later']
  }).then((result) => {
    if (result.response === 0) {
      app.isQuiting = true;
      autoUpdater.quitAndInstall();
    }
  });
});
