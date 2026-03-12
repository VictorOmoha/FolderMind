import { exec } from 'child_process'
import { existsSync } from 'fs'
import { basename, join, relative } from 'path'
import { promisify } from 'util'
import { hasApiKey } from './agent'
import { executeJob, queueConfiguredFollowUps } from './runtimeEngine'
import { detectTestCommand, findCommandRule, getRuntimePolicy } from './runtimePolicy'
import { updateIndexForFiles } from './ragIndexer'
import {
  applyCheckpoint,
  buildJobPlan,
  completeJobPlan,
  deriveAttentionState,
  deriveSuggestedTasks,
  parseStructuredResult,
  withStepArtifact,
} from './runtimeWorkflow'
import {
  AgentJob,
  AgentJobKind,
  AgentJobTrigger,
  FolderChangeEvent,
  REVIEW_DEBOUNCE_MS,
  RuntimeDeps,
  RuntimePolicy,
} from './runtimeTypes'
import {
  appendRuntimeEvent,
  ensureState,
  readJobs,
  saveAndEmit,
} from './runtimeState'

export type {
  AgentJob,
  AgentRuntimeEvent,
} from './runtimeTypes'

const execAsync = promisify(exec)
const pendingReviewTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingReviewChanges = new Map<string, FolderChangeEvent[]>()
const processingFolders = new Set<string>()

function isCodeLikeFile(filePath: string) {
  return /\.(ts|tsx|js|jsx|json|md|css|scss|html|yml|yaml|ps1|sh)$/i.test(filePath)
}

function hasAttemptsRemaining(job: AgentJob, policy: RuntimePolicy) {
  return (job.attemptCount || 0) < policy.maxJobAttempts
}

function isCoolingDown(job: AgentJob) {
  return typeof job.cooldownUntil === 'number' && job.cooldownUntil > Date.now()
}

function getCooldownSummary(job: AgentJob) {
  if (!job.cooldownUntil || job.cooldownUntil <= Date.now()) return null
  const remainingMs = job.cooldownUntil - Date.now()
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000))
  return `Retry cooldown active for ${remainingMinutes} more minute${remainingMinutes === 1 ? '' : 's'}.`
}

function getRetryCooldownMs(policy: RuntimePolicy) {
  return Math.max(0, policy.retryCooldownMinutes) * 60 * 1000
}

function createJob(kind: AgentJobKind, trigger: AgentJobTrigger, title: string, reason: string, filePaths: string[], extras?: Partial<AgentJob>): AgentJob {
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    status: kind === 'test_run' ? 'blocked' : 'queued',
    title,
    trigger,
    reason,
    rootJobId: undefined,
    parentJobId: undefined,
    childJobIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptCount: 0,
    cooldownUntil: undefined,
    filePaths,
    planSteps: buildJobPlan(kind),
    activeStepId: undefined,
    checkpoint: undefined,
    stepArtifacts: [],
    executionState: undefined,
    verificationStatus: kind === 'test_run' ? 'pending' : undefined,
    approvalRequired: kind === 'test_run',
    approved: kind !== 'test_run',
    summary: kind === 'test_run' ? 'Waiting for approval before running verification.' : undefined,
    ...extras,
  }
}

function enqueueJob(jobs: AgentJob[], nextJob: AgentJob) {
  const existing = jobs.find((job) => job.kind === nextJob.kind && job.relatedTaskId === nextJob.relatedTaskId && (job.status === 'queued' || job.status === 'running' || job.status === 'blocked'))
  if (existing) {
    existing.filePaths = Array.from(new Set([...(existing.filePaths || []), ...nextJob.filePaths])).slice(0, 10)
    existing.updatedAt = Date.now()
    if (nextJob.command) existing.command = nextJob.command
    if (nextJob.commandTimeoutMs) existing.commandTimeoutMs = nextJob.commandTimeoutMs
    if (nextJob.summary) existing.summary = nextJob.summary
    existing.reason = nextJob.reason
    existing.rootJobId = existing.rootJobId || nextJob.rootJobId
    existing.parentJobId = existing.parentJobId || nextJob.parentJobId
    existing.childJobIds = Array.from(new Set([...(existing.childJobIds || []), ...(nextJob.childJobIds || [])]))
    return { jobs, jobId: existing.id }
  }
  return { jobs: [nextJob, ...jobs], jobId: nextJob.id }
}

