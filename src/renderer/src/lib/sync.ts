import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { User } from 'firebase/auth'
import type { SmartFolder } from '../hooks/useFolder'
import type { TaskItem, ChatMessage } from '../../../../src/vite-env'

// ── Deterministic, Firestore-safe folder ID from local path ──────────────────
export function folderIdFromPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_').slice(-64)
}

// ── Folder refs ──────────────────────────────────────────────────────────────
function folderRef(uid: string, folderId: string) {
  return doc(db, 'users', uid, 'folders', folderId)
}
function syncDocRef(uid: string, folderId: string, type: 'tasks' | 'chat') {
  return doc(db, 'users', uid, 'folders', folderId, 'sync', type)
}

// ── Simplified types for cloud storage (keep documents small) ────────────────
interface CloudTask {
  id: string
  text: string
  status: 'open' | 'done'
  lastRunSummary?: string
  lastRunStatus?: string
  runCount: number
}

interface CloudMessage {
  role: 'user' | 'assistant'
  content: string
}

function simplifyTasks(tasks: TaskItem[]): CloudTask[] {
  return tasks.slice(0, 100).map((t) => ({
    id: t.id,
    text: t.text,
    status: t.status,
    runCount: t.runs?.length ?? 0,
    lastRunSummary: t.runs?.[0]?.summary?.slice(0, 300),
    lastRunStatus: t.runs?.[0]?.status,
  }))
}

function simplifyMessages(messages: ChatMessage[]): CloudMessage[] {
  return messages
    .slice(-30)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
}

// ── Sync: folder metadata + memory ───────────────────────────────────────────
export async function syncFolder(user: User, folder: SmartFolder): Promise<void> {
  const fid = folderIdFromPath(folder.path)
  await setDoc(
    folderRef(user.uid, fid),
    {
      name: folder.name,
      localPath: folder.path,
      memory: folder.memory,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

// ── Sync: memory only (lightweight update) ───────────────────────────────────
export async function syncMemory(user: User, folderPath: string, memory: string): Promise<void> {
  const fid = folderIdFromPath(folderPath)
  await setDoc(
    folderRef(user.uid, fid),
    { memory, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// ── Sync: task list ───────────────────────────────────────────────────────────
export async function syncTasks(user: User, folderPath: string, tasks: TaskItem[]): Promise<void> {
  const fid = folderIdFromPath(folderPath)
  await setDoc(syncDocRef(user.uid, fid, 'tasks'), {
    items: simplifyTasks(tasks),
    syncedAt: serverTimestamp(),
  })
}

// ── Sync: chat history ────────────────────────────────────────────────────────
export async function syncChat(user: User, folderPath: string, messages: ChatMessage[]): Promise<void> {
  const fid = folderIdFromPath(folderPath)
  await setDoc(syncDocRef(user.uid, fid, 'chat'), {
    messages: simplifyMessages(messages),
    syncedAt: serverTimestamp(),
  })
}

// ── Load: folder cloud data (for new-device restore) ─────────────────────────
export async function loadFolderFromCloud(
  user: User,
  folderPath: string,
): Promise<{ memory: string | null; tasks: CloudTask[] | null; messages: CloudMessage[] | null }> {
  const fid = folderIdFromPath(folderPath)
  const [folderSnap, tasksSnap, chatSnap] = await Promise.all([
    getDoc(folderRef(user.uid, fid)),
    getDoc(syncDocRef(user.uid, fid, 'tasks')),
    getDoc(syncDocRef(user.uid, fid, 'chat')),
  ])

  return {
    memory: folderSnap.exists() ? (folderSnap.data()?.memory ?? null) : null,
    tasks: tasksSnap.exists() ? (tasksSnap.data()?.items ?? null) : null,
    messages: chatSnap.exists() ? (chatSnap.data()?.messages ?? null) : null,
  }
}

// ── Load: all folders this user has synced (for sidebar on new device) ────────
export interface CloudFolder {
  id: string
  name: string
  localPath: string
  memory: string
  updatedAt: number | null
}

export async function loadUserFolders(user: User): Promise<CloudFolder[]> {
  const col = collection(db, 'users', user.uid, 'folders')
  const snap = await getDocs(col)
  return snap.docs
    .map((d) => {
      const data = d.data() as Omit<CloudFolder, 'id'>
      const ts = data.updatedAt as any
      return {
        id: d.id,
        name: data.name ?? 'Unnamed',
        localPath: data.localPath ?? '',
        memory: data.memory ?? '',
        updatedAt: ts?.toMillis?.() ?? null,
      }
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}
