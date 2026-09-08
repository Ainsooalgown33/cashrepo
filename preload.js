/* ============================================================
   preload.js - the only bridge between the page and Electron

   Deliberately tiny. It hands the renderer the API base URL and
   the per-launch token and nothing else: no fs, no child_process,
   no ipcRenderer passthrough.
   ============================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posBridge', {
    getConfig: () => ipcRenderer.invoke('pos:config')
});