function attachChildJob(jobs: AgentJob[], parentJobId: string | undefined, childJobId: string | undefined) {
  if (!parentJobId || !childJobId || parentJobId === childJobId) return jobs
  return jobs.map((job) => job.id === parentJobId ? { ...job, childJobIds: Array.from(new Set([...(job.childJobIds || []), childJobId])) } : job)
}

function assignRootJobId(jobs: AgentJob[], jobId: string | undefined) {
  if (!jobId) return jobs
  return jobs.map((job) => job.id === jobId ? { ...job, rootJobId: job.rootJobId || jobId } : job)
}

function isParentResolved(job: AgentJob, jobs: AgentJob[]) {
  if (!job.parentJobId) return true
  const parent = jobs.find((candidate) => candidate.id === job.parentJobId)
  if (!parent) return true
  return parent.status === 'completed' || parent.status === 'dismissed'
}

function getDependencySummary(job: AgentJob, jobs: AgentJob[]) {
  if (!job.parentJobId) return null
  const parent = jobs.find((candidate) => candidate.id === job.parentJobId)
  if (!parent) return null
  if (parent.status === 'completed' || parent.status === 'dismissed') return null
  return `Waiting for parent job ${parent.id} to finish.`
}


function isJobResolvedForChain(job: AgentJob) {
  if (job.status === 'queued' || job.status === 'running' || job.status === 'blocked' || job.status === 'failed') return false
  if (job.status === 'dismissed') return true
  if (job.acknowledgedAt) return true
  if (job.status === 'completed' && !job.needsAttention) return true
  return false
}

