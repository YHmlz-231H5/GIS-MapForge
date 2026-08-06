import { contextBridge, ipcRenderer } from 'electron';
import type {
  ExposedApi,
  IpcResult,
  Region,
  Task,
  TaskKind,
  TaskLogLine,
  TaskStatus,
  TaskOptions,
} from '../shared/types';

// Subscribe to live task logs and forward to renderer via callback.
// Returns unsubscribe function.
function subscribeChannel(channel: string) {
  return (cb: (line: TaskLogLine) => void) => {
    const listener = (_e: unknown, line: TaskLogLine) => cb(line);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  };
}

const api: ExposedApi = {
  // Region
  searchRegion: (query) => ipcRenderer.invoke('region:search', query),
  resolveRegionFromGeoJson: (json) => ipcRenderer.invoke('region:fromGeoJson', json),
  fetchRegionBoundary: (adcode) => ipcRenderer.invoke('region:fetchBoundary', adcode),
  guessRegionAdcode: (payload) => ipcRenderer.invoke('region:guessAdcode', payload),
  saveRegionPreset: (region) => ipcRenderer.invoke('region:savePreset', region),
  listRegionPresets: () => ipcRenderer.invoke('region:listPresets'),

  // Tasks
  submitTask: (input) => ipcRenderer.invoke('task:submit', input),
  listTasks: (filter) => ipcRenderer.invoke('task:list', filter),
  cancelTask: (taskId) => ipcRenderer.invoke('task:cancel', taskId),
  resumeTask: (taskId) => ipcRenderer.invoke('task:resume', taskId),
  deleteTask: (taskId, opts) => ipcRenderer.invoke('task:delete', taskId, opts),
  renameTask: (taskId, newName) => ipcRenderer.invoke('task:rename', taskId, newName),
  clearCompletedTasks: () => ipcRenderer.invoke('task:clear'),
  clearAllTasks: () => ipcRenderer.invoke('task:clearAll'),

  subscribeTaskLogs: (_taskId, cb) => {
    const listener = (_e: unknown, line: TaskLogLine) => cb(line);
    ipcRenderer.on('task:log', listener);
    return () => ipcRenderer.off('task:log', listener);
  },

  subscribeTaskUpdates: (cb) => {
    const listener = (_e: unknown, task: Task) => cb(task);
    ipcRenderer.on('task:update', listener);
    return () => ipcRenderer.off('task:update', listener);
  },

  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),

  detectJava: () => ipcRenderer.invoke('system:detectJava'),
  resolvePlanetilerJar: () => ipcRenderer.invoke('system:planetilerJar'),
  openFolder: (p) => ipcRenderer.invoke('system:openFolder', p),
  resolveOutputDir: () => ipcRenderer.invoke('system:resolveOutputDir'),
  pickDirectory: () => ipcRenderer.invoke('system:pickDirectory'),
  pickOpenFile: (opts) => ipcRenderer.invoke('system:pickOpenFile', opts),
  listPmtiles: (dir) => ipcRenderer.invoke('fs:listPmtiles', dir),
  readTextFile: (filePath) => ipcRenderer.invoke('fs:readTextFile', filePath),
  writeTextFiles: (dir, files) => ipcRenderer.invoke('fs:writeTextFiles', dir, files),
  readRasterTileFile: (tileDir, z, x, fileName) =>
    ipcRenderer.invoke('fs:readRasterTileFile', tileDir, z, x, fileName),
  readMbtilesTile: (mbtilesPath, z, x, y) =>
    ipcRenderer.invoke('mbtiles:getTile', mbtilesPath, z, x, y),

  version: () => ipcRenderer.invoke('app:version'),
  platform: process.platform,
  quit: () => ipcRenderer.invoke('app:quit'),
};

contextBridge.exposeInMainWorld('api', api);
