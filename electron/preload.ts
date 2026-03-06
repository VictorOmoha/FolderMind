import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('foldermind', {
  // Folder ops
  createFolder: () => ipcRenderer.invoke('folder:create'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  getFolderContext: (path: string) => ipcRenderer.invoke('folder:context', path),
  writeFile: (folderPath: string, fileName: string, content: string) =>
    ipcRenderer.invoke('folder:writeFile', folderPath, fileName, content),
  updateMemory: (folderPath: string, memory: string) =>
    ipcRenderer.invoke('folder:updateMemory', folderPath, memory),

  // File change events
  onFolderChanged: (cb: (data: { event: string; filePath: string }) => void) => {
    ipcRenderer.on('folder:changed', (_e, data) => cb(data))
    return () => ipcRenderer.removeAllListeners('folder:changed')
  },
})