function reconcileChainResolution(jobs: AgentJob[], anchorJobId: string | undefined) {
  if (!anchorJobId) return jobs
  const anchor = jobs.find((job) => job.id === anchorJobId)
  const rootJobId = anchor?.rootJobId || anchor?.id
  if (!rootJobId) return jobs

  const chainJobs = jobs.filter((job) => (job.rootJobId || job.id) === rootJobId)
  if (chainJobs.length === 0) return jobs

  const resolved = chainJobs.every(isJobResolvedForChain)
  return jobs.map((job) => {
    if (job.id !== rootJobId) return job
    if (resolved) {
      return {
        ...job,
        chainResolvedAt: job.chainResolvedAt || Date.now(),
        chainResolutionReason: 'All jobs in this lineage are resolved or acknowledged.',
        needsAttention: false,
      }
    }
    if (!job.chainResolvedAt && !job.chainResolutionReason) return job
    return {
      ...job,
      chainResolvedAt: undefined,
      chainResolutionReason: undefined,
    }
  })
}
function queueChangeDrivenJobs(folderPath: string, changes: FolderChangeEvent[], deps: RuntimeDeps) {
  if (changes.length === 0) return
  const policy = getRuntimePolicy(folderPath, deps)
  if (!policy.allowBackgroundAgent) return

  let jobs = readJobs(folderPath)
  let rootJobId: string | undefined
  const relFiles = Array.from(new Set(changes.map((change) => relative(folderPath, change.filePath)).filter(Boolean))).slice(0, 10)
  
  if (relFiles.length > 0) {
    updateIndexForFiles(folderPath, relFiles).catch(err => {
      appendRuntimeEvent(folderPath, deps, { level: 'error', type: 'job_failed', jobId: 'index', rootJobId: 'index', message: `Background index update failed: ${err.message}` })
    })
  }

  const isGitFolder = existsSync(join(folderPath, '.git'))

  if (policy.autoRunFileReview) {
    const reviewJob = createJob(
      'file_review',
      'file_watcher',
      `Review ${relFiles.length === 1 ? basename(relFiles[0]) : `${relFiles.length} changed files`}`,
      'Triggered by recent file watcher activity.',
      relFiles,
      hasApiKey()
        ? { summary: 'Queued from recent workspace file activity.' }
        : { status: 'blocked', approved: false, summary: 'Waiting for an OpenAI API key before background review can run.', error: 'OpenAI API key is not set.' },
    )
    const queued = enqueueJob(jobs, reviewJob)
    jobs = assignRootJobId(queued.jobs, queued.jobId)
    rootJobId = queued.jobId
    appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_queued', jobId: queued.jobId, rootJobId: queued.jobId, message: `Queued file review for ${relFiles.length} changed file${relFiles.length === 1 ? '' : 's'}.` })
  }

  if (isGitFolder && policy.autoRunDiffSummary) {
    const diffJob = createJob(
      'diff_summary',
      'file_watcher',
      'Summarize current git diff',
      'Triggered by file watcher activity in a git workspace.',
      relFiles,
      hasApiKey()
        ? { summary: 'Queued to summarize current git changes.', rootJobId, parentJobId: rootJobId }
        : { status: 'blocked', approved: false, summary: 'Waiting for an OpenAI API key before diff summarization can run.', error: 'OpenAI API key is not set.', rootJobId, parentJobId: rootJobId },
    )
    const queued = enqueueJob(jobs, diffJob)
    jobs = queued.jobs
    if (rootJobId) jobs = attachChildJob(jobs, rootJobId, queued.jobId)
    else rootJobId = queued.jobId
    appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_queued', jobId: queued.jobId, rootJobId: rootJobId || queued.jobId, message: 'Queued diff summary from watcher activity.' })
  }

  if (policy.autoQueueTestRuns && relFiles.some(isCodeLikeFile)) {
    const command = detectTestCommand(folderPath)
    if (command) {
      const commandRule = findCommandRule(command, 'file_watcher', policy)
      if (commandRule) {
        const queued = enqueueJob(jobs, createJob('test_run', 'file_watcher', 'Run verification command', `Triggered by code-like file changes. Verification command: ${command}`, relFiles, {
          command,
          commandTimeoutMs: commandRule.timeoutMs,
          approvalRequired: commandRule.requiresApproval,
          approved: !commandRule.requiresApproval,
          status: commandRule.requiresApproval ? 'blocked' : 'queued',
          summary: commandRule.requiresApproval ? `Approval required before running: ${command}` : `Queued verification command: ${command}`,
          rootJobId,
          parentJobId: rootJobId,
        }))
        jobs = queued.jobs
        if (rootJobId) jobs = attachChildJob(jobs, rootJobId, queued.jobId)
        else rootJobId = queued.jobId
        appendRuntimeEvent(folderPath, deps, { level: commandRule.requiresApproval ? 'warn' : 'info', type: commandRule.requiresApproval ? 'job_blocked' : 'job_queued', jobId: queued.jobId, rootJobId: rootJobId || queued.jobId, message: commandRule.requiresApproval ? `Verification command awaiting approval: ${command}` : `Queued verification command: ${command}` })
      }
    }
  }

  saveAndEmit(folderPath, jobs, deps)
}

