import type { ApprovalRequest } from './chatPanelTypes'
import { formatDiffLines } from './chatPanelUtils'

export function ApprovalCard({ approvalRequest, onApprove, onBlock }: { approvalRequest: ApprovalRequest; onApprove: () => void; onBlock: () => void }) {
  const approvalDiffLines = formatDiffLines(approvalRequest?.diff)

  return (
    <section className={`agent-card approval-card ${approvalRequest.type === 'command' ? 'command' : 'file-change'}`}>
      <div className="approval-header-row">
        <div>
          <h3>{approvalRequest.title}</h3>
          <p className="muted">{approvalRequest.description}</p>
        </div>
        <span className={`approval-type-badge ${approvalRequest.type}`}>{approvalRequest.type === 'command' ? 'Command' : 'File Change'}</span>
      </div>

      {approvalRequest.filepath && <div className="approval-summary-row"><span className="approval-summary-label">Target file</span><span className="approval-summary-value mono">{approvalRequest.filepath}</span></div>}
      {approvalRequest.command && <div className="approval-summary-row"><span className="approval-summary-label">Command</span><pre className="approval-command">{approvalRequest.command}</pre></div>}
      {approvalRequest.diff && <div className="approval-diff-wrap"><div className="approval-summary-row compact"><span className="approval-summary-label">Diff preview</span><span className="approval-summary-value muted">Review additions and removals before approving.</span></div><div className="approval-diff-view">{approvalDiffLines.map((line) => <div key={line.id} className={`approval-diff-line ${line.kind}`}>{line.text || ' '}</div>)}</div></div>}

      <div className="approval-actions">
        <button className="btn-secondary" onClick={onBlock}>Block</button>
        <button className="btn-primary" onClick={onApprove}>Approve</button>
      </div>
    </section>
  )
}
