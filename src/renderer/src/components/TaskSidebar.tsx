import { useState } from 'react'
import type { TaskItem, TaskRun } from '../../../src/vite-env'
import type { TaskSidebarProps, TaskRunSectionsProps, PlanSnapshotListProps, ActivityLogListProps } from './chatPanelTypes'
import { formatDuration } from './chatPanelUtils'
import { DiffViewer } from './DiffViewer'

// ── File type icon helper ────────────────────────────────────────
function fileIcon(filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: '🔷', tsx: '⚛️', js: '🟡', jsx: '⚛️',
    css: '🎨', scss: '🎨', less: '🎨',
    html: '🌐', htm: '🌐',
    json: '📋', jsonc: '📋',
    md: '📝', mdx: '📝', txt: '📄',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🎭', ico: '🖼️', webp: '🖼️',
    env: '🔒', gitignore: '🚫', lock: '🔒',
    sh: '⚙️', ps1: '⚙️', bat: '⚙️',
    py: '🐍', rb: '💎', go: '🐹', rs: '🦀',
    yaml: '📐', yml: '📐', toml: '📐',
    sql: '🗃️', prisma: '🗃️',
  }
  return map[ext] ?? '📄'
}

// ── Aggregate all files touched across all runs of a task ────────
function aggregateFiles(runs: TaskRun[]): { file: string; runCount: number; hasDiff: boolean }[] {
  const map = new Map<string, { runCount: number; hasDiff: boolean }>()
  for (const run of runs) {
    const diffsInRun = new Set((run.trace || []).filter((t) => t.diff && t.file).map((t) => t.file!))
    for (const file of run.filesTouched || []) {
      const existing = map.get(file)
      if (existing) {
        existing.runCount++
        if (diffsInRun.has(file)) existing.hasDiff = true
      } else {
        map.set(file, { runCount: 1, hasDiff: diffsInRun.has(file) })
      }
    }
  }
  return Array.from(map.entries())
    .map(([file, meta]) => ({ file, ...meta }))
    .sort((a, b) => b.runCount - a.runCount)
}

// ── File item (shared between run-level and task-level) ──────────
function FileItem({
  file,
  folderPath,
  badge,
  dim,
}: {
  file: string
  folderPath: string
  badge?: string
  dim?: boolean
}) {
  const handleOpen = () => {
    window.foldermind.openInExplorer(folderPath, file)
  }

  return (
    <li className={`task-run-file-item${dim ? ' dim' : ''}`} title={`Open ${file} in Explorer`}>
      <span className="task-run-file-icon">{fileIcon(file)}</span>
      <button className="task-run-file-path-btn" onClick={handleOpen}>
        {file}
      </button>
      {badge && <span className="task-run-file-badge">{badge}</span>}
    </li>
  )
}

