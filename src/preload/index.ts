import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ChatMessage } from '../vite-env'

function subscribe<T>(channel: string, cb: (data: T) => void) {
  const listener = (_event: IpcRendererEvent, data: T) => cb(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('foldermind', {
  createFolder: () => ipcRenderer.invoke('folder:create'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  activateFolder: (folderPath: string) => ipcRenderer.invoke('folder:activate', folderPath),
  getBriefing: (folderPath: string, folderName: string) => ipcRenderer.invoke('folder:getBriefing', folderPath, folderName),
  getGitStatus: (folderPath: string) => ipcRenderer.invoke('folder:getGitStatus', folderPath),
  getConfig: (folderPath: string) => ipcRenderer.invoke('folder:getConfig', folderPath),
  listAgentJobs: (folderPath: string) => ipcRenderer.invoke('agent:listJobs', folderPath),
  listAgentEvents: (folderPath: string) => ipcRenderer.invoke('agent:listEvents', folderPath),
  runAgentJobs: (folderPath: string) => ipcRenderer.invoke('agent:runJobs', folderPath),
  approveAgentJob: (folderPath: string, jobId: string) => ipcRenderer.invoke('agent:approveJob', folderPath, jobId),
  retryAgentJob: (folderPath: string, jobId: string) => ipcRenderer.invoke('agent:retryJob', folderPath, jobId),
  dismissAgentJob: (folderPath: string, jobId: string, reason?: string) => ipcRenderer.invoke('agent:dismissJob', folderPath, jobId, reason),
  getChatHistory: (folderPath: string) => ipcRenderer.invoke('chat:getHistory', folderPath),
  clearChatHistory: (folderPath: string) => ipcRenderer.invoke('chat:clearHistory', folderPath),
  updateConfig: (folderPath: string, updates: { tone?: string; archetype?: 'general' | 'codebase' | 'research' | 'content' | 'operations'; goals?: string[]; constraints?: string[]; guardrails?: unknown }) => ipcRenderer.invoke('folder:updateConfig', folderPath, updates),
  listTasks: (folderPath: string) => ipcRenderer.invoke('tasks:list', folderPath),
  addTask: (folderPath: string, text: string, options?: { source?: 'user' | 'agent'; suggestedByJobId?: string; archivedFromJobId?: string }) => ipcRenderer.invoke('tasks:add', folderPath, text, options),
  updateTask: (folderPath: string, taskId: string, updates: { text?: string; status?: 'suggested' | 'open' | 'done' }) => ipcRenderer.invoke('tasks:update', folderPath, taskId, updates),
  deleteTask: (folderPath: string, taskId: string) => ipcRenderer.invoke('tasks:delete', folderPath, taskId),
  runTask: (folderPath: string, taskId: string) => ipcRenderer.invoke('tasks:run', folderPath, taskId),
  openInExplorer: (folderPath: string, target: string) => ipcRenderer.invoke('folder:openInExplorer', folderPath, target),
  readMemory: (folderPath: string) => ipcRenderer.invoke('memory:read', folderPath),
  writeMemory: (folderPath: string, updates: { project?: string; decisions?: string; preferences?: string; archivedAgentHistory?: string }) => ipcRenderer.invoke('memory:write', folderPath, updates),

  setApiKey: (key: string) => ipcRenderer.invoke('agent:setKey', key),
  getAgentStatus: () => ipcRenderer.invoke('agent:status'),
  transcribeVoice: (audioBase64: string) => ipcRenderer.invoke('voice:transcribe', audioBase64),
  getVoiceResult: (jobId: string) => ipcRenderer.invoke('voice:getResult', jobId),
  speakText: (text: string) => ipcRenderer.invoke('voice:speak', text),
  getSpeechResult: (jobId: string) => ipcRenderer.invoke('voice:getSpeechResult', jobId),
  chat: (folderPath: string, message: string, history: ChatMessage[], memory: string) => ipcRenderer.invoke('agent:chat', folderPath, message, history, memory),
  approve: (approvalId: string, approved: boolean) => ipcRenderer.invoke('agent:approve', approvalId, approved),

  onToken: (cb: (token: string) => void) => subscribe<string>('agent:token', cb),
  onToolCall: (cb: (data: { name: string; args: unknown }) => void) => subscribe<{ name: string; args: unknown }>('agent:toolCall', cb),
  onToolResult: (cb: (data: { name: string; result: string }) => void) => subscribe<{ name: string; result: string }>('agent:toolResult', cb),
  onMemoryUpdated: (cb: (memory: string) => void) => subscribe<string>('agent:memoryUpdated', cb),
  onFolderChanged: (cb: (data: { event: string; filePath: string }) => void) => subscribe<{ event: string; filePath: string }>('folder:changed', cb),
  onPlan: (cb: (data: { goal: string; steps: { id: string; text: string; status: 'pending' | 'active' | 'done' }[] }) => void) => subscribe<{ goal: string; steps: { id: string; text: string; status: 'pending' | 'active' | 'done' }[] }>('agent:plan', cb),
  onActivity: (cb: (data: { kind: string; message: string; ts: number }) => void) => subscribe<{ kind: string; message: string; ts: number }>('agent:activity', cb),
  onApprovalRequested: (cb: (data: { id: string; type: string; title: string; description: string; command?: string; filepath?: string; diff?: string }) => void) => subscribe<{ id: string; type: string; title: string; description: string; command?: string; filepath?: string; diff?: string }>('agent:approvalRequested', cb),
  onJobsUpdated: (cb: (data: { folderPath: string; jobs: unknown[] }) => void) => subscribe<{ folderPath: string; jobs: unknown[] }>('agent:jobsUpdated', cb),
  onEventsUpdated: (cb: (data: { folderPath: string; events: unknown[] }) => void) => subscribe<{ folderPath: string; events: unknown[] }>('agent:eventsUpdated', cb),
  onTasksUpdated: (cb: (data: { folderPath: string; tasks: unknown[] }) => void) => subscribe<{ folderPath: string; tasks: unknown[] }>('tasks:updated', cb),

  // Git operations
  gitStageFile: (folderPath: string, filepath: string) => ipcRenderer.invoke('git:stageFile', folderPath, filepath),
  gitUnstageFile: (folderPath: string, filepath: string) => ipcRenderer.invoke('git:unstageFile', folderPath, filepath),
  gitStageAll: (folderPath: string) => ipcRenderer.invoke('git:stageAll', folderPath),
  gitCommit: (folderPath: string, message: string) => ipcRenderer.invoke('git:commit', folderPath, message),
  gitPush: (folderPath: string) => ipcRenderer.invoke('git:push', folderPath),
  gitGetFileDiff: (folderPath: string, filepath: string, staged: boolean) => ipcRenderer.invoke('git:getFileDiff', folderPath, filepath, staged),
})





