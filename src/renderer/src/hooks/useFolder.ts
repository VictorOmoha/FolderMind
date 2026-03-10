import { useState, useCallback, useEffect } from 'react'
import type { AgentJob, AgentRuntimeEvent, FolderBriefing, GitStatus, TaskItem } from '../../../src/vite-env'

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
  const [jobs, setJobs] = useState<AgentJob[]>([])
  const [events, setEvents] = useState<AgentRuntimeEvent[]>([])
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingError, setBriefingError] = useState<string | null>(null)

  const loadBriefing = useCallback(async (folder: SmartFolder) => {
    setBriefingLoading(true)
    setBriefingError(null)
    try {
      const [nextBriefing, nextGit, nextTasks, nextJobs, nextEvents] = await Promise.all([
        window.foldermind.getBriefing(folder.path, folder.name),
        window.foldermind.getGitStatus(folder.path),
        window.foldermind.listTasks(folder.path),
        window.foldermind.listAgentJobs(folder.path),
        window.foldermind.listAgentEvents(folder.path),
      ])
      setBriefing(nextBriefing)
      setGitStatus(nextGit)
      setTasks(nextTasks)
      setJobs(nextJobs)
      setEvents(nextEvents)
    } catch (error: unknown) {
      setBriefingError(error instanceof Error ? error.message : 'Unable to load folder intelligence.')
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

  const refreshJobs = useCallback(async () => {
    if (!activeFolder) return
    setJobs(await window.foldermind.listAgentJobs(activeFolder.path))
  }, [activeFolder])
  const refreshEvents = useCallback(async () => {
    if (!activeFolder) return
    setEvents(await window.foldermind.listAgentEvents(activeFolder.path))
  }, [activeFolder])

  const addTask = useCallback(async (text: string) => {
    if (!activeFolder) return
    setTasks(await window.foldermind.addTask(activeFolder.path, text))
  }, [activeFolder])

  const updateTask = useCallback(async (taskId: string, updates: { text?: string; status?: 'suggested' | 'open' | 'done' }) => {
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
    const unsub = window.foldermind?.onJobsUpdated?.((data) => {
      if (!activeFolder || data.folderPath !== activeFolder.path) return
      setJobs(data.jobs)
    })
    return unsub
  }, [activeFolder])

  useEffect(() => {
    const unsub = window.foldermind?.onEventsUpdated?.((data) => {
      if (!activeFolder || data.folderPath !== activeFolder.path) return
      setEvents(data.events)
    })
    return unsub
  }, [activeFolder])

  useEffect(() => {
    const unsub = window.foldermind?.onTasksUpdated?.((data) => {
      if (!activeFolder || data.folderPath !== activeFolder.path) return
      setTasks(data.tasks)
    })
    return unsub
  }, [activeFolder])

  useEffect(() => {
    const unsub = window.foldermind?.onMemoryUpdated?.((newMemory) => {
      if (!activeFolder) return
      setActiveFolder(prev => prev ? { ...prev, memory: newMemory } : null)
      // When memory updates (usually by agent), we should probably refresh the briefing
      // as it might contain new decisions or tasks.
      void loadBriefing(activeFolder)
    })
    return unsub
  }, [activeFolder, loadBriefing])

  useEffect(() => {
    const unsub = window.foldermind?.onFolderChanged?.((data) => {
      setFileChanged(n => n + 1)
      if (!activeFolder) return
      if (!data.filePath.startsWith(activeFolder.path)) return
      const rel = data.filePath.replace(activeFolder.path, '').replace(/^[/\\]/, '')
      const entry = `${data.event}: ${rel}`
      setRecentChanges(prev => [entry, ...prev].slice(0, 8))
      
      // Optionally trigger git refresh or briefing refresh on significant changes
      if (data.event === 'add' || data.event === 'unlink' || data.event === 'change') {
         // Debounce or just wait for explicit refresh to save AI calls
      }
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
    jobs,
    events,
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
    refreshJobs,
    refreshEvents,
    setActiveFolder: activateFolder,
    refreshBriefing: activeFolder ? () => loadBriefing(activeFolder) : undefined,
  }
}

