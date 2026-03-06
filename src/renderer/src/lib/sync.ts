import {
  doc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import type { User } from 'firebase/auth'
import type { SmartFolder } from '../hooks/useFolder'

// Deterministic folder ID from local path
function folderIdFromPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '_').slice(-64)
}

// Sync folder metadata to Firestore on create/open
export async function syncFolder(user: User, folder: SmartFolder): Promise<void> {
  const fid = folderIdFromPath(folder.path)
  const ref = doc(db, 'users', user.uid, 'folders', fid)
  await setDoc(ref, {
    name: folder.name,
    localPath: folder.path,
    memory: folder.memory,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

// Push memory update to Firestore
export async function syncMemory(user: User, folderPath: string, memory: string): Promise<void> {
  const fid = folderIdFromPath(folderPath)
  const ref = doc(db, 'users', user.uid, 'folders', fid)
  await updateDoc(ref, {
    memory,
    updatedAt: serverTimestamp(),
  })
}

// Load all folders this user has ever opened (for recent folders list)
export async function loadUserFolders(user: User): Promise<{ id: string; name: string; localPath: string; memory: string }[]> {
  const col = collection(db, 'users', user.uid, 'folders')
  const snap = await getDocs(col)
  return snap.docs.map(d => ({ id: d.id, ...d.data() as { name: string; localPath: string; memory: string } }))
}
