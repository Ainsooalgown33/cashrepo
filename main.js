const { app, BrowserWindow } = require('electron');
const path = require('path');

// Boot your existing Express backend server automatically
require('./server.js');

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 850,
        title: "Cashier POS System",
        autoHideMenuBar: true, 
        webPreferences: {
            nodeIntegration: true
        }
    });

    // Load the local HTML file into the app window
    win.loadFile('index.html');
}

app.whenReady().then(() => {
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