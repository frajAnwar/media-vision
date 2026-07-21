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
      contextIsolation: true,
      preload: path.join(__dirname, 'public', 'preload-update.js')
    },
    icon: path.join(__dirname, 'public', 'favicon.png')
  });

  // Load the update splash screen first
  mainWindow.loadFile(path.join(__dirname, 'public', 'update.html'));

  // Hide to tray instead of closing
  mainWindow.on('close', function (event) {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

let isDashboardLoaded = false;

function loadDashboard() {
  isDashboardLoaded = true;
  mainWindow.loadURL('http://localhost:3000');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

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

  // Wait a bit for Express to bind, then check for updates
  setTimeout(() => {
    if (app.isPackaged) {
      autoUpdater.checkForUpdates();
      // Check for updates every hour (3600000 ms) in the background
      setInterval(() => {
        autoUpdater.checkForUpdates();
      }, 3600000);
    } else {
      // If in dev mode, just skip to dashboard
      mainWindow.webContents.send('update-status', 'Mode dev: Lancement...', 100);
      setTimeout(loadDashboard, 1000);
    }
  }, 1000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
}

// Update Events
autoUpdater.on('checking-for-update', () => {
  if (mainWindow) mainWindow.webContents.send('update-status', 'Recherche de mises à jour...');
});

autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update-status', 'Mise à jour trouvée. Préparation...', null);
});

autoUpdater.on('update-not-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'Application à jour. Lancement...', 100);
    setTimeout(loadDashboard, 1000);
  }
});

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 'Hors ligne ou erreur. Lancement...', 100);
    setTimeout(loadDashboard, 1500);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = 'Téléchargement: ' + Math.round(progressObj.percent) + '%';
  if (mainWindow) mainWindow.webContents.send('update-status', log_message, progressObj.percent);
});

autoUpdater.on('update-downloaded', (info) => {
  if (isDashboardLoaded) {
    // If the user is already inside the app working, show a popup
    dialog.showMessageBox({
      type: 'info',
      title: 'Mise à jour disponible',
      message: 'Une nouvelle version de Visionary AI a été téléchargée en arrière-plan. Voulez-vous redémarrer l\'application pour l\'installer maintenant ?',
      buttons: ['Redémarrer maintenant', 'Plus tard']
    }).then((result) => {
      if (result.response === 0) {
        app.isQuiting = true;
        autoUpdater.quitAndInstall(false, true);
      }
    });
  } else {
    // If they are on the splash screen, force the update immediately
    if (mainWindow) mainWindow.webContents.send('update-status', 'Installation en cours...', 100);
    setTimeout(() => {
      app.isQuiting = true;
      autoUpdater.quitAndInstall(false, true);
    }, 2000);
  }
});
