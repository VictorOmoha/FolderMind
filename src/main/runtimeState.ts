import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  AGENT_DIR,
  AgentJob,
  AgentJobArtifact,
  AgentJobCheckpoint,
  AgentJobExecutionState,
  AgentJobPlanStep,
  AgentRuntimeEvent,
  MAX_AGENT_JOBS,
  MAX_RESOLVED_ROOT_CHAINS,
  MAX_RUNTIME_EVENTS,
  RuntimeDeps,
} from './runtimeTypes'

function getStatePaths(folderPath: string) {
  const stateDir = join(folderPath, AGENT_DIR, 'state')
  return {
    dir: stateDir,
    jobs: join(stateDir, 'jobs.json'),
    events: join(stateDir, 'events.json'),
  }
}

export function ensureState(folderPath: string) {
  const paths = getStatePaths(folderPath)
  if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true })
  if (!existsSync(paths.jobs)) writeFileSync(paths.jobs, JSON.stringify({ jobs: [] }, null, 2), 'utf-8')
  if (!existsSync(paths.events)) writeFileSync(paths.events, JSON.stringify({ events: [] }, null, 2), 'utf-8')
}

function normalizePlanSteps(value: unknown): AgentJobPlanStep[] | undefined {
  if (!Array.isArray(value)) return undefined
  const planSteps = value.filter((step): step is AgentJobPlanStep =>
    !!step
    && typeof step === 'object'
    && typeof (step as AgentJobPlanStep).id === 'string'
    && typeof (step as AgentJobPlanStep).label === 'string'
    && ((step as AgentJobPlanStep).status === 'pending' || (step as AgentJobPlanStep).status === 'active' || (step as AgentJobPlanStep).status === 'done'))
  return planSteps.length > 0 ? planSteps : undefined
}

function normalizeCheckpoint(value: unknown): AgentJobCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const checkpoint = value as AgentJobCheckpoint
  if (typeof checkpoint.phase !== 'string' || typeof checkpoint.summary !== 'string') return undefined
  return {
    phase: checkpoint.phase,
    summary: checkpoint.summary,
    updatedAt: typeof checkpoint.updatedAt === 'number' ? checkpoint.updatedAt : Date.now(),
  }
}

function normalizeArtifacts(value: unknown): AgentJobArtifact[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((artifact): artifact is AgentJobArtifact =>
      !!artifact
      && typeof artifact === 'object'
      && typeof (artifact as AgentJobArtifact).id === 'string'
      && typeof (artifact as AgentJobArtifact).phase === 'string'
      && typeof (artifact as AgentJobArtifact).title === 'string'
      && typeof (artifact as AgentJobArtifact).body === 'string')
    .slice(0, 12)
}

function normalizeExecutionState(value: unknown): AgentJobExecutionState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const executionState = value as AgentJobExecutionState
  return {
    preparedContext: typeof executionState.preparedContext === 'string' ? executionState.preparedContext : undefined,
  }
}

export function persistJobs(folderPath: string, jobs: AgentJob[]) {
  ensureState(folderPath)
  writeFileSync(getStatePaths(folderPath).jobs, JSON.stringify({ jobs: jobs.slice(0, MAX_AGENT_JOBS) }, null, 2), 'utf-8')
}

export function readJobs(folderPath: string): AgentJob[] {
  ensureState(folderPath)
  try {
    const parsed = JSON.parse(readFileSync(getStatePaths(folderPath).jobs, 'utf-8')) as { jobs?: AgentJob[] }
    return Array.isArray(parsed.jobs)
      ? parsed.jobs.slice(0, MAX_AGENT_JOBS).map((job) => ({
          ...job,
          reason: job.reason || `Triggered by ${job.trigger.replace('_', ' ')}.`,
          rootJobId: typeof job.rootJobId === 'string' ? job.rootJobId : undefined,
          parentJobId: typeof job.parentJobId === 'string' ? job.parentJobId : undefined,
          childJobIds: Array.isArray(job.childJobIds) ? job.childJobIds.filter((item): item is string => typeof item === 'string') : [],
          attemptCount: typeof job.attemptCount === 'number' ? job.attemptCount : 0,
          cooldownUntil: typeof job.cooldownUntil === 'number' ? job.cooldownUntil : undefined,
          structuredResult: job.structuredResult && typeof job.structuredResult === 'object' ? job.structuredResult : undefined,
          planSteps: normalizePlanSteps(job.planSteps),
          activeStepId: typeof job.activeStepId === 'string' ? job.activeStepId : undefined,
          checkpoint: normalizeCheckpoint(job.checkpoint),
          stepArtifacts: normalizeArtifacts(job.stepArtifacts),
          executionState: normalizeExecutionState(job.executionState),
          needsAttention: job.needsAttention === true,
          attentionSummary: typeof job.attentionSummary === 'string' ? job.attentionSummary : undefined,
          acknowledgedAt: typeof job.acknowledgedAt === 'number' ? job.acknowledgedAt : undefined,
          acknowledgementReason: typeof job.acknowledgementReason === 'string' ? job.acknowledgementReason : undefined,
          chainResolvedAt: typeof job.chainResolvedAt === 'number' ? job.chainResolvedAt : undefined,
          chainResolutionReason: typeof job.chainResolutionReason === 'string' ? job.chainResolutionReason : undefined,
        }))
      : []
  } catch {
    return []
  }
}

