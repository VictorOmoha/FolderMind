import { useState, useEffect, useCallback } from 'react'
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  increment,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { User } from 'firebase/auth'

export type PlanTier = 'free' | 'pro' | 'business'

export interface Usage {
  planTier: PlanTier
  folderCount: number
  aiCallsThisMonth: number
  aiCallsResetAt: string // ISO month string e.g. "2026-03"
}

const FREE_FOLDER_LIMIT = 2
const FREE_AI_LIMIT = 50

const currentMonth = () => new Date().toISOString().slice(0, 7) // "2026-03"

export function useUsage(user: User | null) {
  const [usage, setUsage] = useState<Usage>({
    planTier: 'free',
    folderCount: 0,
    aiCallsThisMonth: 0,
    aiCallsResetAt: currentMonth(),
  })

  useEffect(() => {
    if (!user) return
    const ref = doc(db, 'users', user.uid, 'meta', 'usage')
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) {
        const data = snap.data() as Usage
        // Auto-reset AI calls if new month
        if (data.aiCallsResetAt !== currentMonth()) {
          setDoc(ref, { aiCallsThisMonth: 0, aiCallsResetAt: currentMonth() }, { merge: true })
          setUsage({ ...data, aiCallsThisMonth: 0, aiCallsResetAt: currentMonth() })
        } else {
          setUsage(data)
        }
      } else {
        // First time — init usage doc
        const init: Usage = { planTier: 'free', folderCount: 0, aiCallsThisMonth: 0, aiCallsResetAt: currentMonth() }
        setDoc(ref, { ...init, createdAt: serverTimestamp() })
        setUsage(init)
      }
    })
    return unsub
  }, [user])

  const canCreateFolder = usage.planTier !== 'free' || usage.folderCount < FREE_FOLDER_LIMIT
  const canSendAI = usage.planTier !== 'free' || usage.aiCallsThisMonth < FREE_AI_LIMIT

  const trackFolderCreated = useCallback(async () => {
    if (!user) return
    const ref = doc(db, 'users', user.uid, 'meta', 'usage')
    await setDoc(ref, { folderCount: increment(1) }, { merge: true })
  }, [user])

  const trackAICall = useCallback(async () => {
    if (!user) return
    const ref = doc(db, 'users', user.uid, 'meta', 'usage')
    await setDoc(ref, { aiCallsThisMonth: increment(1) }, { merge: true })
  }, [user])

  const foldersRemaining = usage.planTier === 'free'
    ? Math.max(0, FREE_FOLDER_LIMIT - usage.folderCount)
    : Infinity

  const aiCallsRemaining = usage.planTier === 'free'
    ? Math.max(0, FREE_AI_LIMIT - usage.aiCallsThisMonth)
    : Infinity

  return {
    usage,
    canCreateFolder,
    canSendAI,
    foldersRemaining,
    aiCallsRemaining,
    trackFolderCreated,
    trackAICall,
  }
}