async function queueGitDrivenJobs(folderPath: string, deps: RuntimeDeps) {
  const policy = getRuntimePolicy(folderPath, deps)
  if (!policy.allowBackgroundAgent) return

  const git = await deps.getGitStatus(folderPath)
  if (!git.isRepo || git.changedFiles.length === 0) return

  let jobs = readJobs(folderPath)
  let rootJobId: string | undefined
  const trackedFiles = Array.from(new Set([...git.changedFiles, ...git.untrackedFiles])).slice(0, 10)

  if (policy.autoRunDiffSummary) {
    const diffNeedsQueue = !jobs.some((job) => job.kind === 'diff_summary' && !job.relatedTaskId && (job.status === 'queued' || job.status === 'running' || job.status === 'blocked'))
    if (diffNeedsQueue) {
      const queued = enqueueJob(jobs, createJob('diff_summary', 'git_state', 'Summarize current git diff', 'Triggered by dirty git state.', trackedFiles, hasApiKey() ? { summary: 'Queued from dirty git state.' } : { status: 'blocked', approved: false, summary: 'Waiting for an OpenAI API key before diff summarization can run.', error: 'OpenAI API key is not set.' }))
      jobs = assignRootJobId(queued.jobs, queued.jobId)
      rootJobId = queued.jobId
      appendRuntimeEvent(folderPath, deps, { level: hasApiKey() ? 'info' : 'warn', type: hasApiKey() ? 'job_queued' : 'job_blocked', jobId: queued.jobId, rootJobId: queued.jobId, message: hasApiKey() ? 'Queued diff summary from git state.' : 'Diff summary blocked until API key is available.' })
    }
  }

  if (policy.autoQueueTestRuns && trackedFiles.some(isCodeLikeFile)) {
    const testCommand = detectTestCommand(folderPath)
    const needsTest = testCommand && !jobs.some((job) => job.kind === 'test_run' && !job.relatedTaskId && (job.status === 'queued' || job.status === 'running' || job.status === 'blocked'))
    const commandRule = testCommand ? findCommandRule(testCommand, 'git_state', policy) : null
    if (needsTest && testCommand && commandRule) {
      const queued = enqueueJob(jobs, createJob('test_run', 'git_state', 'Run verification command', `Triggered by dirty git state. Verification command: ${testCommand}`, trackedFiles, {
        command: testCommand,
        commandTimeoutMs: commandRule.timeoutMs,
        approvalRequired: commandRule.requiresApproval,
        approved: !commandRule.requiresApproval,
        status: commandRule.requiresApproval ? 'blocked' : 'queued',
        summary: commandRule.requiresApproval ? `Approval required before running: ${testCommand}` : `Queued verification command: ${testCommand}`,
        rootJobId,
        parentJobId: rootJobId,
      }))
      jobs = queued.jobs
      if (rootJobId) jobs = attachChildJob(jobs, rootJobId, queued.jobId)
      else rootJobId = queued.jobId
      appendRuntimeEvent(folderPath, deps, { level: commandRule.requiresApproval ? 'warn' : 'info', type: commandRule.requiresApproval ? 'job_blocked' : 'job_queued', jobId: queued.jobId, rootJobId: rootJobId || queued.jobId, message: commandRule.requiresApproval ? `Verification command awaiting approval: ${testCommand}` : `Queued verification command from git state: ${testCommand}` })
    }
  }

  saveAndEmit(folderPath, jobs, deps)
}

function canRunJob(folderPath: string, job: AgentJob, deps: RuntimeDeps) {
  if (job.kind === 'test_run') {
    const policy = getRuntimePolicy(folderPath, deps)
    return !!job.command && !!job.approved && !!findCommandRule(job.command, job.trigger, policy)
  }
  return hasApiKey()
}

