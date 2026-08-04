/* Electron desktop wrapper for the Sales Order app.
   Loads the bundled web app (copied from ../www into ./app at build time). */
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Sales Order',
    backgroundColor: '#1b3a6b',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });

  Menu.setApplicationMenu(null);          // clean, app-like window (no menu bar)
  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  // http(s) links (WhatsApp share, etc.) open in the real browser;
  // blank windows (the Print / PDF popup) open normally inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
}

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
