import { useState } from 'react'
import type { User } from 'firebase/auth'
import { joinWaitlist, type WaitlistTier } from '../lib/waitlist'
import { FolderMark } from './Icons'
import styles from './UpgradeModal.module.css'

interface Props {
  reason: 'folders' | 'ai_calls'
  user: User | null
  onClose: () => void
}

export function UpgradeModal({ reason, user, onClose }: Props) {
  const [joined, setJoined] = useState<WaitlistTier | null>(null)
  const [busy, setBusy] = useState<WaitlistTier | null>(null)

  const message = reason === 'folders'
    ? "You've reached the 2-folder limit on the free plan."
    : "You've used this month's hosted AI allowance on the free plan."

  const handleJoin = async (tier: WaitlistTier) => {
    if (busy || joined) return
    setBusy(tier)
    try {
      await joinWaitlist(user, tier, reason)
      setJoined(tier)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.icon}><FolderMark size={40} /></div>
        <h2 className={styles.title}>Paid plans are coming</h2>
        <p className={styles.message}>{message}</p>
        <p className={styles.honestyNote}>
          Billing isn't live yet — join the waitlist and we'll email you at launch.
          Your free plan keeps working meanwhile, and adding your own OpenAI key in
          Settings gives you unlimited AI today.
        </p>

        <div className={styles.grid}>
          <div className={styles.tier}>
            <div className={styles.tierName}>Free</div>
            <div className={styles.tierPrice}>$0</div>
            <ul className={styles.features}>
              <li>2 Smart Folders</li>
              <li>50 hosted AI calls/month</li>
              <li>Unlimited AI with your own key</li>
              <li>Local-first agent tools</li>
              <li className={styles.disabled}>Cloud sync</li>
            </ul>
            <div className={styles.badge}>Current plan</div>
          </div>

          <div className={`${styles.tier} ${styles.highlight}`}>
            <div className={styles.tierName}>Pro</div>
            <div className={styles.tierPrice}>$19<span>/mo</span></div>
            <ul className={styles.features}>
              <li>Unlimited folders</li>
              <li>500 hosted AI calls/month</li>
              <li>Cloud sync</li>
              <li>Priority support</li>
            </ul>
            <button
              className={styles.btnUpgrade}
              onClick={() => void handleJoin('pro')}
              disabled={busy !== null || joined !== null}
            >
              {joined === 'pro' ? '✓ On the waitlist' : busy === 'pro' ? 'Joining…' : 'Join the Pro waitlist'}
            </button>
          </div>

          <div className={styles.tier}>
            <div className={styles.tierName}>Business</div>
            <div className={styles.tierPrice}>$49<span>/mo</span></div>
            <ul className={styles.features}>
              <li>Everything in Pro</li>
              <li>Unlimited hosted AI</li>
              <li>Team sharing</li>
              <li>Admin dashboard</li>
              <li>SLA support</li>
            </ul>
            <button
              className={`${styles.btnUpgrade} ${styles.secondary}`}
              onClick={() => void handleJoin('business')}
              disabled={busy !== null || joined !== null}
            >
              {joined === 'business' ? '✓ On the waitlist' : busy === 'business' ? 'Joining…' : 'Join the Business waitlist'}
            </button>
          </div>
        </div>

        {joined && (
          <p className={styles.joinedNote}>
            You're on the {joined === 'pro' ? 'Pro' : 'Business'} waitlist — we'll email {user?.email || 'you'} when it launches.
          </p>
        )}

        <button className={styles.closeBtn} onClick={onClose}>Maybe later</button>
      </div>
    </div>
  )
}
