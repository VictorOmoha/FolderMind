import { useState, useEffect } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider, firebaseConfigured } from '../lib/firebase'

export type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

// Local preview bypass: ONLY active in `npm run dev` when Firebase is not configured.
// Lets you click through the real UI without a Firebase project. Never triggers in a
// production build (import.meta.env.DEV is false) or when Firebase env is set.
const PREVIEW_MODE = import.meta.env.DEV && !firebaseConfigured
const PREVIEW_USER = { uid: 'preview-user', email: 'preview@local', displayName: 'Preview User' } as unknown as User

export function useAuth() {
  const [user, setUser] = useState<User | null>(PREVIEW_MODE ? PREVIEW_USER : null)
  const [authState, setAuthState] = useState<AuthState>(PREVIEW_MODE ? 'authenticated' : 'loading')
  const [error, setError] = useState('')

  useEffect(() => {
    if (PREVIEW_MODE) {
      console.warn('[FolderMind] Preview mode: Firebase not configured — auth gate bypassed for local dev only.')
      return
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthState(u ? 'authenticated' : 'unauthenticated')
    })
    return unsub
  }, [])

  const loginWithEmail = async (email: string, password: string) => {
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e: unknown) {
      setError((e as Error).message.replace('Firebase: ', ''))
    }
  }

  const signupWithEmail = async (email: string, password: string) => {
    setError('')
    try {
      await createUserWithEmailAndPassword(auth, email, password)
    } catch (e: unknown) {
      setError((e as Error).message.replace('Firebase: ', ''))
    }
  }

  const loginWithGoogle = async () => {
    setError('')
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e: unknown) {
      // Popup may be blocked in Electron — fall back gracefully
      const msg = (e as Error).message
      if (msg.includes('popup-blocked') || msg.includes('cancelled')) {
        setError('Google sign-in popup was blocked. Please use email/password instead.')
      } else {
        setError(msg.replace('Firebase: ', ''))
      }
    }
  }

  const logout = () => signOut(auth)

  return { user, authState, error, loginWithEmail, signupWithEmail, loginWithGoogle, logout }
}
