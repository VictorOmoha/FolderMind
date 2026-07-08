import { useState } from 'react'
import { FolderMark } from './Icons'
import styles from './AuthScreen.module.css'

interface Props {
  onLogin: (email: string, pass: string) => Promise<void>
  onSignup: (email: string, pass: string) => Promise<void>
  onGoogle: () => Promise<void>
  error: string | null
}

export function AuthScreen({ onLogin, onSignup, onGoogle, error }: Props) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') await onLogin(email, pass)
      else await onSignup(email, pass)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.logo}><FolderMark size={44} /></div>
        <h1 className={styles.title}>FolderMind</h1>
        <p className={styles.tagline}>Autonomous Folder Agents</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className={styles.input}
            type="password"
            placeholder="Password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.btnPrimary} type="submit" disabled={loading}>
            {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className={styles.divider}>or</div>

        <button className={styles.btnGoogle} onClick={onGoogle} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.24h2.91c1.7-1.57 2.68-3.88 2.68-6.57z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.24c-.8.54-1.84.85-3.05.85-2.34 0-4.32-1.58-5.03-3.7H1.02v2.33C2.5 15.96 5.54 18 9 18z"/>
            <path fill="#FBBC05" d="M3.97 10.73c-.18-.54-.28-1.12-.28-1.73s.1-1.19.28-1.73V4.94H1.02C.37 6.22 0 7.66 0 9s.37 2.78 1.02 4.06l2.95-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.89 11.43 0 9 0 5.54 0 2.5 2.04 1.02 4.94l2.95 2.33c.71-2.12 2.69-3.69 5.03-3.69z"/>
          </svg>
          Continue with Google
        </button>

        <p className={styles.toggle}>
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
