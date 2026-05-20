import { useEffect, useMemo, useState } from 'react'
import type { AgentJob, AgentRuntimeEvent, TaskItem } from '../../../vite-env'
import styles from './AgentInbox.module.css'

interface Props {
  jobs: AgentJob[]
  events: AgentRuntimeEvent[]
  tasks: TaskItem[]
  selectedJobId?: string | null
  onSelectJob?: (jobId: string | null) => void
  onRunNow: () => Promise<void>
  onApproveJob: (jobId: string) => Promise<void>
  onRetryJob: (jobId: string) => Promise<void>
  onDismissJob: (jobId: string, reason?: string) => Promise<void>
  onCreateTask: (text: string) => Promise<void>
  onOpenTask: (taskId: string) => void
}

interface StructuredPanel {
  title: string
  body: string
  taskText?: string
  copyValue?: string
}

type InboxFilter = 'all' | 'needs_action' | 'history'

function statusLabel(job: AgentJob) {
  if (job.status === 'completed' && job.completedAt) return `completed ${new Date(job.completedAt).toLocaleTimeString()}`
  if (job.status === 'dismissed') return 'dismissed'
  if (job.status === 'running') return 'running'
  if (job.status === 'queued') return 'queued'
  if (job.status === 'blocked' && job.cooldownUntil && job.cooldownUntil > Date.now()) return 'cooldown'
  if (job.status === 'blocked') return job.approvalRequired && !job.approved ? 'awaiting approval' : 'blocked'
  return 'failed'
}

function kindLabel(kind: AgentJob['kind']) {
  if (kind === 'diff_summary') return 'Diff summary'
  if (kind === 'test_run') return 'Verification'
  if (kind === 'docs_drift') return 'Docs drift'
  if (kind === 'commit_prep') return 'Commit prep'
  return 'Review'
}

function promptForReason(defaultReason: string) {
  const nextReason = window.prompt('Reason', defaultReason)
  if (nextReason === null) return null
  return nextReason.trim() || defaultReason
}

function extractSection(result: string | undefined, title: string) {
  if (!result) return null
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\n)#+\\s*${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n#+\\s|$)`, 'i')
  const match = result.match(pattern)
  return match?.[1]?.trim() || null
}

function extractCommitMessage(result: string | undefined, structuredResult?: AgentJob['structuredResult']) {
  if (structuredResult?.commitMessage) return structuredResult.commitMessage
  if (!result) return null
  const headingMatch = extractSection(result, 'Commit Message')
  if (headingMatch) return headingMatch.split('\n').find(Boolean)?.replace(/^[-*]\s*/, '').trim() || null
  const lineMatch = result.match(/(?:^|\n)Commit Message:\s*([^\n]+)/i)
  return lineMatch?.[1]?.trim() || null
}

function buildTaskFromJob(job: AgentJob) {
  const commitMessage = extractCommitMessage(job.result, job.structuredResult)
  if (job.kind === 'commit_prep' && commitMessage) return `Review and use proposed commit message: ${commitMessage}`
  if (job.kind === 'docs_drift') return `Review documentation drift findings for ${job.filePaths[0] || 'recent changes'} and update docs if needed.`
  if (job.kind === 'diff_summary') return `Review diff summary findings and decide the next code or docs change.`
  return `Follow up on agent job: ${job.title}`
}

function isActionable(job: AgentJob) {
  if (job.chainResolvedAt) return false
  if (job.acknowledgedAt) return false
  if (job.needsAttention) return true
  return !!(job.structuredResult?.nextActions || job.structuredResult?.findings || job.structuredResult?.risks)
}

function filterLabel(filter: InboxFilter) {
  if (filter === 'needs_action') return 'Needs Action'
  if (filter === 'history') return 'History'
  return 'All'
}

function getJobPriority(job: AgentJob) {
  if (job.status === 'running') return 500000 + job.updatedAt
  if (job.status === 'blocked') return 400000 + job.updatedAt
  if (job.status === 'failed') return 350000 + job.updatedAt
  if (job.status === 'queued') return 300000 + job.updatedAt
  if (job.status === 'completed' && isActionable(job)) return 250000 + job.updatedAt
  return job.updatedAt
}

