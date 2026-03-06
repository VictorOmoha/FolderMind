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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-icon">🚀</div>
        <h2 className="modal-title">Upgrade to Pro</h2>
        <p className="modal-message">{message}</p>

        <div className="pricing-grid">
          <div className="pricing-tier current">
            <div className="tier-name">Free</div>
            <div className="tier-price">$0</div>
            <ul className="tier-features">
              <li>2 Smart Folders</li>
              <li>50 AI calls/month</li>
              <li>Local only</li>
              <li className="disabled">Voice input</li>
              <li className="disabled">Cloud sync</li>
            </ul>
            <div className="tier-badge">Current plan</div>
          </div>

          <div className="pricing-tier highlight">
            <div className="tier-name">Pro</div>
            <div className="tier-price">$19<span>/mo</span></div>
            <ul className="tier-features">
              <li>Unlimited folders</li>
              <li>500 AI calls/month</li>
              <li>Cloud sync</li>
              <li>Voice input</li>
              <li>Priority support</li>
            </ul>
            <button className="btn-upgrade" onClick={onUpgrade}>
              Upgrade to Pro →
            </button>
          </div>

          <div className="pricing-tier">
            <div className="tier-name">Business</div>
            <div className="tier-price">$49<span>/mo</span></div>
            <ul className="tier-features">
              <li>Everything in Pro</li>
              <li>Unlimited AI calls</li>
              <li>Team sharing</li>
              <li>Admin dashboard</li>
              <li>SLA support</li>
            </ul>
            <button className="btn-upgrade secondary" onClick={onUpgrade}>
              Upgrade to Business →
            </button>
          </div>
        </div>

        <button className="modal-close" onClick={onClose}>Maybe later</button>
      </div>
    </div>
  )
}
