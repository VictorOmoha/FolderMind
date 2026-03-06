import { useState, useEffect } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'

export type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
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