async function runNextJob(folderPath: string, deps: RuntimeDeps) {
  if (processingFolders.has(folderPath)) return
  const policy = getRuntimePolicy(folderPath, deps)
  const jobs = readJobs(folderPath)
  let updated = false

  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i]
    if (job.status === 'queued' && !hasAttemptsRemaining(job, policy)) {
      jobs[i] = {
        ...job,
        status: 'failed',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        cooldownUntil: undefined,
        summary: `Retry limit reached (${policy.maxJobAttempts} attempts).`,
        error: job.error || 'Job retry limit reached.',
      }
      updated = true
    }
  }

  let nextJobs = jobs
  if (updated) {
    saveAndEmit(folderPath, nextJobs, deps)
  }

  const dependencyAdjusted = nextJobs.map((job) => {
    if (job.status !== 'queued') return job
    const dependencySummary = getDependencySummary(job, nextJobs)
    if (!dependencySummary || job.summary === dependencySummary) return job
    return { ...job, summary: dependencySummary, updatedAt: Date.now() }
  })
  if (dependencyAdjusted.some((job, index) => job !== nextJobs[index])) {
    nextJobs = dependencyAdjusted
    saveAndEmit(folderPath, nextJobs, deps)
  } else {
    nextJobs = dependencyAdjusted
  }

  const nextIndex = nextJobs.findIndex((job) => job.status === 'queued' && hasAttemptsRemaining(job, policy) && !isCoolingDown(job) && isParentResolved(job, nextJobs))
  if (nextIndex === -1) {
    const nextCooldown = nextJobs
      .filter((job) => job.status === 'queued' && isCoolingDown(job) && typeof job.cooldownUntil === 'number')
      .map((job) => job.cooldownUntil)
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b)[0]
    if (typeof nextCooldown === 'number') {
      const delay = Math.max(250, nextCooldown - Date.now())
      setTimeout(() => { void runNextJob(folderPath, deps) }, delay)
    }
    return
  }

  if (!canRunJob(folderPath, nextJobs[nextIndex], deps)) {
    nextJobs[nextIndex] = {
      ...nextJobs[nextIndex],
      status: 'blocked',
      error: nextJobs[nextIndex].kind === 'test_run' ? undefined : 'OpenAI API key is not set.',
      summary: nextJobs[nextIndex].kind === 'test_run'
        ? `Approval required before running: ${nextJobs[nextIndex].command}`
        : `Waiting for an OpenAI API key before ${nextJobs[nextIndex].kind.replace('_', ' ')} can run.`,
      updatedAt: Date.now(),
    }
    saveAndEmit(folderPath, nextJobs, deps)
    return
  }

  processingFolders.add(folderPath)
  nextJobs[nextIndex] = {
    ...nextJobs[nextIndex],
    status: 'running',
    startedAt: nextJobs[nextIndex].startedAt || Date.now(),
    lastAttemptAt: Date.now(),
    attemptCount: (nextJobs[nextIndex].attemptCount || 0) + 1,
    cooldownUntil: undefined,
    updatedAt: Date.now(),
    error: undefined,
    summary: nextJobs[nextIndex].checkpoint?.summary || (nextJobs[nextIndex].kind === 'test_run' ? `Running verification command: ${nextJobs[nextIndex].command}` : 'Preparing job execution.'),
    planSteps: nextJobs[nextIndex].planSteps || buildJobPlan(nextJobs[nextIndex].kind),
  }
  saveAndEmit(folderPath, nextJobs, deps)
  appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_started', jobId: nextJobs[nextIndex].id, rootJobId: nextJobs[nextIndex].rootJobId || nextJobs[nextIndex].id, message: `Started ${nextJobs[nextIndex].title}.` })

  try {
    const execution = await executeJob(folderPath, nextJobs[nextIndex], deps, async (phase, summary, extras) => {
      const progressJobs = readJobs(folderPath)
      const progressIndex = progressJobs.findIndex((job) => job.id === nextJobs[nextIndex].id)
      if (progressIndex === -1) return
      const checkpointed = applyCheckpoint(progressJobs[progressIndex], phase, summary, extras)
      const artifacts = extras?.stepArtifacts || []
      progressJobs[progressIndex] = artifacts.reduce((currentJob, artifact) => withStepArtifact(currentJob, artifact.phase, artifact.title, artifact.body), checkpointed)
      saveAndEmit(folderPath, progressJobs, deps)
      appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_checkpoint', jobId: progressJobs[progressIndex].id, rootJobId: progressJobs[progressIndex].rootJobId || progressJobs[progressIndex].id, message: `${progressJobs[progressIndex].title}: ${summary}` })
    })
    const refreshedJobs = readJobs(folderPath)
    const jobIndex = refreshedJobs.findIndex((job) => job.id === nextJobs[nextIndex].id)
    if (jobIndex !== -1) {
      const structuredResult = parseStructuredResult(execution.result)
      const attentionState = deriveAttentionState(structuredResult)
      refreshedJobs[jobIndex] = {
        ...completeJobPlan(refreshedJobs[jobIndex]),
        status: 'completed',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        cooldownUntil: undefined,
        result: execution.result,
        structuredResult,
        needsAttention: attentionState.needsAttention,
        attentionSummary: attentionState.attentionSummary,
        summary: execution.summary,
        verificationStatus: execution.verificationStatus,
      }
      const reconciledJobs = reconcileChainResolution(refreshedJobs, refreshedJobs[jobIndex].id)
      saveAndEmit(folderPath, reconciledJobs, deps)
      const completedJob = reconciledJobs.find((job) => job.id === refreshedJobs[jobIndex].id) || refreshedJobs[jobIndex]
      appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_completed', jobId: completedJob.id, rootJobId: completedJob.rootJobId || completedJob.id, message: completedJob.summary || `${completedJob.title} completed.` })
      if (completedJob.kind === 'test_run' && completedJob.relatedTaskId && completedJob.verificationStatus === 'passed') {
        deps.onTaskVerified?.(folderPath, completedJob.relatedTaskId, execution.result)
      }
      const suggestedTasks = deriveSuggestedTasks(completedJob, policy)
      if (suggestedTasks.length > 0) {
        deps.onTasksSuggested?.(folderPath, completedJob, suggestedTasks)
      }
      void queueConfiguredFollowUps(folderPath, completedJob, deps, () => { void runNextJob(folderPath, deps) })
    }
  } catch (error) {
    const refreshedJobs = readJobs(folderPath)
    const jobIndex = refreshedJobs.findIndex((job) => job.id === nextJobs[nextIndex].id)
    if (jobIndex !== -1) {
      const failedJob = refreshedJobs[jobIndex]
      const attemptsRemaining = hasAttemptsRemaining(failedJob, policy)
      const cooldownUntil = attemptsRemaining ? Date.now() + getRetryCooldownMs(policy) : undefined
      const cooldownSummary = cooldownUntil ? getCooldownSummary({ ...failedJob, cooldownUntil }) : null
      refreshedJobs[jobIndex] = {
        ...failedJob,
        status: 'failed',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        cooldownUntil,
        error: error instanceof Error ? error.message : 'Job execution failed.',
        summary: attemptsRemaining
          ? `${failedJob.kind === 'test_run' ? 'Verification command failed.' : 'Background job failed.'} ${cooldownSummary || ''}`.trim()
          : `Retry limit reached (${policy.maxJobAttempts} attempts).`,
        activeStepId: failedJob.activeStepId,
        verificationStatus: failedJob.kind === 'test_run' ? 'failed' : failedJob.verificationStatus,
      }
      saveAndEmit(folderPath, reconcileChainResolution(refreshedJobs, failedJob.id), deps)
      appendRuntimeEvent(folderPath, deps, { level: 'error', type: 'job_failed', jobId: failedJob.id, rootJobId: failedJob.rootJobId || failedJob.id, message: refreshedJobs[jobIndex].summary || `${failedJob.title} failed.` })
    }
  } finally {
    processingFolders.delete(folderPath)
    const remaining = readJobs(folderPath).some((job) => job.status === 'queued')
    if (remaining) setTimeout(() => { void runNextJob(folderPath, deps) }, 0)
  }
}
function normalizeBlockedJobs(folderPath: string, deps: RuntimeDeps) {
  const jobs = readJobs(folderPath)
  const now = Date.now()
  const normalized = jobs.map((job) => {
    if (job.status === 'running') {
      appendRuntimeEvent(folderPath, deps, { level: 'warn', type: 'runtime_resume', jobId: job.id, rootJobId: job.rootJobId || job.id, message: job.checkpoint?.summary ? `Recovered running job from checkpoint: ${job.checkpoint.summary}` : 'Recovered running job after runtime restart.' })
      return {
        ...job,
        status: 'queued' as const,
        updatedAt: now,
        summary: job.checkpoint?.summary ? `Resuming from checkpoint: ${job.checkpoint.summary}` : 'Resuming interrupted job execution.',
      }
    }
    if (!job.approvalRequired && hasApiKey() && job.status === 'blocked' && job.error === 'OpenAI API key is not set.') {
      return { ...job, status: 'queued' as const, error: undefined, summary: 'Queued after API key became available.', updatedAt: now }
    }
    if (job.status === 'blocked' && typeof job.cooldownUntil === 'number' && job.cooldownUntil <= now && (!job.approvalRequired || job.approved)) {
      return { ...job, status: 'queued' as const, summary: 'Retry cooldown expired. Job re-queued.', updatedAt: now, error: undefined }
    }
    return job
  })
  saveAndEmit(folderPath, normalized, deps)
}
export function listAgentJobs(folderPath: string): AgentJob[] {
  return readJobs(folderPath)
}
export function listAgentEvents(folderPath: string): AgentRuntimeEvent[] {
  return readEvents(folderPath)
}

