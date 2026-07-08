export type AgentJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'dismissed'
export type AgentJobKind = 'file_review' | 'diff_summary' | 'test_run' | 'docs_drift' | 'commit_prep'
export type AgentJobVerificationStatus = 'pending' | 'passed' | 'failed'
export type AgentJobTrigger = 'file_watcher' | 'git_state' | 'task_run'

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

export interface AgentJobExecutionState {
  preparedContext?: string
}

export interface AgentJobAttentionState {
  needsAttention: boolean
  attentionSummary?: string
}

export interface VerificationCommandRule {
  command: string
  allowedTriggers: AgentJobTrigger[]
  requiresApproval: boolean
  timeoutMs: number
}

export interface AgentJob {
  id: string
  kind: AgentJobKind
  status: AgentJobStatus
  title: string
  trigger: AgentJobTrigger
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
  executionState?: AgentJobExecutionState
  needsAttention?: boolean
  attentionSummary?: string
  error?: string
  command?: string
  commandTimeoutMs?: number
  verificationStatus?: AgentJobVerificationStatus
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

export interface FolderChangeEvent {
  event: string
  filePath: string
  ts: number
}

export interface RuntimePolicy {
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

export interface AgentConfigLike {
  name?: string
  archetype?: string
  tone?: string
  goals?: string[]
  constraints?: string[]
  guardrails?: {
    runtime?: Partial<RuntimePolicy>
  }
}

export interface StructuredMemoryLike {
  project: string
  decisions: string
  preferences: string
  archivedAgentHistory: string
  tasks: { items: Array<{ id: string; text: string; status: 'suggested' | 'open' | 'done' }> }
}

export interface GitStatusLike {
  isRepo: boolean
  branch: string | null
  changedFiles: string[]
  stagedFiles: string[]
  untrackedFiles: string[]
  aheadBehind: string | null
  suggestedCommitMessage: string | null
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

export interface RuntimeDeps {
  readAgentConfig: (folderPath: string) => AgentConfigLike
  loadStructuredMemory: (folderPath: string) => StructuredMemoryLike
  flattenStructuredMemory: (memory: StructuredMemoryLike) => string
  getRecentFolderChanges: (folderPath: string) => FolderChangeEvent[]
  getGitStatus: (folderPath: string) => Promise<GitStatusLike>
  onJobsUpdated?: (folderPath: string, jobs: AgentJob[]) => void
  onEventsUpdated?: (folderPath: string, events: AgentRuntimeEvent[]) => void
  onTaskVerified?: (folderPath: string, taskId: string, output: string) => void
  onTasksSuggested?: (folderPath: string, job: AgentJob, tasks: string[]) => void
  onChainsArchived?: (folderPath: string, jobs: AgentJob[]) => void
}

export const AGENT_DIR = '.foldermind'
export const MAX_AGENT_JOBS = 50
export const MAX_RESOLVED_ROOT_CHAINS = 8
export const MAX_RUNTIME_EVENTS = 120
export const REVIEW_DEBOUNCE_MS = 1500
export const JOB_TIMEOUT_MS = 120000
