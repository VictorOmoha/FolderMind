import type { TaskSidebarProps, TaskRunSectionsProps, PlanSnapshotListProps, ActivityLogListProps } from './chatPanelTypes'
import { formatDuration } from './chatPanelUtils'

function TaskRunSections({ run }: TaskRunSectionsProps) {
  const planSnapshots = run.planSnapshots || []
  const activityLog = run.activityLog || []

  return (
    <>
      {run.filesTouched && run.filesTouched.length > 0 && <div className="task-run-section"><div className="task-run-label">Files touched</div><ul>{run.filesTouched.map((file) => <li key={file}>{file}</li>)}</ul></div>}
      {run.commands && run.commands.length > 0 && <div className="task-run-section"><div className="task-run-label">Commands</div><ul>{run.commands.map((command) => <li key={command}><code>{command}</code></li>)}</ul></div>}
      {run.trace && run.trace.length > 0 && <div className="task-run-section"><div className="task-run-label">Execution trace</div><ul>{run.trace.slice(-12).map((entry, index) => <li key={`${entry.ts}-${index}`}>{entry.detail}</li>)}</ul></div>}
      {planSnapshots.length > 0 && <PlanSnapshotList snapshots={planSnapshots} />}
      {activityLog.length > 0 && <ActivityLogList entries={activityLog} />}
    </>
  )
}

function PlanSnapshotList({ snapshots }: PlanSnapshotListProps) {
  return (
    <div className="task-run-section">
      <div className="task-run-label">Plan snapshots</div>
      <ul>
        {snapshots.slice(-4).map((snapshot, index) => (
          <li key={`${snapshot.ts}-${index}`}>
            <strong>{snapshot.goal}</strong>
            <ul>
              {snapshot.steps.map((step) => <li key={step.id}>{step.status}: {step.text}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActivityLogList({ entries }: ActivityLogListProps) {
  return (
    <div className="task-run-section">
      <div className="task-run-label">Activity log</div>
      <ul>
        {entries.slice(-10).map((entry, index) => <li key={`${entry.ts}-${index}`}>{entry.kind}: {entry.message}</li>)}
      </ul>
    </div>
  )
}

export function TaskSidebar({
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
      <section className="agent-card">
        <h3>Tasks</h3>
        <div className="task-create-row"><input className="task-input" value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="Add a task..." /><button className="btn-primary" onClick={submitTask}>Add</button></div>
        <div className="task-list">
          {tasks.length === 0 ? <p className="muted">No tasks yet.</p> : tasks.slice(0, 8).map((task) => (
            <div key={task.id} className={`task-item ${task.status} ${selectedTaskId === task.id ? 'selected' : ''}`} onClick={() => setSelectedTaskId(task.id)}>
              <div className="task-main">
                {editingTaskId === task.id ? (
                  <div className="task-edit-row" onClick={(e) => e.stopPropagation()}>
                    <input className="task-input" value={editingTaskText} onChange={(e) => setEditingTaskText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void commitTaskEdit(task) }} autoFocus />
                    <div className="task-inline-actions">
                      <button className="btn-ghost-inline" onClick={() => void commitTaskEdit(task)}>Save</button>
                      <button className="btn-ghost-inline danger" onClick={cancelTaskEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <label><input type="checkbox" checked={task.status === 'done'} onChange={() => onToggleTask(task)} /><span>{task.text}</span></label>
                )}
                {task.runs && task.runs.length > 0 && <div className="task-run-meta">Last run: {task.runs[0].status}{task.runs[0].summary ? ` · ${task.runs[0].summary.slice(0, 80)}` : ''}</div>}
              </div>
              <div className="task-actions"><button className="btn-ghost-inline" onClick={(e) => { e.stopPropagation(); startEditingTask(task) }}>Edit</button><button className="btn-ghost-inline" onClick={(e) => { e.stopPropagation(); void onRunTask(task) }} disabled={!hasApiKey}>Run</button><button className="btn-ghost-inline danger" onClick={(e) => { e.stopPropagation(); onDeleteTask(task.id) }}>Delete</button></div>
            </div>
          ))}
        </div>
      </section>

      <section className="agent-card">
        <h3>Task Details</h3>
        {!selectedTask ? <p className="muted">Select a task to inspect its run history.</p> : (
          <div className="task-detail">
            <div className="task-detail-title">{selectedTask.text}</div>
            <div className="task-detail-status">Status: {selectedTask.status}</div>
            <div className="task-detail-metrics">
              <span className="task-metric success">{completedRuns} completed</span>
              <span className="task-metric failure">{failedRuns} failed</span>
              <span className="task-metric neutral">{selectedTask.runs?.length || 0} total runs</span>
            </div>
            <div className="task-run-list">
              {selectedTask.runs && selectedTask.runs.length > 0 ? selectedTask.runs.map((run) => (
                <div key={run.id} className={`task-run-card ${run.status}`}>
                  <div className="task-run-head"><span>{run.status} · {new Date(run.startedAt).toLocaleString()}</span><span className={`task-run-badge ${run.status}`}>{run.status}</span></div>
                  <div className="task-run-subhead">Duration: {formatDuration(run.durationMs)}{run.completedAt ? ` · Finished ${new Date(run.completedAt).toLocaleTimeString()}` : ''}</div>
                  {run.summary && <div className="task-run-summary">{run.summary}</div>}
                  <TaskRunSections run={run} />
                </div>
              )) : <p className="muted">No runs yet.</p>}
            </div>
          </div>
        )}
      </section>
    </>
  )
}