export function ensureAgentRuntimeState(folderPath: string) {
  ensureState(folderPath)
}

export function queueTaskVerificationJob(folderPath: string, taskId: string, filePaths: string[], deps: RuntimeDeps) {
  const policy = getRuntimePolicy(folderPath, deps)
  if (!policy.allowBackgroundAgent || !policy.autoQueueTestRuns) return readJobs(folderPath)

  const command = detectTestCommand(folderPath)
  const commandRule = command ? findCommandRule(command, 'task_run', policy) : null
  if (!command || !commandRule) return readJobs(folderPath)

  let jobs = readJobs(folderPath)
  const queued = enqueueJob(jobs, createJob('test_run', 'task_run', 'Run task verification command', `Triggered by task execution for task ${taskId}. Verification command: ${command}`, filePaths, {
    command,
    commandTimeoutMs: commandRule.timeoutMs,
    relatedTaskId: taskId,
    approvalRequired: commandRule.requiresApproval,
    approved: !commandRule.requiresApproval,
    status: commandRule.requiresApproval ? 'blocked' : 'queued',
    summary: commandRule.requiresApproval ? `Approval required before running: ${command}` : `Queued verification command: ${command}`,
  }))
  jobs = assignRootJobId(queued.jobs, queued.jobId)
  saveAndEmit(folderPath, jobs, deps)
  appendRuntimeEvent(folderPath, deps, { level: commandRule.requiresApproval ? 'warn' : 'info', type: commandRule.requiresApproval ? 'job_blocked' : 'job_queued', jobId: queued.jobId, rootJobId: queued.jobId, message: commandRule.requiresApproval ? `Task verification awaiting approval: ${command}` : `Queued task verification command: ${command}` })
  if (!commandRule.requiresApproval) void runNextJob(folderPath, deps)
  return jobs
}
export function approveAgentJob(folderPath: string, jobId: string, deps: RuntimeDeps) {
  const jobs = readJobs(folderPath)
  const jobIndex = jobs.findIndex((job) => job.id === jobId)
  if (jobIndex === -1) return jobs

  jobs[jobIndex] = {
    ...jobs[jobIndex],
    approved: true,
    status: 'queued',
    updatedAt: Date.now(),
    summary: jobs[jobIndex].kind === 'test_run'
      ? `Approved. Ready to run: ${jobs[jobIndex].command}`
      : jobs[jobIndex].checkpoint?.summary || jobs[jobIndex].summary,
    error: undefined,
  }
  saveAndEmit(folderPath, jobs, deps)
  appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_queued', jobId, rootJobId: jobs[jobIndex].rootJobId || jobId, message: jobs[jobIndex].summary || 'Approved job and re-queued it.' })
  void runNextJob(folderPath, deps)
  return jobs
}

