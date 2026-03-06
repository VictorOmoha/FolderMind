import { useState, useCallback, useEffect } from 'react'

export interface SmartFolder {
  path: string
  name: string
  memory: string
  agentConfig: Record<string, unknown>
}

declare global {
  interface Window {
    foldermind: {
      createFolder: () => Promise<SmartFolder | null>
      openFolder: () => Promise<SmartFolder | null>
      getFolderContext: (path: string) => Promise<{ name: string; content: string }[]>
      writeFile: (folderPath: string, fileName: string, content: string) => Promise<boolean>
      updateMemory: (folderPath: string, memory: string) => Promise<boolean>
      onFolderChanged: (cb: (data: { event: string; filePath: string }) => void) => () => void
    }
  }
}

export function useFolder() {
  const [activeFolder, setActiveFolder] = useState<SmartFolder | null>(null)
  const [recentFolders, setRecentFolders] = useState<SmartFolder[]>([])
  const [fileChanged, setFileChanged] = useState(0)

  const createFolder = useCallback(async () => {
    const folder = await window.foldermind.createFolder()
    if (folder) {
      setActiveFolder(folder)
      setRecentFolders(prev => [folder, ...prev.filter(f => f.path !== folder.path)].slice(0, 10))
    }
    return folder
  }, [])

  const openFolder = useCallback(async () => {
    const folder = await window.foldermind.openFolder()
    if (folder) {
      setActiveFolder(folder)
      setRecentFolders(prev => [folder, ...prev.filter(f => f.path !== folder.path)].slice(0, 10))
    }
    return folder
  }, [])

  const getContext = useCallback(async () => {
    if (!activeFolder) return []
    return window.foldermind.getFolderContext(activeFolder.path)
  }, [activeFolder])

  const writeFile = useCallback(async (fileName: string, content: string) => {
    if (!activeFolder) return false
    return window.foldermind.writeFile(activeFolder.path, fileName, content)
  }, [activeFolder])

  const updateMemory = useCallback(async (newMemory: string) => {
    if (!activeFolder) return false
    setActiveFolder(prev => prev ? { ...prev, memory: newMemory } : null)
    return window.foldermind.updateMemory(activeFolder.path, newMemory)
  }, [activeFolder])

  // Watch for file changes
  useEffect(() => {
    const unsub = window.foldermind?.onFolderChanged?.(() => {
      setFileChanged(n => n + 1)
    })
    return unsub
  }, [])

  return {
    activeFolder,
    recentFolders,
    fileChanged,
    createFolder,
    openFolder,
    getContext,
    writeFile,
    updateMemory,
  }
}
