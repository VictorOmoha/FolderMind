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

export interface TaskItem {
  id: string
  text: string
  status: 'open' | 'done'
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

declare global {
  interface Window {
    foldermind: {
      createFolder: () => Promise<SmartFolder | null>
      openFolder: () => Promise<SmartFolder | null>
      getBriefing: (folderPath: string, folderName: string) => Promise<FolderBriefing>
      getGitStatus: (folderPath: string) => Promise<GitStatus>
      getConfig: (folderPath: string) => Promise<AgentConfig>
      getChatHistory: (folderPath: string) => Promise<ChatMessage[]>
      clearChatHistory: (folderPath: string) => Promise<boolean>
      updateConfig: (folderPath: string, updates: { tone?: string; archetype?: AgentConfig['archetype']; goals?: string[]; constraints?: string[] }) => Promise<AgentConfig>
      listTasks: (folderPath: string) => Promise<TaskItem[]>
      addTask: (folderPath: string, text: string) => Promise<TaskItem[]>
      updateTask: (folderPath: string, taskId: string, updates: { text?: string; status?: 'open' | 'done' }) => Promise<TaskItem[]>
      deleteTask: (folderPath: string, taskId: string) => Promise<TaskItem[]>
      runTask: (folderPath: string, taskId: string) => Promise<{ response: string; tasks: TaskItem[] }>
      openInExplorer: (folderPath: string, target: string) => Promise<void>
      setApiKey: (key: string) => Promise<boolean>
      getAgentStatus: () => Promise<{ hasApiKey: boolean }>
      transcribeVoice: (audioBase64: string) => Promise<{ jobId: string }>
      getVoiceResult: (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; text?: string; error?: string }>
      speakText: (text: string) => Promise<{ jobId: string }>
      getSpeechResult: (jobId: string) => Promise<{ status: 'processing' | 'completed' | 'failed'; audioBase64?: string; mimeType?: string; error?: string }>
      chat: (folderPath: string, message: string, history: any[], memory: string) => Promise<string>
      approve: (approvalId: string, approved: boolean) => Promise<boolean>
      onToken: (cb: (token: string) => void) => () => void
      onToolCall: (cb: (data: { name: string; args: any }) => void) => () => void
      onToolResult: (cb: (data: { name: string; result: string }) => void) => () => void
      onMemoryUpdated: (cb: (memory: string) => void) => () => void
      onFolderChanged: (cb: (data: { event: string; filePath: string }) => void) => () => void
      onPlan: (cb: (data: { goal: string; steps: { id: string; text: string; status: 'pending' | 'active' | 'done' }[] }) => void) => () => void
      onActivity: (cb: (data: { kind: string; message: string; ts: number }) => void) => () => void
      onApprovalRequested: (cb: (data: { id: string; type: string; title: string; description: string; command?: string; filepath?: string; diff?: string }) => void) => () => void

      // Git operations
      gitStageFile: (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
      gitUnstageFile: (folderPath: string, filepath: string) => Promise<{ ok: boolean; output: string }>
      gitStageAll: (folderPath: string) => Promise<{ ok: boolean; output: string }>
      gitCommit: (folderPath: string, message: string) => Promise<{ ok: boolean; output: string }>
      gitPush: (folderPath: string) => Promise<{ ok: boolean; output: string }>
      gitGetFileDiff: (folderPath: string, filepath: string, staged: boolean) => Promise<{ ok: boolean; diff: string }>
    }
  }
}