export function retryAgentJob(folderPath: string, jobId: string, deps: RuntimeDeps) {
  const jobs = readJobs(folderPath)
  const jobIndex = jobs.findIndex((job) => job.id === jobId)
  if (jobIndex === -1) return jobs

  const job = jobs[jobIndex]
  const policy = getRuntimePolicy(folderPath, deps)
  const needsApproval = job.kind === 'test_run' && job.approvalRequired && !job.approved
  const isAllowed = job.kind !== 'test_run' || (!!job.command && !!findCommandRule(job.command, job.trigger, policy))
  const attemptsRemaining = hasAttemptsRemaining(job, policy)
  const coolingDown = isCoolingDown(job)
  const cooldownSummary = getCooldownSummary(job)
  jobs[jobIndex] = {
    ...job,
    status: !attemptsRemaining ? 'failed' : needsApproval ? 'blocked' : coolingDown ? 'blocked' : isAllowed ? 'queued' : 'failed',
    updatedAt: Date.now(),
    completedAt: !attemptsRemaining ? Date.now() : undefined,
    startedAt: undefined,
    result: undefined,
    error: !attemptsRemaining
      ? 'Job retry limit reached.'
      : isAllowed
        ? undefined
        : `Verification command is not allowed by runtime policy: ${job.command}`,
    summary: !attemptsRemaining
      ? `Retry limit reached (${policy.maxJobAttempts} attempts).`
      : !isAllowed
        ? 'Retry blocked by verification command policy.'
        : needsApproval
          ? `Approval required before running: ${job.command}`
          : coolingDown
            ? (cooldownSummary || 'Retry cooldown still active.')
            : job.checkpoint?.summary
              ? `Queued to resume from checkpoint: ${job.checkpoint.summary}`
              : `Queued for retry${job.attemptCount ? ` after ${job.attemptCount} prior attempt${job.attemptCount === 1 ? '' : 's'}` : ''}.`,
    verificationStatus: job.kind === 'test_run' ? 'pending' : job.verificationStatus,
    dismissedAt: undefined,
    dismissalReason: undefined,
  }
  saveAndEmit(folderPath, jobs, deps)
  appendRuntimeEvent(folderPath, deps, { level: jobs[jobIndex].status === 'failed' ? 'error' : jobs[jobIndex].status === 'blocked' ? 'warn' : 'info', type: jobs[jobIndex].status === 'failed' ? 'job_failed' : jobs[jobIndex].status === 'blocked' ? 'job_blocked' : 'job_queued', jobId, rootJobId: jobs[jobIndex].rootJobId || jobId, message: jobs[jobIndex].summary || 'Updated job retry state.' })
  if (attemptsRemaining && !needsApproval && !coolingDown && isAllowed) void runNextJob(folderPath, deps)
  return jobs
}
export function dismissAgentJob(folderPath: string, jobId: string, reason: string | undefined, deps: RuntimeDeps) {
  const jobs = readJobs(folderPath)
  const jobIndex = jobs.findIndex((job) => job.id === jobId)
  if (jobIndex === -1) return jobs

  const dismissalReason = reason?.trim() || 'Dismissed by user.'
  jobs[jobIndex] = {
    ...jobs[jobIndex],
    status: 'dismissed',
    updatedAt: Date.now(),
    completedAt: Date.now(),
    dismissedAt: Date.now(),
    dismissalReason,
    summary: dismissalReason,
  }
  saveAndEmit(folderPath, reconcileChainResolution(jobs, jobs[jobIndex].id), deps)
  appendRuntimeEvent(folderPath, deps, { level: 'warn', type: 'job_dismissed', jobId, rootJobId: jobs[jobIndex].rootJobId || jobId, message: dismissalReason })
  void runNextJob(folderPath, deps)
  return jobs
}

