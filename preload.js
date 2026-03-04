const { contextBridge, ipcRenderer } = require('electron');

function on(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('electronAPI', {
  openTrackerDialog: () => ipcRenderer.invoke('dialog:openTracker'),
  readTrackerFile: (filePath) => ipcRenderer.invoke('tracker:read', filePath),
  writeAdjacentTracker: (payload) => ipcRenderer.invoke('tracker:writeAdjacent', payload),
  pickRefluxExe: () => ipcRenderer.invoke('dialog:pickRefluxExe'),
  ensureReflux: () => ipcRenderer.invoke('reflux:ensure'),
  saveTsvFile: (payload) => ipcRenderer.invoke('tsv:save', payload),
  startReflux: (payload) => ipcRenderer.invoke('reflux:start', payload),
  stopReflux: () => ipcRenderer.invoke('reflux:stop'),
  onRefluxLog: (listener) => on('reflux:log', listener),
  onRefluxStatus: (listener) => on('reflux:status', listener),
  onRefluxTracker: (listener) => on('reflux:tracker', listener),
  onRefluxReady: (listener) => on('reflux:ready', listener),
  getRankTables: () => ipcRenderer.invoke('ranktables:get'),
  refreshRankTables: () => ipcRenderer.invoke('ranktables:refresh'),
  readState: () => ipcRenderer.invoke('state:read'),
  writeState: (state) => ipcRenderer.invoke('state:write', state),
  openOauthPopup: (payload) => ipcRenderer.invoke('oauth:openPopup', payload),
  exportImage: (payload) => ipcRenderer.invoke('export:image', payload),
  exportGoals: (payload) => ipcRenderer.invoke('goals:export', payload),
  importGoals: () => ipcRenderer.invoke('goals:import')
});
