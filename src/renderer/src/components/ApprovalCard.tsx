import type { ApprovalRequest } from './chatPanelTypes'
import { formatDiffLines } from './chatPanelUtils'
import styles from './ApprovalCard.module.css'

export function ApprovalCard({ approvalRequest, onApprove, onBlock }: { approvalRequest: ApprovalRequest; onApprove: () => void; onBlock: () => void }) {
  const approvalDiffLines = formatDiffLines(approvalRequest?.diff)

  return (
    <section className={`agent-card ${styles.card} ${approvalRequest.type === 'command' ? styles.command : styles.fileChange}`}>
      <div className={styles.headerRow}>
        <div>
          <h3>{approvalRequest.title}</h3>
          <p className="muted">{approvalRequest.description}</p>
        </div>
        <span className={`${styles.typeBadge} ${styles[approvalRequest.type === 'command' ? 'command' : 'fileChange'] || ''}`}>
          {approvalRequest.type === 'command' ? 'Command' : 'File Change'}
        </span>
      </div>

      {approvalRequest.filepath && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Target file</span>
          <span className={`${styles.summaryValue} ${styles.mono}`}>{approvalRequest.filepath}</span>
        </div>
      )}
      
      {approvalRequest.command && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Command</span>
          <pre className={styles.commandPre}>{approvalRequest.command}</pre>
        </div>
      )}
      
      {approvalRequest.diff && (
        <div className={styles.diffWrap}>
          <div className={`${styles.summaryRow} ${styles.compact}`}>
            <span className={styles.summaryLabel}>Diff preview</span>
            <span className={`${styles.summaryValue} muted`}>Review changes before approving.</span>
          </div>
          <div className={styles.diffView}>
            {approvalDiffLines.map((line) => (
              <div key={line.id} className={`${styles.diffLine} ${styles[line.kind] || ''}`}>
                {line.text || ' '}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button className="btn-secondary" onClick={onBlock}>Block</button>
        <button className="btn-primary" onClick={onApprove}>Approve</button>
      </div>
    </section>
  )
}