function planProgress(job: AgentJob) {
  const steps = job.planSteps || []
  const done = steps.filter((step) => step.status === 'done').length
  return steps.length > 0 ? `${done}/${steps.length} steps` : null
}

function isResolvedChainRoot(job: AgentJob) {
  return !!job.chainResolvedAt && (!job.rootJobId || job.rootJobId === job.id)
}

function structuredPanels(job: AgentJob): StructuredPanel[] {
  const panels: StructuredPanel[] = []
  if (!job.result) return panels

  const commitMessage = extractCommitMessage(job.result, job.structuredResult)
  const summary = job.structuredResult?.summary || extractSection(job.result, 'Summary')
  const risks = job.structuredResult?.risks || extractSection(job.result, 'Risks')
  const findings = job.structuredResult?.findings || extractSection(job.result, 'Findings')
  const actions = job.structuredResult?.nextActions || extractSection(job.result, 'Recommended Actions') || extractSection(job.result, 'Next Actions')

  if (job.kind === 'commit_prep' && commitMessage) {
    panels.push({
      title: 'Commit Message',
      body: commitMessage,
      taskText: `Review and use proposed commit message: ${commitMessage}`,
      copyValue: commitMessage,
    })
  }
  if (summary) panels.push({ title: 'Summary', body: summary })
  if (risks) panels.push({ title: 'Risks', body: risks, taskText: `Review risks from ${job.title}: ${risks.split('\n')[0]}` })
  if (job.kind === 'docs_drift' && findings) {
    panels.push({
      title: 'Findings',
      body: findings,
      taskText: `Resolve documentation drift: ${findings.split('\n')[0]}`,
    })
  }
  if (actions) {
    panels.push({
      title: 'Next Actions',
      body: actions,
      taskText: `Follow next actions from ${job.title}: ${actions.split('\n')[0]}`,
    })
  }

  return panels
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) return
  await navigator.clipboard.writeText(value)
}

function eventLevelLabel(level: AgentRuntimeEvent['level']) {
  return level === 'error' ? 'error' : level === 'warn' ? 'warning' : 'info'
}

