import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db, firebaseConfigured } from './firebase'

export type FeedbackRating = 'great' | 'ok' | 'bad'

export interface FeedbackInput {
  rating: FeedbackRating | null
  message: string
  context?: Record<string, unknown>
}

/**
 * Send pilot feedback. Prefers Firestore (where the team reads it); falls back to a
 * local JSONL file via the main process when Firebase isn't configured (dev/preview),
 * so feedback is never silently dropped.
 */
export async function submitFeedback(user: User | null, input: FeedbackInput): Promise<'cloud' | 'local'> {
  const base = {
    rating: input.rating,
    message: input.message.trim().slice(0, 4000),
    context: input.context || {},
    appVersion: '0.1.0',
  }

  if (firebaseConfigured && user) {
    await addDoc(collection(db, 'feedback'), {
      uid: user.uid,
      email: user.email || null,
      ...base,
      createdAt: serverTimestamp(),
    })
    return 'cloud'
  }

  await window.foldermind.submitFeedbackLocal({ ...base, email: user?.email || null })
  return 'local'
}
