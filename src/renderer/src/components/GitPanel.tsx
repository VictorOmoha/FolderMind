import { useState, useCallback } from 'react'
import type { GitStatus } from '../../../../src/vite-env'
import { DiffViewer } from './DiffViewer'

interface Props {
  folderPath: string
  gitStatus: GitStatus
  onRefresh: () => void
}

type OpStatus = { ok: boolean; message: string } | null

// ── File row (changed or staged) ─────────────────────────────────────────────
function GitFileRow({
  file,
  folderPath,
  staged,
  onStage,
  onUnstage,
}: {
  file: string
  folderPath: string
  staged: boolean
  onStage: (file: string) => Promise<void>
  onUnstage: (file: string) => Promise<void>
}) {
  const [diff, setDiff] = useState<string | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [open, setOpen] = useState(false)

  const toggleDiff = useCallback(async () => {
    if (open) { setOpen(false); return }
    if (diff !== null) { setOpen(true); return }
    setLoadingDiff(true)
    try {
      const result = await window.foldermind.gitGetFileDiff(folderPath, file, staged)
      setDiff(result.ok ? result.diff : '(unable to load diff)')
    } finally {
      setLoadingDiff(false)
      setOpen(true)
    }
  }, [open, diff, folderPath, file, staged])

  return (
    <div className="git-file-row">
      <div className="git-file-main">
        <span className="git-file-icon">{staged ? '✅' : '📝'}</span>
        <span className="git-file-name" title={file}>{file}</span>
        <div className="git-file-actions">
          <button
            className="git-file-btn diff"
            onClick={toggleDiff}
            disabled={loadingDiff}
          >
            {loadingDiff ? '…' : open ? 'hide' : 'diff'}
          </button>
          {staged
            ? <button className="git-file-btn unstage" onClick={() => onUnstage(file)}>−</button>
            : <button className="git-file-btn stage" onClick={() => onStage(file)}>+</button>
          }
        </div>
      </div>
      {open && diff !== null && (
        <DiffViewer filepath={file} diff={diff} defaultOpen label={file} />
      )}
    </div>
  )
}

