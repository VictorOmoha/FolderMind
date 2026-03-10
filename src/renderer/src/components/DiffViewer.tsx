import { useState } from 'react'
import { formatDiffLines } from './chatPanelUtils'
import styles from './DiffViewer.module.css'

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
    <div className={styles.viewer}>
      <button className={styles.header} onClick={() => setOpen((o) => !o)}>
        <span className={styles.filepath}>{label || filepath}</span>
        <span className={styles.stats}>
          {!isEmpty && (
            <>
              {additions > 0 && <span className={styles.statAdd}>+{additions}</span>}
              {removals > 0 && <span className={styles.statRemove}>-{removals}</span>}
            </>
          )}
          {isEmpty && <span className={styles.statNeutral}>no changes</span>}
        </span>
        <span className={styles.toggleIcon}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={styles.body}>
          {lines.length === 0 ? (
            <div className={styles.empty}>No diff recorded.</div>
          ) : (
            lines.map((line) => (
              <div key={line.id} className={`${styles.diffLine} ${styles[line.kind] || ''}`}>
                {line.text || '\u00A0'}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