export function AgentInbox({ jobs, events, tasks, selectedJobId: controlledSelectedJobId, onSelectJob, onRunNow, onApproveJob, onRetryJob, onDismissJob, onCreateTask, onOpenTask }: Props) {
  const [internalSelectedJobId, setInternalSelectedJobId] = useState<string | null>(null)
  const [filter, setFilter] = useState<InboxFilter>('needs_action')
  const [expanded, setExpanded] = useState(false)
  const { filteredJobs, archivedRoots } = useMemo(() => {
    const sorted = [...jobs].sort((left, right) => getJobPriority(right) - getJobPriority(left))
    const resolvedRootIds = new Set(sorted.filter(isResolvedChainRoot).map((job) => job.id))
    const archived = sorted.filter(isResolvedChainRoot).slice(0, 6)
    const liveJobs = sorted.filter((job) => !job.chainResolvedAt && (!job.rootJobId || !resolvedRootIds.has(job.rootJobId) || job.rootJobId === job.id))
    if (filter === 'needs_action') {
      const actionable = liveJobs.filter((job) => job.status !== 'dismissed' && (job.status !== 'completed' || isActionable(job)))
      return { filteredJobs: actionable.slice(0, 8), archivedRoots: archived }
    }
    if (filter === 'history') {
      return { filteredJobs: liveJobs.filter((job) => job.status === 'completed' && !isActionable(job)).slice(0, 8), archivedRoots: archived }
    }
    return { filteredJobs: liveJobs.slice(0, 8), archivedRoots: archived }
  }, [filter, jobs])
  const selectedJobId = controlledSelectedJobId ?? internalSelectedJobId
  const setSelectedJobId: (jobId: string | null) => void = onSelectJob ?? setInternalSelectedJobId
  const selectableJobs = useMemo(() => [...filteredJobs, ...archivedRoots], [archivedRoots, filteredJobs])
  const selectedJob = useMemo(() => selectableJobs.find((job) => job.id === selectedJobId) || filteredJobs[0] || archivedRoots[0] || null, [selectedJobId, selectableJobs, filteredJobs, archivedRoots])
  const panels = selectedJob ? structuredPanels(selectedJob) : []
  const activeJobs = useMemo(() => jobs.filter((job) => !job.chainResolvedAt && job.status !== 'dismissed'), [jobs])
  const needsActionCount = useMemo(() => activeJobs.filter((job) => job.status === 'blocked' || job.status === 'failed' || isActionable(job)).length, [activeJobs])
  const runningCount = useMemo(() => activeJobs.filter((job) => job.status === 'running' || job.status === 'queued').length, [activeJobs])
  const linkedSuggestedTask = useMemo(() => {
    if (!selectedJob) return null
    return tasks.find((task) => task.suggestedByJobId === selectedJob.id) || (selectedJob.relatedTaskId ? tasks.find((task) => task.id === selectedJob.relatedTaskId) || null : null)
  }, [selectedJob, tasks])
  const relevantEvents = useMemo(() => {
    if (!selectedJob) return events.slice(0, 8)
    return events.filter((event) => event.jobId === selectedJob.id || event.rootJobId === (selectedJob.rootJobId || selectedJob.id)).slice(0, 8)
  }, [events, selectedJob])

  useEffect(() => {
    if (!selectedJob && filter !== 'all') {
      setFilter('all')
      return
    }
    if (selectedJob?.id !== selectedJobId) {
      setSelectedJobId(selectedJob?.id || null)
    }
  }, [filter, selectedJob, selectedJobId, setSelectedJobId])

  return (
    <section className={`${styles.inbox} ${!expanded ? styles.collapsed : ''} agent-card`}>
      <div className={styles.header}>
        <div>
          <h3>Agent Inbox</h3>
          <p className="muted">
            {needsActionCount > 0
              ? `${needsActionCount} item${needsActionCount === 1 ? '' : 's'} need attention`
              : runningCount > 0
                ? `${runningCount} job${runningCount === 1 ? '' : 's'} running or queued`
                : 'No urgent background work.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn-secondary" onClick={() => void onRunNow()}>Run now</button>
          <button className="btn-secondary" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {expanded && (
        <>
          <div className={styles.filters}>
            {(['needs_action', 'all', 'history'] as InboxFilter[]).map((option) => (
              <button
                key={option}
                className={`btn-secondary ${filter === option ? 'active' : ''}`}
                onClick={() => setFilter(option)}
              >
                {filterLabel(option)}
              </button>
            ))}
          </div>

          {filteredJobs.length === 0 ? (
            <p className="muted">{filter === 'history' ? 'No completed history jobs yet.' : 'No autonomous jobs in this view yet.'}</p>
          ) : (
            <div className={styles.grid}>
          <div className={styles.jobList}>
            {filteredJobs.map((job) => (
              <button
                key={job.id}
                className={`${styles.job} ${styles[`job-${job.status}`] || ''} ${selectedJob?.id === job.id ? styles.selected : ''}`}
                onClick={() => setSelectedJobId(job.id)}
              >
                <div className={styles.jobTop}>
                  <strong>{job.title}</strong>
                  <span className={`${styles.jobStatus} ${styles[job.status] || ''}`}>{statusLabel(job)}</span>
                </div>
                <div className={styles.jobMeta}>{kindLabel(job.kind)} · {job.trigger}</div>
                <div className={styles.jobMeta}>attempts: {job.attemptCount || 0}</div>
                {planProgress(job) && <div className={styles.jobMeta}>{planProgress(job)}</div>}
                {job.summary && <div className={styles.jobSummary}>{job.summary}</div>}
                {job.command && <div className={styles.jobCommand}><code>{job.command}</code></div>}
              </button>
            ))}
            {archivedRoots.length > 0 && (
              <div className={styles.archive}>
                <div className={styles.archiveTitle}>Resolved Chains</div>
                {archivedRoots.map((job) => (
                  <button
                    key={job.id}
                    className={`${styles.job} ${styles.jobArchived} ${selectedJob?.id === job.id ? styles.selected : ''}`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div className={styles.jobTop}>
                      <strong>{job.title}</strong>
                      <span className={`${styles.jobStatus} ${styles.completed}`}>resolved</span>
                    </div>
                    <div className={styles.jobMeta}>{kindLabel(job.kind)} · root chain</div>
                    {job.chainResolutionReason && <div className={styles.jobSummary}>{job.chainResolutionReason}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedJob && (
            <div className={styles.jobDetail}>
              <div className={styles.jobDetailHead}>
                <strong>{selectedJob.title}</strong>
                <span className={`${styles.jobStatus} ${styles[selectedJob.status] || ''}`}>{statusLabel(selectedJob)}</span>
              </div>
              <div className={styles.jobMeta}>{kindLabel(selectedJob.kind)} · trigger: {selectedJob.trigger}</div>
              <div className={styles.jobMeta}>reason: {selectedJob.reason}</div>
              {selectedJob.attentionSummary && <div className={styles.jobMeta}>needs action: {selectedJob.attentionSummary}</div>}
              {selectedJob.checkpoint && <div className={styles.jobMeta}>checkpoint: {selectedJob.checkpoint.phase} · {selectedJob.checkpoint.summary}</div>}
              {planProgress(selectedJob) && <div className={styles.jobMeta}>progress: {planProgress(selectedJob)}</div>}
              {selectedJob.chainResolvedAt && <div className={styles.jobMeta}>chain resolved: {new Date(selectedJob.chainResolvedAt).toLocaleString()}</div>}
              {selectedJob.chainResolutionReason && <div className={styles.jobMeta}>chain reason: {selectedJob.chainResolutionReason}</div>}
              {selectedJob.acknowledgedAt && <div className={styles.jobMeta}>acknowledged: {new Date(selectedJob.acknowledgedAt).toLocaleString()}</div>}
              {selectedJob.acknowledgementReason && <div className={styles.jobMeta}>ack reason: {selectedJob.acknowledgementReason}</div>}
              <div className={styles.jobMeta}>attempts: {selectedJob.attemptCount || 0}</div>
              {selectedJob.rootJobId && <div className={styles.jobMeta}>root job: {selectedJob.rootJobId}</div>}
              {selectedJob.parentJobId && <div className={styles.jobMeta}>parent job: {selectedJob.parentJobId}</div>}
              {selectedJob.childJobIds && selectedJob.childJobIds.length > 0 && <div className={styles.jobMeta}>child jobs: {selectedJob.childJobIds.length}</div>}
              {selectedJob.lastAttemptAt && <div className={styles.jobMeta}>last attempt: {new Date(selectedJob.lastAttemptAt).toLocaleString()}</div>}
              {selectedJob.cooldownUntil && selectedJob.cooldownUntil > Date.now() && <div className={styles.jobMeta}>cooldown until: {new Date(selectedJob.cooldownUntil).toLocaleString()}</div>}
              {selectedJob.relatedTaskId && <div className={styles.jobMeta}>linked task: {selectedJob.relatedTaskId}</div>}
              {linkedSuggestedTask && <div className={styles.jobMeta}>task: {linkedSuggestedTask.text}</div>}
              {selectedJob.filePaths.length > 0 && <div className={styles.jobFiles}>{selectedJob.filePaths.join(', ')}</div>}
              {selectedJob.verificationStatus && <div className={`${styles.jobVerification} ${styles[selectedJob.verificationStatus] || ''}`}>verification: {selectedJob.verificationStatus}</div>}
              {selectedJob.command && <pre className={styles.jobCommandBlock}>{selectedJob.command}</pre>}
              {relevantEvents.length > 0 && (
                <div className={styles.panels}>
                  <section className={styles.panel}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Runtime Events</span>
                    </div>
                    <div className={styles.panelBody}>
                      {relevantEvents.map((event) => `[${eventLevelLabel(event.level)}] ${new Date(event.ts).toLocaleTimeString()} ${event.message}`).join('\n')}
                    </div>
                  </section>
                </div>
              )}
              {selectedJob.planSteps && selectedJob.planSteps.length > 0 && (
                <div className={styles.panels}>
                  <section className={styles.panel}>
                    <div className={styles.panelHead}>
                      <span className={styles.panelTitle}>Execution Plan</span>
                    </div>
                    <div className={styles.panelBody}>
                      {selectedJob.planSteps.map((step) => `${step.status === 'done' ? '[x]' : step.status === 'active' ? '[>]' : '[ ]'} ${step.label}`).join('\n')}
                    </div>
                  </section>
                </div>
              )}
              {selectedJob.stepArtifacts && selectedJob.stepArtifacts.length > 0 && (
                <div className={styles.panels}>
                  {selectedJob.stepArtifacts.map((artifact) => (
                    <section key={artifact.id} className={styles.panel}>
                      <div className={styles.panelHead}>
                        <span className={styles.panelTitle}>{artifact.title}</span>
                      </div>
                      <div className={styles.jobMeta}>{artifact.phase} · {new Date(artifact.createdAt).toLocaleTimeString()}</div>
                      <div className={styles.panelBody}>{artifact.body}</div>
                    </section>
                  ))}
                </div>
              )}
              {panels.length > 0 && (
                <div className={styles.panels}>
                  {panels.map((panel) => (
                    <section key={panel.title} className={styles.panel}>
                      <div className={styles.panelHead}>
                        <span className={styles.panelTitle}>{panel.title}</span>
                        <div className={styles.panelActions}>
                          {panel.copyValue && <button className="btn-secondary" onClick={() => void copyText(panel.copyValue!)}>Copy</button>}
                          {panel.taskText && <button className="btn-secondary" onClick={() => void onCreateTask(panel.taskText!)}>Task</button>}
                        </div>
                      </div>
                      <div className={styles.panelBody}>{panel.body}</div>
                    </section>
                  ))}
                </div>
              )}
              <div className={styles.jobActions}>
                {selectedJob.approvalRequired && !selectedJob.approved && selectedJob.status === 'blocked' && (
                  <button className="btn-primary" onClick={() => void onApproveJob(selectedJob.id)}>Approve And Run</button>
                )}
                {(selectedJob.status === 'failed' || selectedJob.status === 'blocked' || selectedJob.status === 'dismissed') && (
                  <button className="btn-secondary" onClick={() => void onRetryJob(selectedJob.id)}>Retry</button>
                )}
                {selectedJob.status === 'completed' && selectedJob.result && (
                  <button className="btn-secondary" onClick={() => void onCreateTask(buildTaskFromJob(selectedJob))}>Create Task</button>
                )}
                {linkedSuggestedTask && (
                  <button className="btn-secondary" onClick={() => onOpenTask(linkedSuggestedTask.id)}>Open Task</button>
                )}
                {selectedJob.status !== 'running' && selectedJob.status !== 'completed' && selectedJob.status !== 'dismissed' && (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      const reason = promptForReason('Skipped by user.')
                      if (reason !== null) void onDismissJob(selectedJob.id, reason)
                    }}
                  >
                    Skip
                  </button>
                )}
                {selectedJob.status !== 'dismissed' && selectedJob.status !== 'running' && (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      const reason = promptForReason('Dismissed by user.')
                      if (reason !== null) void onDismissJob(selectedJob.id, reason)
                    }}
                  >
                    Dismiss
                  </button>
                )}
              </div>
              {selectedJob.dismissalReason && <div className={styles.jobError}>{selectedJob.dismissalReason}</div>}
              {selectedJob.result && <pre className={styles.jobResult}>{selectedJob.result}</pre>}
              {selectedJob.error && !selectedJob.result && <div className={styles.jobError}>{selectedJob.error}</div>}
            </div>
          )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