// ── Main GitPanel ─────────────────────────────────────────────────────────────
export function GitPanel({ folderPath, gitStatus, onRefresh }: Props) {
  const [commitMsg, setCommitMsg] = useState(gitStatus.suggestedCommitMessage || '')
  const [opStatus, setOpStatus] = useState<OpStatus>(null)
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const withOp = useCallback(async (fn: () => Promise<{ ok: boolean; output: string }>) => {
    setBusy(true)
    setOpStatus(null)
    try {
      const result = await fn()
      setOpStatus({ ok: result.ok, message: result.output || (result.ok ? 'Done.' : 'Failed.') })
      if (result.ok) onRefresh()
    } catch (e: any) {
      setOpStatus({ ok: false, message: e.message })
    } finally {
      setBusy(false)
    }
  }, [onRefresh])

  const handleStage = useCallback(async (file: string) => {
    await withOp(() => window.foldermind.gitStageFile(folderPath, file))
  }, [folderPath, withOp])

  const handleUnstage = useCallback(async (file: string) => {
    await withOp(() => window.foldermind.gitUnstageFile(folderPath, file))
  }, [folderPath, withOp])

  const handleStageAll = useCallback(async () => {
    await withOp(() => window.foldermind.gitStageAll(folderPath))
  }, [folderPath, withOp])

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) { setOpStatus({ ok: false, message: 'Commit message is required.' }); return }
    await withOp(() => window.foldermind.gitCommit(folderPath, commitMsg.trim()))
    if (commitMsg === gitStatus.suggestedCommitMessage) setCommitMsg('')
  }, [commitMsg, folderPath, gitStatus.suggestedCommitMessage, withOp])

  const handlePush = useCallback(async () => {
    await withOp(() => window.foldermind.gitPush(folderPath))
  }, [folderPath, withOp])

  const handleCommitAndPush = useCallback(async () => {
    if (!commitMsg.trim()) { setOpStatus({ ok: false, message: 'Commit message is required.' }); return }
    setBusy(true)
    setOpStatus(null)
    try {
      const commitResult = await window.foldermind.gitCommit(folderPath, commitMsg.trim())
      if (!commitResult.ok) { setOpStatus({ ok: false, message: commitResult.output }); return }
      const pushResult = await window.foldermind.gitPush(folderPath)
      setOpStatus({ ok: pushResult.ok, message: pushResult.output || (pushResult.ok ? 'Committed and pushed.' : 'Commit OK but push failed.') })
      onRefresh()
    } catch (e: any) {
      setOpStatus({ ok: false, message: e.message })
    } finally {
      setBusy(false)
    }
  }, [commitMsg, folderPath, onRefresh])

  if (!gitStatus.isRepo) return null

  const unchanged = gitStatus.changedFiles.length === 0 && gitStatus.stagedFiles.length === 0
  const unstagedFiles = gitStatus.changedFiles.filter((f) => !gitStatus.stagedFiles.includes(f))

  return (
    <div className="git-panel">
      {/* ── Header ── */}
      <div className="git-panel-header" onClick={() => setCollapsed((c) => !c)}>
        <div className="git-panel-title">
          <span className="git-panel-icon">⎇</span>
          <strong>{gitStatus.branch || 'unknown'}</strong>
          {gitStatus.aheadBehind && <span className="git-ahead-behind">{gitStatus.aheadBehind}</span>}
        </div>
        <div className="git-panel-counts">
          {gitStatus.changedFiles.length > 0 && (
            <span className="git-count-pill changed">{gitStatus.changedFiles.length} changed</span>
          )}
          {gitStatus.stagedFiles.length > 0 && (
            <span className="git-count-pill staged">{gitStatus.stagedFiles.length} staged</span>
          )}
          {gitStatus.untrackedFiles.length > 0 && (
            <span className="git-count-pill untracked">{gitStatus.untrackedFiles.length} untracked</span>
          )}
          {unchanged && <span className="git-count-pill clean">✓ Clean</span>}
        </div>
        <button className="git-panel-toggle">{collapsed ? '▼' : '▲'}</button>
      </div>

      {!collapsed && (
        <div className="git-panel-body">
          {/* ── Unstaged / Changed files ── */}
          {unstagedFiles.length > 0 && (
            <div className="git-section">
              <div className="git-section-header">
                <span className="git-section-label">Changes</span>
                <button className="git-action-btn" onClick={handleStageAll} disabled={busy}>
                  Stage all
                </button>
              </div>
              {unstagedFiles.map((file) => (
                <GitFileRow
                  key={file}
                  file={file}
                  folderPath={folderPath}
                  staged={false}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                />
              ))}
            </div>
          )}

          {/* ── Untracked files ── */}
          {gitStatus.untrackedFiles.length > 0 && (
            <div className="git-section">
              <div className="git-section-header">
                <span className="git-section-label">Untracked</span>
                <button className="git-action-btn" onClick={handleStageAll} disabled={busy}>
                  Stage all
                </button>
              </div>
              {gitStatus.untrackedFiles.map((file) => (
                <div key={file} className="git-file-row">
                  <div className="git-file-main">
                    <span className="git-file-icon">❓</span>
                    <span className="git-file-name">{file}</span>
                    <div className="git-file-actions">
                      <button className="git-file-btn stage" onClick={() => handleStage(file)}>+</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Staged files ── */}
          {gitStatus.stagedFiles.length > 0 && (
            <div className="git-section">
              <div className="git-section-header">
                <span className="git-section-label">Staged</span>
              </div>
              {gitStatus.stagedFiles.map((file) => (
                <GitFileRow
                  key={file}
                  file={file}
                  folderPath={folderPath}
                  staged
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                />
              ))}
            </div>
          )}

          {/* ── Commit area ── */}
          <div className="git-commit-area">
            <textarea
              className="git-commit-input"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              placeholder="Commit message…"
              rows={2}
            />
            <div className="git-commit-actions">
              <button
                className="git-commit-btn"
                onClick={handleCommit}
                disabled={busy || !gitStatus.stagedFiles.length}
              >
                Commit
              </button>
              <button
                className="git-commit-btn primary"
                onClick={handleCommitAndPush}
                disabled={busy || !gitStatus.stagedFiles.length}
              >
                Commit & Push
              </button>
              <button
                className="git-commit-btn"
                onClick={handlePush}
                disabled={busy}
              >
                Push
              </button>
              <button
                className="git-refresh-btn"
                onClick={onRefresh}
                disabled={busy}
                title="Refresh git status"
              >
                ↺
              </button>
            </div>

            {opStatus && (
              <div className={`git-op-result ${opStatus.ok ? 'ok' : 'error'}`}>
                {opStatus.ok ? '✅' : '⚠️'} {opStatus.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
