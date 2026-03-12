/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export interface SmartFolder {
  path: string
  name: string
  memory: string
  agentConfig: Record<string, unknown>
}

export interface AgentJobStructuredResult {
  commitMessage?: string
  summary?: string
  risks?: string
  findings?: string
  nextActions?: string
}

export interface AgentJobPlanStep {
  id: string
  label: string
  status: 'pending' | 'active' | 'done'
}

export interface AgentJobCheckpoint {
  phase: string
  summary: string
  updatedAt: number
}

export interface AgentJobArtifact {
  id: string
  phase: string
  title: string
  body: string
  createdAt: number
}

export interface AgentRuntimeEvent {
  id: string
  ts: number
  level: 'info' | 'warn' | 'error'
  type: 'job_queued' | 'job_started' | 'job_checkpoint' | 'job_completed' | 'job_failed' | 'job_blocked' | 'job_dismissed' | 'job_acknowledged' | 'runtime_resume'
  jobId?: string
  rootJobId?: string
  message: string
}

interface VerificationCommandRule {
  command: string
  allowedTriggers: Array<'file_watcher' | 'git_state' | 'task_run'>
  requiresApproval: boolean
  timeoutMs: number
}

export interface AgentRuntimePolicy {
  allowBackgroundAgent: boolean
  autoRunFileReview: boolean
  autoRunDiffSummary: boolean
  autoQueueTestRuns: boolean
  autoCreateSuggestedTasks: boolean
  requireApprovalForTestRuns: boolean
  allowedVerificationCommands: string[]
  verificationCommandRules: VerificationCommandRule[]
  maxJobAttempts: number
  retryCooldownMinutes: number
  maxSuggestedTasksPerJob: number
}

export interface AgentConfig {
  name: string
  created: string
  model: string
  tone: string
  archetype: 'general' | 'codebase' | 'research' | 'content' | 'operations'
  goals: string[]
  constraints: string[]
  guardrails: {
    requireApprovalForDangerousCommands: boolean
    requireApprovalForFileChanges: boolean
    runtime: AgentRuntimePolicy
  }
}

export interface TaskRunTrace {
  tool: string
  detail: string
  ts: number
  diff?: string
}

export interface TaskRunPlanStep {
  id: string
  text: string
  status: 'pending' | 'active' | 'done'
}

export interface TaskRunPlanSnapshot {
  goal: string
  steps: TaskRunPlanStep[]
  ts: number
}

export interface TaskRunActivityEntry {
  kind: string
  message: string
  ts: number
}

export interface TaskRun {
  id: string
  startedAt: number
  completedAt?: number
  durationMs?: number
  summary?: string
  status: 'running' | 'completed' | 'failed'
  filesTouched?: string[]
  commands?: string[]
  trace?: TaskRunTrace[]
  planSnapshots?: TaskRunPlanSnapshot[]
  activityLog?: TaskRunActivityEntry[]
}

export type TaskStatus = 'suggested' | 'open' | 'done'
export type TaskSource = 'user' | 'agent'
export interface AddTaskOptions {
  source?: TaskSource
  suggestedByJobId?: string
  archivedFromJobId?: string
}

export interface TaskItem {
  id: string
  text: string
  status: TaskStatus
  source?: TaskSource
  suggestedByJobId?: string
  archivedFromJobId?: string
  runs?: TaskRun[]
}

export interface GitStatus {
  isRepo: boolean
  branch: string | null
  changedFiles: string[]
  stagedFiles: string[]
  untrackedFiles: string[]
  aheadBehind: string | null
  suggestedCommitMessage: string | null
}

export interface FolderBriefing {
  summary: string
  fileCount: number
  topFiles: string[]
  recentChanges: string[]
  suggestions: string[]
  keyDecisions: string[]
  openTasks: string[]
  git: GitStatus
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface AgentJob {
  id: string
  kind: 'file_review' | 'diff_summary' | 'test_run' | 'docs_drift' | 'commit_prep'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'dismissed'
  title: string
  trigger: string
  reason: string
  rootJobId?: string
  parentJobId?: string
  childJobIds?: string[]
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  lastAttemptAt?: number
  attemptCount: number
  cooldownUntil?: number
  filePaths: string[]
  summary?: string
  result?: string
  structuredResult?: AgentJobStructuredResult
  planSteps?: AgentJobPlanStep[]
  activeStepId?: string
  checkpoint?: AgentJobCheckpoint
  stepArtifacts?: AgentJobArtifact[]
  needsAttention?: boolean
  attentionSummary?: string
  error?: string
  command?: string
  commandTimeoutMs?: number
  verificationStatus?: 'pending' | 'passed' | 'failed'
  approvalRequired?: boolean
  approved?: boolean
  relatedTaskId?: string
  acknowledgedAt?: number
  acknowledgementReason?: string
  chainResolvedAt?: number
  chainResolutionReason?: string
  dismissedAt?: number
  dismissalReason?: string
}

import type { IpcApi, IpcEvents } from './main/ipcTypes'

declare global {
  interface Window {
    foldermind: {
      [K in keyof IpcApi]: IpcApi[K]
    } & {
      [K in keyof IpcEvents]: (cb: IpcEvents[K]) => () => void
    }
  }
}



