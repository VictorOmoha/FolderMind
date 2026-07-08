import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// True only when a real Firebase project is configured via env. When false (e.g. local
// preview with no .env), auth/sync/usage hooks skip Firebase so the UI still runs.
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

// IMPORTANT: getAuth() throws `auth/invalid-api-key` when the key is missing/invalid,
// which would crash the entire renderer at import time (blank window). Only initialize
// the SDK when it's actually configured; otherwise export null placeholders. Every
// consumer (useAuth/useUsage/useSync) guards on `firebaseConfigured` before using these.
export const app = firebaseConfigured ? initializeApp(firebaseConfig) : null
export const auth = (firebaseConfigured && app ? getAuth(app) : null) as ReturnType<typeof getAuth>
export const db = (firebaseConfigured && app ? getFirestore(app) : null) as ReturnType<typeof getFirestore>
export const googleProvider = new GoogleAuthProvider()
