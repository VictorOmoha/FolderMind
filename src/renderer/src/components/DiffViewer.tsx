import { useState } from 'react'
import { formatDiffLines } from './chatPanelUtils'

interface Props {
  filepath: string
  diff: string
  label?: string
  defaultOpen?: boolean
}

export function DiffViewer({ filepath, diff, label, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const lines = formatDiffLines(diff)
  const additions = lines.filter((l) => l.kind === 'add').length
  const removals = lines.filter((l) => l.kind === 'remove').length
  const isEmpty = lines.length === 0 || (additions === 0 && removals === 0)

  return (
    <div className="diff-viewer">
      <button className="diff-viewer-header" onClick={() => setOpen((o) => !o)}>
        <span className="diff-viewer-filepath">{label || filepath}</span>
        <span className="diff-viewer-stats">
          {!isEmpty && (
            <>
              {additions > 0 && <span className="diff-stat-add">+{additions}</span>}
              {removals > 0 && <span className="diff-stat-remove">-{removals}</span>}
            </>
          )}
          {isEmpty && <span className="diff-stat-neutral">no changes</span>}
        </span>
        <span className="diff-toggle-icon">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="diff-viewer-body">
          {lines.length === 0 ? (
            <div className="diff-viewer-empty">No diff recorded.</div>
          ) : (
            lines.map((line) => (
              <div key={line.id} className={`approval-diff-line ${line.kind}`}>
                {line.text || '\u00A0'}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
