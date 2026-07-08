import { useState, useRef, useCallback, useEffect } from 'react'
import type { User } from 'firebase/auth'
import type { SmartFolder } from './useFolder'
import type { TaskItem, ChatMessage } from '../../../../src/vite-env'
import {
  syncFolder,
  syncMemory,
  syncTasks,
  syncChat,
  loadUserFolders,
  type CloudFolder,
} from '../lib/sync'
import { firebaseConfigured } from '../lib/firebase'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

const DEBOUNCE_MS = 2000

export function useSync(user: User | null) {
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [cloudFolders, setCloudFolders] = useState<CloudFolder[]>([])
  const [cloudFoldersLoaded, setCloudFoldersLoaded] = useState(false)

  const memoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tasksTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef(0)

  // ── Internal helpers ──────────────────────────────────────────────────────
  const begin = () => {
    inflight.current++
    setStatus('syncing')
  }
  const done = () => {
    inflight.current = Math.max(0, inflight.current - 1)
    if (inflight.current === 0) setStatus('synced')
  }
  const fail = (err: unknown) => {
    inflight.current = Math.max(0, inflight.current - 1)
    console.warn('[useSync] error:', err)
    setStatus('error')
  }

  // ── Load cloud folders on sign-in ─────────────────────────────────────────
  useEffect(() => {
    if (!user || !firebaseConfigured) { setCloudFolders([]); setCloudFoldersLoaded(false); return }
    loadUserFolders(user)
      .then((folders) => { setCloudFolders(folders); setCloudFoldersLoaded(true) })
      .catch((err) => console.warn('[useSync] loadUserFolders error:', err))
  }, [user])

  // ── Sync: folder opened/created ───────────────────────────────────────────
  const onFolderOpen = useCallback(async (folder: SmartFolder) => {
    if (!user || !firebaseConfigured) return
    begin()
    try {
      await syncFolder(user, folder)
      // Refresh cloud folder list so sidebar stays current
      const updated = await loadUserFolders(user)
      setCloudFolders(updated)
      done()
    } catch (err) { fail(err) }
  }, [user])

  // ── Sync: memory (debounced) ──────────────────────────────────────────────
  const onMemoryChange = useCallback((folderPath: string, memory: string) => {
    if (!user || !firebaseConfigured) return
    if (memoryTimer.current) clearTimeout(memoryTimer.current)
    memoryTimer.current = setTimeout(async () => {
      begin()
      try { await syncMemory(user, folderPath, memory); done() }
      catch (err) { fail(err) }
    }, DEBOUNCE_MS)
  }, [user])

  // ── Sync: tasks (debounced) ───────────────────────────────────────────────
  const onTasksChange = useCallback((folderPath: string, tasks: TaskItem[]) => {
    if (!user || !firebaseConfigured) return
    if (tasksTimer.current) clearTimeout(tasksTimer.current)
    tasksTimer.current = setTimeout(async () => {
      begin()
      try { await syncTasks(user, folderPath, tasks); done() }
      catch (err) { fail(err) }
    }, DEBOUNCE_MS)
  }, [user])

  // ── Sync: chat (debounced) ────────────────────────────────────────────────
  const onChatMessages = useCallback((folderPath: string, messages: ChatMessage[]) => {
    if (!user || !firebaseConfigured) return
    if (chatTimer.current) clearTimeout(chatTimer.current)
    chatTimer.current = setTimeout(async () => {
      begin()
      try { await syncChat(user, folderPath, messages); done() }
      catch (err) { fail(err) }
    }, DEBOUNCE_MS)
  }, [user])

  return {
    status,
    cloudFolders,
    cloudFoldersLoaded,
    onFolderOpen,
    onMemoryChange,
    onTasksChange,
    onChatMessages,
  }
}
