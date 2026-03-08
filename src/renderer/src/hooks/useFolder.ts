import { useState, useCallback, useEffect } from 'react'
import type { FolderBriefing, GitStatus, TaskItem } from '../../../src/vite-env'

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
  const [recentChanges, setRecentChanges] = useState<string[]>([])
  const [briefing, setBriefing] = useState<FolderBriefing | null>(null)
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingError, setBriefingError] = useState<string | null>(null)

  const loadBriefing = useCallback(async (folder: SmartFolder) => {
    setBriefingLoading(true)
    setBriefingError(null)
    try {
      const [nextBriefing, nextGit, nextTasks] = await Promise.all([
        window.foldermind.getBriefing(folder.path, folder.name),
        window.foldermind.getGitStatus(folder.path),
        window.foldermind.listTasks(folder.path),
      ])
      setBriefing(nextBriefing)
      setGitStatus(nextGit)
      setTasks(nextTasks)
    } catch (error: any) {
      setBriefingError(error?.message || 'Unable to load folder intelligence.')
    } finally {
      setBriefingLoading(false)
    }
  }, [])

  const activateFolder = useCallback(async (folder: SmartFolder) => {
    setActiveFolder(folder)
    setRecentChanges([])
    await loadBriefing(folder)
  }, [loadBriefing])

  const createFolder = useCallback(async () => {
    const folder = await window.foldermind.createFolder()
    if (folder) {
      await activateFolder(folder)
      setRecentFolders(prev => [folder, ...prev.filter(f => f.path !== folder.path)].slice(0, 10))
    }
    return folder
  }, [activateFolder])

  const openFolder = useCallback(async () => {
    const folder = await window.foldermind.openFolder()
    if (folder) {
      await activateFolder(folder)
      setRecentFolders(prev => [folder, ...prev.filter(f => f.path !== folder.path)].slice(0, 10))
    }
    return folder
  }, [activateFolder])

  const updateMemory = useCallback(async (newMemory: string) => {
    setActiveFolder(prev => prev ? { ...prev, memory: newMemory } : null)
    return true
  }, [])

  const refreshTasks = useCallback(async () => {
    if (!activeFolder) return
    setTasks(await window.foldermind.listTasks(activeFolder.path))
  }, [activeFolder])

  const addTask = useCallback(async (text: string) => {
    if (!activeFolder) return
    setTasks(await window.foldermind.addTask(activeFolder.path, text))
  }, [activeFolder])

  const updateTask = useCallback(async (taskId: string, updates: { text?: string; status?: 'open' | 'done' }) => {
    if (!activeFolder) return
    setTasks(await window.foldermind.updateTask(activeFolder.path, taskId, updates))
  }, [activeFolder])

  const deleteTask = useCallback(async (taskId: string) => {
    if (!activeFolder) return
    setTasks(await window.foldermind.deleteTask(activeFolder.path, taskId))
  }, [activeFolder])

  const runTask = useCallback(async (taskId: string) => {
    if (!activeFolder) return null
    const result = await window.foldermind.runTask(activeFolder.path, taskId)
    setTasks(result.tasks)
    return result.response
  }, [activeFolder])

  useEffect(() => {
    const unsub = window.foldermind?.onFolderChanged?.((data) => {
      setFileChanged(n => n + 1)
      if (!activeFolder) return
      if (!data.filePath.startsWith(activeFolder.path)) return
      const rel = data.filePath.replace(activeFolder.path, '').replace(/^[/\\]/, '')
      const entry = `${data.event}: ${rel}`
      setRecentChanges(prev => [entry, ...prev].slice(0, 8))
    })
    return unsub
  }, [activeFolder])

  return {
    activeFolder,
    recentFolders,
    fileChanged,
    recentChanges,
    briefing,
    gitStatus,
    tasks,
    briefingLoading,
    briefingError,
    createFolder,
    openFolder,
    updateMemory,
    addTask,
    updateTask,
    deleteTask,
    runTask,
    refreshTasks,
    setActiveFolder: activateFolder,
    refreshBriefing: activeFolder ? () => loadBriefing(activeFolder) : undefined,
  }
}