// ── Per-run sections ─────────────────────────────────────────────
function TaskRunSections({ run, folderPath }: TaskRunSectionsProps) {
  const planSnapshots = run.planSnapshots || []
  const activityLog = run.activityLog || []
  const fileEdits = (run.trace || []).filter((t) => t.diff)
  const plainTrace = (run.trace || []).filter((t) => !t.diff)

  // Build a lookup: which files in filesTouched have a diff in this run?
  const filesWithDiff = new Set(fileEdits.map((t) => t.file).filter(Boolean))

  return (
    <>
      {/* ── File Changes (diff viewer) ── */}
      {fileEdits.length > 0 && (
        <div className="task-run-section">
          <div className="task-run-label">
            File changes
            <span className="task-run-label-count">{fileEdits.length}</span>
          </div>
          <div className="task-run-diffs">
            {fileEdits.map((entry, index) => (
              <DiffViewer
                key={`${entry.ts}-${index}`}
                filepath={entry.file || entry.detail}
                diff={entry.diff!}
                label={entry.detail}
                defaultOpen={fileEdits.length === 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Files touched ── */}
      {run.filesTouched && run.filesTouched.length > 0 && (
        <div className="task-run-section">
          <div className="task-run-label">
            Files touched
            <span className="task-run-label-count">{run.filesTouched.length}</span>
          </div>
          <ul className="task-run-file-list">
            {run.filesTouched.map((file) => (
              <FileItem
                key={file}
                file={file}
                folderPath={folderPath}
                badge={filesWithDiff.has(file) ? 'diff' : undefined}
              />
            ))}
          </ul>
        </div>
      )}

      {/* ── Commands ── */}
      {run.commands && run.commands.length > 0 && (
        <div className="task-run-section">
          <div className="task-run-label">Commands</div>
          <ul>{run.commands.map((cmd) => <li key={cmd}><code>{cmd}</code></li>)}</ul>
        </div>
      )}

      {/* ── Execution trace (non-diff entries) ── */}
      {plainTrace.length > 0 && (
        <div className="task-run-section">
          <div className="task-run-label">Execution trace</div>
          <ul>
            {plainTrace.slice(-12).map((entry, index) => (
              <li key={`${entry.ts}-${index}`}>{entry.detail}</li>
            ))}
          </ul>
        </div>
      )}

      {planSnapshots.length > 0 && <PlanSnapshotList snapshots={planSnapshots} />}
      {activityLog.length > 0 && <ActivityLogList entries={activityLog} />}
    </>
  )
}

// ── Plan snapshots ───────────────────────────────────────────────
function PlanSnapshotList({ snapshots }: PlanSnapshotListProps) {
  return (
    <div className="task-run-section">
      <div className="task-run-label">Plan snapshots</div>
      <ul>
        {snapshots.slice(-4).map((snapshot, index) => (
          <li key={`${snapshot.ts}-${index}`}>
            <strong>{snapshot.goal}</strong>
            <ul>
              {snapshot.steps.map((step) => (
                <li key={step.id}>{step.status}: {step.text}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Activity log ─────────────────────────────────────────────────
function ActivityLogList({ entries }: ActivityLogListProps) {
  return (
    <div className="task-run-section">
      <div className="task-run-label">Activity log</div>
      <ul>
        {entries.slice(-10).map((entry, index) => (
          <li key={`${entry.ts}-${index}`}>{entry.kind}: {entry.message}</li>
        ))}
      </ul>
    </div>
  )
}

// ── Task footprint panel (aggregate across all runs) ─────────────
function TaskFootprint({ task, folderPath }: { task: TaskItem; folderPath: string }) {
  const [expanded, setExpanded] = useState(false)
  const files = aggregateFiles(task.runs || [])
  if (files.length === 0) return null

  const visible = expanded ? files : files.slice(0, 6)
  const hasMore = files.length > 6

  return (
    <div className="task-footprint">
      <div className="task-footprint-header">
        <span className="task-footprint-title">Task footprint</span>
        <span className="task-run-label-count">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      </div>
      <ul className="task-run-file-list">
        {visible.map(({ file, runCount, hasDiff }) => (
          <FileItem
            key={file}
            file={file}
            folderPath={folderPath}
            badge={hasDiff ? 'diff' : runCount > 1 ? `×${runCount}` : undefined}
          />
        ))}
      </ul>
      {hasMore && (
        <button className="task-footprint-more" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `+${files.length - 6} more files`}
        </button>
      )}
    </div>
  )
}

// ── Main TaskSidebar ─────────────────────────────────────────────
export function TaskSidebar({
  folderPath,
  tasks,
  selectedTaskId,
  setSelectedTaskId,
  editingTaskId,
  editingTaskText,
  setEditingTaskText,
  startEditingTask,
  commitTaskEdit,
  cancelTaskEdit,
  submitTask,
  taskInput,
  setTaskInput,
  onToggleTask,
  onDeleteTask,
  onRunTask,
  hasApiKey,
}: TaskSidebarProps) {
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null
  const completedRuns = selectedTask?.runs?.filter((run) => run.status === 'completed').length || 0
  const failedRuns = selectedTask?.runs?.filter((run) => run.status === 'failed').length || 0

  return (
    <>
      {/* ── Task list ── */}
      <section className="agent-card">
        <h3>Tasks</h3>
        <div className="task-create-row">
          <input
            className="task-input"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder="Add a task..."
          />
          <button className="btn-primary" onClick={submitTask}>Add</button>
        </div>
        <div className="task-list">
          {tasks.length === 0 ? (
            <p className="muted">No tasks yet.</p>
          ) : (
            tasks.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className={`task-item ${task.status} ${selectedTaskId === task.id ? 'selected' : ''}`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className="task-main">
                  {editingTaskId === task.id ? (
                    <div className="task-edit-row" onClick={(e) => e.stopPropagation()}>
                      <input
                        className="task-input"
                        value={editingTaskText}
                        onChange={(e) => setEditingTaskText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void commitTaskEdit(task) }}
                        autoFocus
                      />
                      <div className="task-inline-actions">
                        <button className="btn-ghost-inline" onClick={() => void commitTaskEdit(task)}>Save</button>
                        <button className="btn-ghost-inline danger" onClick={cancelTaskEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={task.status === 'done'}
                        onChange={() => onToggleTask(task)}
                      />
                      <span>{task.text}</span>
                    </label>
                  )}
                  {task.runs && task.runs.length > 0 && (
                    <div className="task-run-meta">
                      Last run: {task.runs[0].status}
                      {task.runs[0].summary ? ` · ${task.runs[0].summary.slice(0, 80)}` : ''}
                    </div>
                  )}
                </div>
                <div className="task-actions">
                  <button
                    className="btn-ghost-inline"
                    onClick={(e) => { e.stopPropagation(); startEditingTask(task) }}
                  >Edit</button>
                  <button
                    className="btn-ghost-inline"
                    onClick={(e) => { e.stopPropagation(); void onRunTask(task) }}
                    disabled={!hasApiKey}
                  >Run</button>
                  <button
                    className="btn-ghost-inline danger"
                    onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id) }}
                  >Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Task Details ── */}
      <section className="agent-card">
        <h3>Task Details</h3>
        {!selectedTask ? (
          <p className="muted">Select a task to inspect its run history.</p>
        ) : (
          <div className="task-detail">
            <div className="task-detail-title">{selectedTask.text}</div>
            <div className="task-detail-status">Status: {selectedTask.status}</div>

            <div className="task-detail-metrics">
              <span className="task-metric success">{completedRuns} completed</span>
              <span className="task-metric failure">{failedRuns} failed</span>
              <span className="task-metric neutral">{selectedTask.runs?.length || 0} total runs</span>
            </div>

            {/* ── Task footprint (aggregate across all runs) ── */}
            <TaskFootprint task={selectedTask} folderPath={folderPath} />

            {/* ── Per-run cards ── */}
            <div className="task-run-list">
              {selectedTask.runs && selectedTask.runs.length > 0 ? (
                selectedTask.runs.map((run) => (
                  <div key={run.id} className={`task-run-card ${run.status}`}>
                    <div className="task-run-head">
                      <span>{run.status} · {new Date(run.startedAt).toLocaleString()}</span>
                      <span className={`task-run-badge ${run.status}`}>{run.status}</span>
                    </div>
                    <div className="task-run-subhead">
                      Duration: {formatDuration(run.durationMs)}
                      {run.completedAt ? ` · Finished ${new Date(run.completedAt).toLocaleTimeString()}` : ''}
                    </div>
                    {run.summary && <div className="task-run-summary">{run.summary}</div>}
                    <TaskRunSections run={run} folderPath={folderPath} />
                  </div>
                ))
              ) : (
                <p className="muted">No runs yet.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
