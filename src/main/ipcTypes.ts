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
  TaskStatus,
  AgentRuntimePolicy
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

export interface IpcApi {
  // Folders
  'folder:create': () => Promise<SmartFolder | null>
  'folder:open': () => Promise<SmartFolder | null>
  'folder:activate': (folderPath: string) => Promise<SmartFolder | null>
  'folder:getBriefing': (folderPath: string, folderName: string) => Promise<FolderBriefing>
  'folder:getGitStatus': (folderPath: string) => Promise<GitStatus>
  'folder:getConfig': (folderPath: string) => Promise<AgentConfig>
  'folder:updateConfig': (folderPath: string, updates: ConfigUpdates) => Promise<AgentConfig>
  'folder:openInExplorer': (folderPath: string, target: string) => Promise<void>
  
  // Agent / Jobs
  'agent:listJobs': (folderPath: string) => Promise<AgentJob[]>
  'agent:listEvents': (folderPath: string) => Promise<AgentRuntimeEvent[]>
  'agent:runJobs': (folderPath: string) => Promise<AgentJob[]>
  'agent:approveJob': (folderPath: string, jobId: string) => Promise<AgentJob[]>
  'agent:retryJob': (folderPath: string, jobId: string) => Promise<AgentJob[]>
  'agent:dismissJob': (folderPath: string, jobId: string, reason?: string) => Promise<AgentJob[]>
  'agent:setKey': (key: string) => Promise<boolean>
  'agent:status': () => Promise<{ hasApiKey: boolean }>
  'agent:chat': (folderPath: string, message: string, history: ChatMessage[], memory: string) => Promise<string>
  'agent:approve': (approvalId: string, approved: boolean) => Promise<boolean>
  
  // Chat
  'chat:getHistory': (folderPath: string) => Promise<ChatMessage[]>
  'chat:clearHistory': (folderPath: string) => Promise<boolean>
  
  // Tasks
  'tasks:list': (folderPath: string) => Promise<TaskItem[]>
  'tasks:add': (folderPath: string, text: string, options?: AddTaskOptions) => Promise<TaskItem[]>
  'tasks:update': (folderPath: string, taskId: string, updates: { text?: string; status?: TaskStatus }) => Promise<TaskItem[]>
  'tasks:delete': (folderPath: string, taskId: string) => Promise<TaskItem[]>
  'tasks:run': (folderPath: string, taskId: string) => Promise<{ response: string; tasks: TaskItem[] }>
  
  // Memory
  'memory:read': (folderPath: string) => Promise<MemoryUpdates>
  'memory:write': (folderPath: string, updates: MemoryUpdates) => Promise<boolean>
  
  // Voice
  'voice:transcribe': (audioBase64: string) => Promise<{ jobId: string }>
  'voice:getResult': (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; text?: string; error?: string }>
  'voice:speak': (text: string) => Promise<{ jobId: string }>
  'voice:getSpeechResult': (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; audioBase64?: string; mimeType?: string; error?: string }>
  
  // Git
  'git:stageFile': (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
  'git:unstageFile': (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
  'git:stageAll': (folderPath: string) => Promise<{ ok: boolean; output: string }>
  'git:commit': (folderPath: string, message: string) => Promise<{ ok: boolean; output: string }>
  'git:push': (folderPath: string) => Promise<{ ok: boolean; output: string }>
  'git:getFileDiff': (folderPath: string, filepath: string, staged: boolean) => Promise<{ ok: boolean; diff: string }>
}

export interface IpcEvents {
  'agent:token': (token: string) => void
  'agent:toolCall': (data: { name: string; args: any }) => void
  'agent:toolResult': (data: { name: string; result: string }) => void
  'agent:memoryUpdated': (memory: string) => void
  'folder:changed': (data: FolderChangeData) => void
  'agent:plan': (data: PlanData) => void
  'agent:activity': (data: ActivityData) => void
  'agent:approvalRequested': (data: ApprovalRequest) => void
  'agent:jobsUpdated': (data: JobsUpdatedData) => void
  'agent:eventsUpdated': (data: EventsUpdatedData) => void
  'tasks:updated': (data: TasksUpdatedData) => void
}
