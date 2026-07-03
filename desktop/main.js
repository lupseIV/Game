const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const steam = require('./steam');

let win = null;
let gamePort = null;

function lanAddresses() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

async function createWindow() {
  // The local server always runs: it serves the game page from localhost
  // (a secure context, so the microphone works) and doubles as the host
  // server when this player hosts an expedition.
  const { start } = require(path.join(__dirname, '..', 'server', 'index.js'));
  gamePort = await start(27960);

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    autoHideMenuBar: true,
    backgroundColor: '#0c1408',
    title: 'Emerald Canopy',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'audioCapture', 'pointerLock', 'fullscreen'].includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'audioCapture', 'pointerLock', 'fullscreen'].includes(permission)
  );

  win.on('enter-full-screen', () => win.setMenuBarVisibility(false));
  await win.loadFile(path.join(__dirname, 'menu.html'));
}

ipcMain.handle('info', () => ({
  port: gamePort,
  persona: steam.personaName(),
  lan: lanAddresses(),
  steamActive: steam.isActive(),
  version: app.getVersion(),
}));

app.whenReady().then(() => {
  steam.init();
  createWindow().catch((e) => {
    console.error('Failed to start:', e);
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