export function emitJobs(deps: RuntimeDeps, folderPath: string, jobs: AgentJob[]) {
  deps.onJobsUpdated?.(folderPath, jobs)
}

export function persistEvents(folderPath: string, events: AgentRuntimeEvent[]) {
  ensureState(folderPath)
  writeFileSync(getStatePaths(folderPath).events, JSON.stringify({ events: events.slice(0, MAX_RUNTIME_EVENTS) }, null, 2), 'utf-8')
}

export function readEvents(folderPath: string): AgentRuntimeEvent[] {
  ensureState(folderPath)
  try {
    const parsed = JSON.parse(readFileSync(getStatePaths(folderPath).events, 'utf-8')) as { events?: AgentRuntimeEvent[] }
    return Array.isArray(parsed.events)
      ? parsed.events
          .filter((event): event is AgentRuntimeEvent =>
            !!event
            && typeof event.id === 'string'
            && typeof event.ts === 'number'
            && typeof event.level === 'string'
            && typeof event.type === 'string'
            && typeof event.message === 'string')
          .slice(0, MAX_RUNTIME_EVENTS)
      : []
  } catch {
    return []
  }
}

export function emitEvents(deps: RuntimeDeps, folderPath: string, events: AgentRuntimeEvent[]) {
  deps.onEventsUpdated?.(folderPath, events)
}

export function appendRuntimeEvent(folderPath: string, deps: RuntimeDeps, event: Omit<AgentRuntimeEvent, 'id' | 'ts'>) {
  const events = [
    {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...event,
    },
    ...readEvents(folderPath),
  ].slice(0, MAX_RUNTIME_EVENTS)
  persistEvents(folderPath, events)
  emitEvents(deps, folderPath, events)
}

function pruneResolvedChains(jobs: AgentJob[]) {
  const sorted = [...jobs].sort((left, right) => right.updatedAt - left.updatedAt)
  const resolvedRoots = sorted
    .filter((job) => !!job.chainResolvedAt && (!job.rootJobId || job.rootJobId === job.id))
    .sort((left, right) => (right.chainResolvedAt || 0) - (left.chainResolvedAt || 0))

  const resolvedRootIds = new Set(resolvedRoots.map((job) => job.id))
  const keepResolvedRootIds = new Set(resolvedRoots.slice(0, MAX_RESOLVED_ROOT_CHAINS).map((job) => job.id))
  const archivedRoots = resolvedRoots.filter((job) => !keepResolvedRootIds.has(job.id))
  const pruned = sorted.filter((job) => {
    const rootId = job.rootJobId || job.id
    if (resolvedRootIds.has(rootId) && !keepResolvedRootIds.has(rootId)) return false
    return keepResolvedRootIds.has(rootId) || !resolvedRootIds.has(rootId)
  })

  return { jobs: pruned.slice(0, MAX_AGENT_JOBS), archivedRoots }
}

export function saveAndEmit(folderPath: string, jobs: AgentJob[], deps: RuntimeDeps) {
  const { jobs: prunedJobs, archivedRoots } = pruneResolvedChains(jobs)
  persistJobs(folderPath, prunedJobs)
  if (archivedRoots.length > 0) deps.onChainsArchived?.(folderPath, archivedRoots)
  emitJobs(deps, folderPath, prunedJobs)
}
