/* ============================================================
   main.js - Electron entry point

   The renderer is now locked down: contextIsolation on,
   nodeIntegration off, and a preload bridge as the only channel.
   Previously a product name containing markup could have reached
   Node APIs directly.

   The backend is started BEFORE the window opens so the UI never
   comes up pointing at a port that does not exist.
   ============================================================ */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const crypto = require('crypto');
const path = require('path');

const backend = require('./server.js');

// Per-launch shared secret. The renderer receives it over IPC; nothing
// else on the machine can guess it, which is what actually keeps other
// local processes and browser pages off the sales database.
const API_TOKEN = crypto.randomBytes(32).toString('hex');

let apiPort = null;
let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1360,
        height: 880,
        minWidth: 1024,
        minHeight: 680,
        title: 'Cashier POS',
        backgroundColor: '#0A0C10', // matches --bg, so there is no white flash
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());
    mainWindow.on('closed', () => { mainWindow = null; });

    // Keep the app a single-page shell: anything external opens in the
    // real browser rather than replacing the terminal.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

    mainWindow.loadFile('index.html');
}

ipcMain.handle('pos:config', () => ({
    baseUrl: 'http://127.0.0.1:' + apiPort + '/api',
    token: API_TOKEN,
    version: app.getVersion()
}));

app.whenReady().then(() => {
    return backend.start({
        userDataPath: app.getPath('userData'),
        token: API_TOKEN
    });
}).then((info) => {
    apiPort = info.port;
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}).catch((err) => {
    // Without the backend nothing can be recorded, and a POS that cannot
    // record a sale must not open at all. Failing loudly beats a terminal
    // that prints receipts into the void.
    console.error('[startup] backend failed to start:', err);
    dialog.showErrorBox(
        'Cashier POS could not start',
        'The local data service failed to start, so sales could not be recorded.\n\n' +
        err.message + '\n\nClose any other copy of Cashier POS that is already running, then try again.'
    );
    app.quit();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
