import { useState, useCallback, useEffect } from 'react'

export interface SmartFolder {
  path: string
  name: string
  memory: string
  agentConfig: Record<string, unknown>
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

  const updateMemory = useCallback(async (newMemory: string) => {
    setActiveFolder(prev => prev ? { ...prev, memory: newMemory } : null)
    return true
  }, [])

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
    updateMemory,
  }
}
