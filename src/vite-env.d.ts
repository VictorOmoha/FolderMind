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

declare global {
  interface Window {
    foldermind: {
      createFolder: () => Promise<SmartFolder | null>
      openFolder: () => Promise<SmartFolder | null>
      activateFolder: (folderPath: string) => Promise<SmartFolder | null>
      getBriefing: (folderPath: string, folderName: string) => Promise<FolderBriefing>
      getGitStatus: (folderPath: string) => Promise<GitStatus>
      getConfig: (folderPath: string) => Promise<AgentConfig>
      getChatHistory: (folderPath: string) => Promise<ChatMessage[]>
      clearChatHistory: (folderPath: string) => Promise<boolean>
      updateConfig: (folderPath: string, updates: Partial<Pick<AgentConfig, 'tone' | 'archetype' | 'goals' | 'constraints' | 'guardrails'>>) => Promise<AgentConfig>
      listAgentJobs: (folderPath: string) => Promise<AgentJob[]>
      listAgentEvents: (folderPath: string) => Promise<AgentRuntimeEvent[]>
      runAgentJobs: (folderPath: string) => Promise<AgentJob[]>
      approveAgentJob: (folderPath: string, jobId: string) => Promise<AgentJob[]>
      retryAgentJob: (folderPath: string, jobId: string) => Promise<AgentJob[]>
      dismissAgentJob: (folderPath: string, jobId: string, reason?: string) => Promise<AgentJob[]>
      listTasks: (folderPath: string) => Promise<TaskItem[]>
      addTask: (folderPath: string, text: string, options?: AddTaskOptions) => Promise<TaskItem[]>
      updateTask: (folderPath: string, taskId: string, updates: { text?: string; status?: TaskStatus }) => Promise<TaskItem[]>
      deleteTask: (folderPath: string, taskId: string) => Promise<TaskItem[]>
      runTask: (folderPath: string, taskId: string) => Promise<{ response: string; tasks: TaskItem[] }>
      openInExplorer: (folderPath: string, target: string) => Promise<void>
      readMemory: (folderPath: string) => Promise<{ project: string; decisions: string; preferences: string; archivedAgentHistory: string }>
      writeMemory: (folderPath: string, updates: { project?: string; decisions?: string; preferences?: string; archivedAgentHistory?: string }) => Promise<boolean>
      setApiKey: (key: string) => Promise<boolean>
      getAgentStatus: () => Promise<{ hasApiKey: boolean }>
      transcribeVoice: (audioBase64: string) => Promise<{ jobId: string }>
      getVoiceResult: (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; text?: string; error?: string }>
      speakText: (text: string) => Promise<{ jobId: string }>
      getSpeechResult: (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; audioBase64?: string; mimeType?: string; error?: string }>
      chat: (folderPath: string, message: string, history: unknown[], memory: string) => Promise<string>
      approve: (approvalId: string, approved: boolean) => Promise<boolean>
      onToken: (cb: (token: string) => void) => () => void
      onToolCall: (cb: (data: { name: string; args: unknown }) => void) => () => void
      onToolResult: (cb: (data: { name: string; result: string }) => void) => () => void
      onMemoryUpdated: (cb: (memory: string) => void) => () => void
      onFolderChanged: (cb: (data: { event: string; filePath: string }) => void) => () => void
      onPlan: (cb: (data: { goal: string; steps: { id: string; text: string; status: 'pending' | 'active' | 'done' }[] }) => void) => () => void
      onActivity: (cb: (data: { kind: string; message: string; ts: number }) => void) => () => void
      onApprovalRequested: (cb: (data: { id: string; type: string; title: string; description: string; command?: string; filepath?: string; diff?: string }) => void) => () => void
      onJobsUpdated: (cb: (data: { folderPath: string; jobs: AgentJob[] }) => void) => () => void
      onEventsUpdated: (cb: (data: { folderPath: string; events: AgentRuntimeEvent[] }) => void) => () => void
      onTasksUpdated: (cb: (data: { folderPath: string; tasks: TaskItem[] }) => void) => () => void
      gitStageFile: (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
      gitUnstageFile: (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
      gitStageAll: (folderPath: string) => Promise<{ ok: boolean; output: string }>
      gitCommit: (folderPath: string, message: string) => Promise<{ ok: boolean; output: string }>
      gitPush: (folderPath: string) => Promise<{ ok: boolean; output: string }>
      gitGetFileDiff: (folderPath: string, filepath: string, staged: boolean) => Promise<{ ok: boolean; diff: string }>
    }
  }
}



