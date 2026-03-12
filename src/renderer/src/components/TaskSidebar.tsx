import { useState } from 'react'
import type { TaskItem, TaskRun } from '../../../src/vite-env'
import type { TaskSidebarProps, TaskRunSectionsProps, PlanSnapshotListProps, ActivityLogListProps } from './chatPanelTypes'
import { formatDuration } from './chatPanelUtils'
import { DiffViewer } from './DiffViewer'
import styles from './TaskSidebar.module.css'

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
    <li className={`${styles.fileItem}${dim ? ` ${styles.dim}` : ''}`} title={`Open ${file} in Explorer`}>
      <span className={styles.fileIcon}>{fileIcon(file)}</span>
      <button className={styles.filePathBtn} onClick={handleOpen}>
        {file}
      </button>
      {badge && <span className={styles.fileBadge}>{badge}</span>}
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
        <div className={styles.runSection}>
          <div className={styles.runLabel}>
            File changes
            <span className={styles.runLabelCount}>{fileEdits.length}</span>
          </div>
          <div className={styles.runDiffs}>
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
        <div className={styles.runSection}>
          <div className={styles.runLabel}>
            Files touched
            <span className={styles.runLabelCount}>{run.filesTouched.length}</span>
          </div>
          <ul className={styles.fileList}>
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
        <div className={styles.runSection}>
          <div className={styles.runLabel}>Commands</div>
          <ul className={styles.fileList}>{run.commands.map((cmd) => <li key={cmd} className={styles.fileItem}><code>{cmd}</code></li>)}</ul>
        </div>
      )}

      {/* ── Execution trace (non-diff entries) ── */}
      {plainTrace.length > 0 && (
        <div className={styles.runSection}>
          <div className={styles.runLabel}>Execution trace</div>
          <ul className={styles.fileList}>
            {plainTrace.slice(-12).map((entry, index) => (
              <li key={`${entry.ts}-${index}`} className={styles.fileItem}>{entry.detail}</li>
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
    <div className={styles.runSection}>
      <div className={styles.runLabel}>Plan snapshots</div>
      <ul className={styles.fileList}>
        {snapshots.slice(-4).map((snapshot, index) => (
          <li key={`${snapshot.ts}-${index}`} className={styles.fileItem} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <strong>{snapshot.goal}</strong>
            <ul className={styles.fileList} style={{ marginTop: '4px', width: '100%' }}>
              {snapshot.steps.map((step) => (
                <li key={step.id} className={styles.fileItem}>{step.status}: {step.text}</li>
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
    <div className={styles.runSection}>
      <div className={styles.runLabel}>Activity log</div>
      <ul className={styles.fileList}>
        {entries.slice(-10).map((entry, index) => (
          <li key={`${entry.ts}-${index}`} className={styles.fileItem}>{entry.kind}: {entry.message}</li>
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
    <div className={styles.footprint}>
      <div className={styles.footprintHeader}>
        <span className={styles.footprintTitle}>Task footprint</span>
        <span className={styles.runLabelCount}>{files.length} file{files.length !== 1 ? 's' : ''}</span>
      </div>
      <ul className={styles.fileList}>
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
        <button className={styles.footprintMore} onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show less' : `+${files.length - 6} more files`}
        </button>
      )}
    </div>
  )
}

function taskStatusLabel(task: TaskItem) {
  if (task.status === 'suggested') return 'suggested'
  return task.status
}

function taskSourceLabel(task: TaskItem) {
  return task.source === 'agent' ? 'agent' : 'user'
}

function formatArchivedChainLabel(task: TaskItem) {
  return task.archivedFromJobId ? `Archived from resolved chain ${task.archivedFromJobId}.` : null
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
  onSelectJob,
  jobs,
  hasApiKey,
}: TaskSidebarProps) {
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || null
  const originatingJob = selectedTask?.suggestedByJobId ? jobs.find((job) => job.id === selectedTask.suggestedByJobId) || null : null
  const archivedChainLabel = selectedTask ? formatArchivedChainLabel(selectedTask) : null
  const completedRuns = selectedTask?.runs?.filter((run) => run.status === 'completed').length || 0
  const failedRuns = selectedTask?.runs?.filter((run) => run.status === 'failed').length || 0

  return (
    <>
      {/* ── Task list ── */}
      <section className="agent-card">
        <h3>Tasks</h3>
        <div className={styles.createRow}>
          <input
            className={styles.input}
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder="Add a task..."
          />
          <button className="btn-primary" onClick={submitTask}>Add</button>
        </div>
        <div className={styles.list}>
          {tasks.length === 0 ? (
            <p className="muted">No tasks yet.</p>
          ) : (
            tasks.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className={`${styles.item} ${styles[task.status] || ''} ${selectedTaskId === task.id ? styles.selected : ''}`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                <div className={styles.main}>
                  {editingTaskId === task.id ? (
                    <div className={styles.editRow} onClick={(e) => e.stopPropagation()}>
                      <input
                        className={styles.input}
                        value={editingTaskText}
                        onChange={(e) => setEditingTaskText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void commitTaskEdit(task) }}
                        autoFocus
                      />
                      <div className={styles.actions}>
                        <button className={styles.btnGhost} onClick={() => void commitTaskEdit(task)}>Save</button>
                        <button className={`${styles.btnGhost} ${styles.danger}`} onClick={cancelTaskEdit}>Cancel</button>
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
                  <div className={styles.runMeta}>
                    {taskStatusLabel(task)} · {taskSourceLabel(task)}
                    {task.status === 'suggested' ? ' · review before running' : ''}
                  </div>
                  {task.runs && task.runs.length > 0 && (
                    <div className={styles.runMeta}>
                      Last run: {task.runs[0].status}
                      {task.runs[0].summary ? ` · ${task.runs[0].summary.slice(0, 80)}` : ''}
                    </div>
                  )}
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.btnGhost}
                    onClick={(e) => { e.stopPropagation(); startEditingTask(task) }}
                  >Edit</button>
                  {task.status === 'suggested' && (
                    <button
                      className={styles.btnGhost}
                      onClick={(e) => { e.stopPropagation(); onToggleTask(task) }}
                    >Accept</button>
                  )}
                  <button
                    className={styles.btnGhost}
                    onClick={(e) => { e.stopPropagation(); void onRunTask(task) }}
                    disabled={!hasApiKey || task.status === 'suggested'}
                  >Run</button>
                  <button
                    className={`${styles.btnGhost} ${styles.danger}`}
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
          <div className={styles.detail}>
            <div className={styles.detailTitle}>{selectedTask.text}</div>
            <div className={styles.detailStatus}>Status: {selectedTask.status} · {taskSourceLabel(selectedTask)}</div>
            {selectedTask.status === 'suggested' && <div className={styles.runSummary}>This task was suggested by the agent. Accept it before running, or delete it to dismiss the suggestion.</div>}
            {originatingJob && (
              <div className={styles.runSummary}>
                Originating job: {originatingJob.title}
                {onSelectJob && <button className={styles.btnGhost} onClick={() => onSelectJob(originatingJob.id)}>Open Job</button>}
              </div>
            )}
            {!originatingJob && archivedChainLabel && (
              <div className={styles.runSummary}>{archivedChainLabel}</div>
            )}

            <div className={styles.metrics}>
              <span className={`${styles.metric} ${styles.success}`}>{completedRuns} completed</span>
              <span className={`${styles.metric} ${styles.failure}`}>{failedRuns} failed</span>
              <span className={`${styles.metric} ${styles.neutral}`}>{selectedTask.runs?.length || 0} total runs</span>
            </div>

            {/* ── Task footprint (aggregate across all runs) ── */}
            <TaskFootprint task={selectedTask} folderPath={folderPath} />

            {/* ── Per-run cards ── */}
            <div className={styles.runList}>
              {selectedTask.runs && selectedTask.runs.length > 0 ? (
                selectedTask.runs.map((run) => (
                  <div key={run.id} className={`${styles.runCard} ${styles[run.status] || ''}`}>
                    <div className={styles.runHead}>
                      <span>{run.status} · {new Date(run.startedAt).toLocaleString()}</span>
                      <span className={`${styles.runBadge} ${styles[run.status] || ''}`}>{run.status}</span>
                    </div>
                    <div className={styles.runSubhead}>
                      Duration: {formatDuration(run.durationMs)}
                      {run.completedAt ? ` · Finished ${new Date(run.completedAt).toLocaleTimeString()}` : ''}
                    </div>
                    {run.summary && <div className={styles.runSummary}>{run.summary}</div>}
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
