import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db, firebaseConfigured } from './firebase'

export type WaitlistTier = 'pro' | 'business'

/**
 * Billing isn't live yet, so the upgrade flow captures intent instead of money.
 * One doc per user in `waitlist` (keyed by uid — repeat clicks upsert); falls back
 * to the local feedback JSONL when Firebase isn't configured so no signup is lost.
 */
export async function joinWaitlist(
  user: User | null,
  tier: WaitlistTier,
  reason: string
): Promise<'cloud' | 'local'> {
  const base = {
    tier,
    reason,
    appVersion: '0.1.0',
  }

  if (firebaseConfigured && user) {
    try {
      await setDoc(doc(db, 'waitlist', user.uid), {
        uid: user.uid,
        email: user.email || null,
        ...base,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      return 'cloud'
    } catch {
      // fall through to the local sink
    }
  }

  await window.foldermind.submitFeedbackLocal({ kind: 'waitlist', ...base, email: user?.email || null })
  return 'local'
}