export function acknowledgeAgentJob(folderPath: string, jobId: string, reason: string | undefined, deps: RuntimeDeps) {
  const jobs = readJobs(folderPath)
  const jobIndex = jobs.findIndex((job) => job.id === jobId)
  if (jobIndex === -1) return jobs

  jobs[jobIndex] = {
    ...jobs[jobIndex],
    needsAttention: false,
    acknowledgedAt: Date.now(),
    acknowledgementReason: reason || 'Acknowledged from linked task review.',
    updatedAt: Date.now(),
  }
  saveAndEmit(folderPath, reconcileChainResolution(jobs, jobs[jobIndex].id), deps)
  appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_acknowledged', jobId, rootJobId: jobs[jobIndex].rootJobId || jobId, message: jobs[jobIndex].acknowledgementReason || 'Acknowledged by user action.' })
  return jobs
}

export function notifyAgentFileChange(folderPath: string, change: FolderChangeEvent, deps: RuntimeDeps) {
  const existing = pendingReviewChanges.get(folderPath) || []
  pendingReviewChanges.set(folderPath, [...existing, change].slice(-12))
  const priorTimer = pendingReviewTimers.get(folderPath)
  if (priorTimer) clearTimeout(priorTimer)
  pendingReviewTimers.set(folderPath, setTimeout(() => {
    const changes = pendingReviewChanges.get(folderPath) || []
    pendingReviewChanges.delete(folderPath)
    pendingReviewTimers.delete(folderPath)
    queueChangeDrivenJobs(folderPath, changes, deps)
    void runNextJob(folderPath, deps)
  }, REVIEW_DEBOUNCE_MS))
}

export function kickAgentRuntime(folderPath: string, deps: RuntimeDeps) {
  normalizeBlockedJobs(folderPath, deps)
  void queueGitDrivenJobs(folderPath, deps).finally(() => {
    void runNextJob(folderPath, deps)
  })
}















