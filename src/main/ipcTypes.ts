import type {
  SmartFolder,
  FolderBriefing,
  GitStatus,
  AgentConfig,
  ChatMessage,
  AgentJob,
  AgentRuntimeEvent,
  TaskItem,
  AddTaskOptions,
  TaskStatus
} from '../vite-env'

export interface MemoryUpdates {
  project?: string
  decisions?: string
  preferences?: string
  archivedAgentHistory?: string
}

export interface ConfigUpdates {
  tone?: string
  archetype?: AgentConfig['archetype']
  goals?: string[]
  constraints?: string[]
  guardrails?: Partial<AgentConfig['guardrails']>
}

export interface PlanData {
  goal: string
  steps: { id: string; text: string; status: 'pending' | 'active' | 'done' }[]
}

export interface ActivityData {
  kind: string
  message: string
  ts: number
}

export interface ApprovalRequest {
  id: string
  type: string
  title: string
  description: string
  command?: string
  filepath?: string
  diff?: string
}

export interface FolderChangeData {
  event: string
  filePath: string
}

export interface JobsUpdatedData {
  folderPath: string
  jobs: AgentJob[]
}

export interface EventsUpdatedData {
  folderPath: string
  events: AgentRuntimeEvent[]
}

export interface TasksUpdatedData {
  folderPath: string
  tasks: TaskItem[]
}

// Method names must match what src/preload/index.ts exposes on window.foldermind.
export interface IpcApi {
  // Folders
  createFolder: () => Promise<SmartFolder | null>
  openFolder: () => Promise<SmartFolder | null>
  activateFolder: (folderPath: string) => Promise<SmartFolder | null>
  getBriefing: (folderPath: string, folderName: string) => Promise<FolderBriefing>
  getGitStatus: (folderPath: string) => Promise<GitStatus>
  getConfig: (folderPath: string) => Promise<AgentConfig>
  updateConfig: (folderPath: string, updates: ConfigUpdates) => Promise<AgentConfig>
  openInExplorer: (folderPath: string, target: string) => Promise<string>

  // Agent / Jobs
  listAgentJobs: (folderPath: string) => Promise<AgentJob[]>
  listAgentEvents: (folderPath: string) => Promise<AgentRuntimeEvent[]>
  runAgentJobs: (folderPath: string) => Promise<AgentJob[]>
  approveAgentJob: (folderPath: string, jobId: string) => Promise<AgentJob[]>
  retryAgentJob: (folderPath: string, jobId: string) => Promise<AgentJob[]>
  dismissAgentJob: (folderPath: string, jobId: string, reason?: string) => Promise<AgentJob[]>
  setApiKey: (key: string) => Promise<boolean>
  setAuthContext: (token: string | null, planTier: 'free' | 'pro' | 'business') => Promise<boolean>
  submitFeedbackLocal: (entry: Record<string, unknown>) => Promise<{ ok: boolean; path?: string; error?: string }>
  getAgentStatus: () => Promise<{ hasApiKey: boolean; mode: 'byo' | 'hosted' | 'none'; planTier: 'free' | 'pro' | 'business'; gatewayConfigured: boolean }>
  chat: (folderPath: string, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }>, memory: string) => Promise<string>
  approve: (approvalId: string, approved: boolean) => Promise<boolean>

  // Chat
  getChatHistory: (folderPath: string) => Promise<ChatMessage[]>
  clearChatHistory: (folderPath: string) => Promise<boolean>

  // Tasks
  listTasks: (folderPath: string) => Promise<TaskItem[]>
  addTask: (folderPath: string, text: string, options?: AddTaskOptions) => Promise<TaskItem[]>
  updateTask: (folderPath: string, taskId: string, updates: { text?: string; status?: TaskStatus }) => Promise<TaskItem[]>
  deleteTask: (folderPath: string, taskId: string) => Promise<TaskItem[]>
  runTask: (folderPath: string, taskId: string) => Promise<{ response: string; tasks: TaskItem[] }>

  // Memory
  readMemory: (folderPath: string) => Promise<MemoryUpdates>
  writeMemory: (folderPath: string, updates: MemoryUpdates) => Promise<boolean>

  // Voice
  transcribeVoice: (audioBase64: string) => Promise<{ jobId: string }>
  getVoiceResult: (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; text?: string; error?: string }>
  speakText: (text: string) => Promise<{ jobId: string }>
  getSpeechResult: (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; audioBase64?: string; mimeType?: string; error?: string }>

  // Git
  gitStageFile: (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
  gitUnstageFile: (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
  gitStageAll: (folderPath: string) => Promise<{ ok: boolean; output: string }>
  gitCommit: (folderPath: string, message: string) => Promise<{ ok: boolean; output: string }>
  gitPush: (folderPath: string) => Promise<{ ok: boolean; output: string }>
  gitGetFileDiff: (folderPath: string, filepath: string, staged: boolean) => Promise<{ ok: boolean; diff: string }>
}

// Subscription helpers exposed by the preload; each returns an unsubscribe function.
export interface IpcEvents {
  onToken: (token: string) => void
  onToolCall: (data: { name: string; args: unknown }) => void
  onToolResult: (data: { name: string; result: string }) => void
  onMemoryUpdated: (memory: string) => void
  onFolderChanged: (data: FolderChangeData) => void
  onPlan: (data: PlanData) => void
  onActivity: (data: ActivityData) => void
  onApprovalRequested: (data: ApprovalRequest) => void
  onJobsUpdated: (data: JobsUpdatedData) => void
  onEventsUpdated: (data: EventsUpdatedData) => void
  onTasksUpdated: (data: TasksUpdatedData) => void
}
