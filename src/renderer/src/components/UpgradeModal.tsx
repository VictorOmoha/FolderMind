import styles from './UpgradeModal.module.css'

interface Props {
  reason: 'folders' | 'ai_calls'
  onClose: () => void
  onUpgrade: () => void
}

export function UpgradeModal({ reason, onClose, onUpgrade }: Props) {
  const message = reason === 'folders'
    ? "You've reached the 2-folder limit on the free plan."
    : "You've used all 50 AI calls this month on the free plan."

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.icon}>🚀</div>
        <h2 className={styles.title}>Upgrade to Pro</h2>
        <p className={styles.message}>{message}</p>

        <div className={styles.grid}>
          <div className={styles.tier}>
            <div className={styles.tierName}>Free</div>
            <div className={styles.tierPrice}>$0</div>
            <ul className={styles.features}>
              <li>2 Smart Folders</li>
              <li>50 AI calls/month</li>
              <li>Local only</li>
              <li className={styles.disabled}>Voice input</li>
              <li className={styles.disabled}>Cloud sync</li>
            </ul>
            <div className={styles.badge}>Current plan</div>
          </div>

          <div className={`${styles.tier} ${styles.highlight}`}>
            <div className={styles.tierName}>Pro</div>
            <div className={styles.tierPrice}>$19<span>/mo</span></div>
            <ul className={styles.features}>
              <li>Unlimited folders</li>
              <li>500 AI calls/month</li>
              <li>Cloud sync</li>
              <li>Voice input</li>
              <li>Priority support</li>
            </ul>
            <button className={styles.btnUpgrade} onClick={onUpgrade}>
              Upgrade to Pro →
            </button>
          </div>

          <div className={styles.tier}>
            <div className={styles.tierName}>Business</div>
            <div className={styles.tierPrice}>$49<span>/mo</span></div>
            <ul className={styles.features}>
              <li>Everything in Pro</li>
              <li>Unlimited AI calls</li>
              <li>Team sharing</li>
              <li>Admin dashboard</li>
              <li>SLA support</li>
            </ul>
            <button className={`${styles.btnUpgrade} ${styles.secondary}`} onClick={onUpgrade}>
              Upgrade to Business →
            </button>
          </div>
        </div>

        <button className={styles.closeBtn} onClick={onClose}>Maybe later</button>
      </div>
    </div>
  )
}
