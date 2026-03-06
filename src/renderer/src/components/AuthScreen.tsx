import { useState } from 'react'
import type { useAuth } from '../hooks/useAuth'

type AuthHook = ReturnType<typeof useAuth>

interface Props {
  onLogin: AuthHook['loginWithEmail']
  onSignup: AuthHook['signupWithEmail']
  onGoogle: AuthHook['loginWithGoogle']
  error: string
}

export function AuthScreen({ onLogin, onSignup, onGoogle, error }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'login') onLogin(email, password)
    else onSignup(email, password)
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">🗂️</div>
        <h1 className="auth-title">FolderMind</h1>
        <p className="auth-tagline">Every folder, a co-worker.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-divider"><span>or</span></div>

        <button className="auth-btn-google" onClick={onGoogle} type="button">
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
            <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p className="auth-toggle">
          {mode === 'login' ? (
            <>No account? <button type="button" onClick={() => setMode('signup')}>Sign up free</button></>
          ) : (
            <>Have an account? <button type="button" onClick={() => setMode('login')}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  )
}
