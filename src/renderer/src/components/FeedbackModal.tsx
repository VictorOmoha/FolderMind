import { useState } from 'react'
import type { User } from 'firebase/auth'
import { submitFeedback, type FeedbackRating } from '../lib/feedback'
import styles from './FeedbackModal.module.css'

interface Props {
  open: boolean
  user: User | null
  context?: Record<string, unknown>
  onClose: () => void
}

const RATINGS: { key: FeedbackRating; emoji: string; label: string }[] = [
  { key: 'great', emoji: '😀', label: 'Great' },
  { key: 'ok', emoji: '😐', label: 'Okay' },
  { key: 'bad', emoji: '😞', label: 'Rough' },
]

export function FeedbackModal({ open, user, context, onClose }: Props) {
  const [rating, setRating] = useState<FeedbackRating | null>(null)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  if (!open) return null

  const reset = () => { setRating(null); setMessage(''); setStatus('idle') }
  const close = () => { reset(); onClose() }

  const send = async () => {
    if (!message.trim() && !rating) return
    setStatus('sending')
    try {
      await submitFeedback(user, { rating, message, context })
      setStatus('sent')
      setTimeout(close, 1400)
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className={`modal ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2>Send feedback</h2>
            <p className="muted">Tell us what worked, what broke, or what's missing. This goes straight to the team.</p>
          </div>
          <button className="btn-secondary" onClick={close}>Close</button>
        </div>

        <div className={styles.ratings}>
          {RATINGS.map((r) => (
            <button
              key={r.key}
              className={`${styles.rating} ${rating === r.key ? styles.ratingActive : ''}`}
              onClick={() => setRating(r.key)}
              type="button"
            >
              <span className={styles.emoji}>{r.emoji}</span>
              <span>{r.label}</span>
            </button>
          ))}
        </div>

        <textarea
          className={styles.textarea}
          rows={5}
          placeholder="What happened? What would make this better?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <div className={styles.actions}>
          {status === 'sent' && <span className={styles.ok}>Thanks — feedback sent.</span>}
          {status === 'error' && <span className={styles.err}>Couldn't send. Please try again.</span>}
          <button
            className="btn-primary"
            onClick={send}
            disabled={status === 'sending' || (!message.trim() && !rating)}
          >
            {status === 'sending' ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>
    </div>
  )
}
