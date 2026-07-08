import { useState } from 'react'
import type { GitStatus } from '../../../../src/vite-env'
import styles from './GitPanel.module.css'

interface Props {
  folderPath: string
  gitStatus: GitStatus
  onRefresh: () => void
}

export function GitPanel({ folderPath, gitStatus, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [commitMessage, setCommitMessage] = useState(gitStatus.suggestedCommitMessage || '')
  const [loading, setLoading] = useState(false)
  const [opResult, setOpResult] = useState<{ ok: boolean; output: string } | null>(null)

  const handleStageFile = async (filepath: string) => {
    setLoading(true)
    const res = await window.foldermind.gitStageFile(folderPath, filepath)
    setOpResult(res)
    setLoading(false)
    onRefresh()
  }

  const handleUnstageFile = async (filepath: string) => {
    setLoading(true)
    const res = await window.foldermind.gitUnstageFile(folderPath, filepath)
    setOpResult(res)
    setLoading(false)
    onRefresh()
  }

  const handleStageAll = async () => {
    setLoading(true)
    const res = await window.foldermind.gitStageAll(folderPath)
    setOpResult(res)
    setLoading(false)
    onRefresh()
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) return
    setLoading(true)
    const res = await window.foldermind.gitCommit(folderPath, commitMessage)
    setOpResult(res)
    if (res.ok) setCommitMessage('')
    setLoading(false)
    onRefresh()
  }

  const handlePush = async () => {
    setLoading(true)
    const res = await window.foldermind.gitPush(folderPath)
    setOpResult(res)
    setLoading(false)
    onRefresh()
  }

  const hasChanges = gitStatus.changedFiles.length > 0 || gitStatus.untrackedFiles.length > 0
  const hasStaged = gitStatus.stagedFiles.length > 0

  return (
    <section className={styles.panel}>
      <div className={styles.header} onClick={() => setExpanded(!expanded)}>
        <div className={styles.title}>
          <span className={styles.icon}>🌿</span>
          <strong>{gitStatus.branch || 'no branch'}</strong>
          {gitStatus.aheadBehind && <span className={styles.aheadBehind}>{gitStatus.aheadBehind}</span>}
        </div>
        <div className={styles.counts}>
          {gitStatus.changedFiles.length > 0 && <span className={`${styles.countPill} ${styles.changed}`}>{gitStatus.changedFiles.length} changed</span>}
          {gitStatus.stagedFiles.length > 0 && <span className={`${styles.countPill} ${styles.staged}`}>{gitStatus.stagedFiles.length} staged</span>}
          {gitStatus.untrackedFiles.length > 0 && <span className={`${styles.countPill} ${styles.untracked}`}>{gitStatus.untrackedFiles.length} untracked</span>}
          {!hasChanges && !hasStaged && <span className={`${styles.countPill} ${styles.clean}`}>clean</span>}
        </div>
        <button className={styles.toggle}>{expanded ? '▼' : '▶'}</button>
      </div>

      {expanded && (
        <div className={styles.body}>
          {gitStatus.stagedFiles.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>Staged Changes</span>
              </div>
              {gitStatus.stagedFiles.map(f => (
                <div key={f} className={styles.fileRow}>
                  <div className={styles.fileMain}>
                    <span className={styles.fileName}>{f}</span>
                    <div className={styles.fileActions}>
                      <button className={`${styles.fileBtn} ${styles.unstage}`} onClick={() => handleUnstageFile(f)} disabled={loading}>Unstage</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {gitStatus.changedFiles.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>Changes</span>
                <button className={styles.actionBtn} onClick={handleStageAll} disabled={loading}>Stage All</button>
              </div>
              {gitStatus.changedFiles.map(f => (
                <div key={f} className={styles.fileRow}>
                  <div className={styles.fileMain}>
                    <span className={styles.fileName}>{f}</span>
                    <div className={styles.fileActions}>
                      <button className={`${styles.fileBtn} ${styles.stage}`} onClick={() => handleStageFile(f)} disabled={loading}>Stage</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {gitStatus.untrackedFiles.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>Untracked</span>
              </div>
              {gitStatus.untrackedFiles.map(f => (
                <div key={f} className={styles.fileRow}>
                  <div className={styles.fileMain}>
                    <span className={styles.fileName}>{f}</span>
                    <div className={styles.fileActions}>
                      <button className={`${styles.fileBtn} ${styles.stage}`} onClick={() => handleStageFile(f)} disabled={loading}>Stage</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={styles.commitArea}>
            <textarea
              className={styles.commitInput}
              placeholder="Commit message..."
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              rows={2}
            />
            <div className={styles.commitActions}>
              <button className={`${styles.commitBtn} ${styles.primary}`} onClick={handleCommit} disabled={loading || !commitMessage.trim() || !hasStaged}>Commit</button>
              <button className={styles.commitBtn} onClick={handlePush} disabled={loading}>Push</button>
              <button className={styles.refreshBtn} onClick={onRefresh}>↻</button>
            </div>
          </div>

          {opResult && (
            <div className={`${styles.opResult} ${opResult.ok ? styles.ok : styles.error}`}>
              {opResult.output}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
