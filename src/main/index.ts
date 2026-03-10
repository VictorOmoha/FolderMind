import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import { join, relative } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, createReadStream, readdirSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import * as http from 'http'
import { lookup } from 'mime-types'
import chokidar from 'chokidar'
import { OpenAI } from 'openai'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { setApiKey, hasApiKey, runAgentLoop, updateMemoryAgent, extractStructuredMemory } from './agent'
import { acknowledgeAgentJob, approveAgentJob, dismissAgentJob, ensureAgentRuntimeState, kickAgentRuntime, listAgentEvents, listAgentJobs, notifyAgentFileChange, queueTaskVerificationJob, retryAgentJob, type AgentJob, type AgentRuntimeEvent } from './runtime'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

try {
  require('dotenv').config({ path: join(process.cwd(), '.env') })
  require('dotenv').config({ path: join(__dirname, '../../.env') })
} catch (e) {
  console.error('Dotenv error:', e)
}

app.commandLine.appendSwitch('no-sandbox')

interface VerificationCommandRule {
  command: string
  allowedTriggers: Array<'file_watcher' | 'git_state' | 'task_run'>
  requiresApproval: boolean
  timeoutMs: number
}

interface AgentRuntimePolicy {
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

interface AgentConfig {
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

interface TaskRunTrace { tool: string; detail: string; ts: number; diff?: string }
interface TaskRunPlanStep { id: string; text: string; status: 'pending' | 'active' | 'done' }
interface TaskRunPlanSnapshot { goal: string; steps: TaskRunPlanStep[]; ts: number }
interface TaskRunActivityEntry { kind: string; message: string; ts: number }
interface TaskRun { id: string; startedAt: number; completedAt?: number; durationMs?: number; summary?: string; status: 'running' | 'completed' | 'failed'; filesTouched?: string[]; commands?: string[]; trace?: TaskRunTrace[]; planSnapshots?: TaskRunPlanSnapshot[]; activityLog?: TaskRunActivityEntry[] }
type TaskStatus = 'suggested' | 'open' | 'done'
type TaskSource = 'user' | 'agent'
interface TaskItem { id: string; text: string; status: TaskStatus; source?: TaskSource; suggestedByJobId?: string; archivedFromJobId?: string; runs?: TaskRun[] }
interface AddTaskOptions { source?: TaskSource; suggestedByJobId?: string; archivedFromJobId?: string }
interface ChatMessage { role: 'user' | 'assistant'; content: string; ts: number }
interface StructuredMemory { project: string; decisions: string; preferences: string; archivedAgentHistory: string; tasks: { items: TaskItem[] } }
interface GitStatus { isRepo: boolean; branch: string | null; changedFiles: string[]; stagedFiles: string[]; untrackedFiles: string[]; aheadBehind: string | null; suggestedCommitMessage: string | null }
interface FolderBriefing { summary: string; fileCount: number; topFiles: string[]; recentChanges: string[]; suggestions: string[]; keyDecisions: string[]; openTasks: string[]; git: GitStatus }
interface FolderChangeEvent { event: string; filePath: string; ts: number }
interface AgentJobsPayload { folderPath: string; jobs: AgentJob[] }
interface AgentEventsPayload { folderPath: string; events: AgentRuntimeEvent[] }

const IGNORED_DIRS = new Set(['.foldermind', '.git', 'node_modules', 'dist', 'out', 'release'])

// ── Named limits ──────────────────────────────────────────────────────────────
const MAX_CHAT_HISTORY = 100
const MAX_TASK_RUNS = 10
const MAX_PLAN_SNAPSHOTS = 20
const MAX_ACTIVITY_LOG = 60
const MAX_TRACE_ENTRIES = 50
const MAX_FOLDER_CHANGE_LOG = 50
const MAX_RECENT_CHANGES = 10

// ── Rate limiter (max 10 AI calls per minute) ────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_CALLS = 10
const aiCallLog: number[] = []
function isRateLimited(): boolean {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  while (aiCallLog.length > 0 && aiCallLog[0] < cutoff) aiCallLog.shift()
  if (aiCallLog.length >= RATE_LIMIT_MAX_CALLS) return true
  aiCallLog.push(now)
  return false
}
let localPort = 0
function startLocalServer(): Promise<number> { return new Promise((resolve) => { const rendererDir = join(__dirname, '../renderer'); const server = http.createServer((req, res) => { const urlPath = req.url === '/' || !req.url ? '/index.html' : req.url!; const filePath = join(rendererDir, urlPath.split('?')[0]); try { const mimeType = (lookup(filePath) || 'text/plain') as string; res.writeHead(200, { 'Content-Type': mimeType }); createReadStream(filePath).pipe(res) } catch { res.writeHead(200, { 'Content-Type': 'text/html' }); createReadStream(join(rendererDir, 'index.html')).pipe(res) } }); server.listen(0, '127.0.0.1', () => { localPort = (server.address() as { port: number }).port; resolve(localPort) }) }) }

let mainWindow: BrowserWindow | null = null
let activeWatcher: ReturnType<typeof chokidar.watch> | null = null
let activeFolderPath: string | null = null
const pendingApprovals = new Map<string, (approved: boolean) => void>()
const folderChangeLog = new Map<string, FolderChangeEvent[]>()
const AGENT_DIR = '.foldermind'
const voiceTranscriptions = new Map<string, { status: 'processing' | 'completed' | 'failed'; text?: string; error?: string }>()
const voiceSpeech = new Map<string, { status: 'processing' | 'completed' | 'failed'; audioBase64?: string; mimeType?: string; error?: string }>()

function getOpenAI() { const key = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY; return key ? new OpenAI({ apiKey: key }) : null }
function getDefaultRuntimePolicy(archetype: AgentConfig['archetype'] = 'general'): AgentRuntimePolicy {
  if (archetype === 'codebase') {
    return {
      allowBackgroundAgent: true,
      autoRunFileReview: true,
      autoRunDiffSummary: true,
      autoQueueTestRuns: true,
      autoCreateSuggestedTasks: true,
      requireApprovalForTestRuns: true,
      allowedVerificationCommands: ['npm run test', 'npm run check', 'npm run lint'],
      verificationCommandRules: [
        { command: 'npm run test', allowedTriggers: ['file_watcher', 'git_state', 'task_run'], requiresApproval: true, timeoutMs: 120000 },
        { command: 'npm run check', allowedTriggers: ['file_watcher', 'git_state', 'task_run'], requiresApproval: true, timeoutMs: 120000 },
        { command: 'npm run lint', allowedTriggers: ['file_watcher', 'git_state', 'task_run'], requiresApproval: true, timeoutMs: 120000 },
      ],
      maxJobAttempts: 3,
      retryCooldownMinutes: 5,
      maxSuggestedTasksPerJob: 2,
    }
  }
  return {
    allowBackgroundAgent: true,
    autoRunFileReview: true,
    autoRunDiffSummary: false,
    autoQueueTestRuns: false,
    autoCreateSuggestedTasks: true,
    requireApprovalForTestRuns: true,
    allowedVerificationCommands: ['npm run test', 'npm run check', 'npm run lint'],
    verificationCommandRules: [
      { command: 'npm run test', allowedTriggers: ['task_run'], requiresApproval: true, timeoutMs: 120000 },
      { command: 'npm run check', allowedTriggers: ['task_run'], requiresApproval: true, timeoutMs: 120000 },
      { command: 'npm run lint', allowedTriggers: ['task_run'], requiresApproval: true, timeoutMs: 120000 },
    ],
    maxJobAttempts: 2,
    retryCooldownMinutes: 10,
    maxSuggestedTasksPerJob: 1,
  }
}
function normalizeAgentConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    guardrails: {
      requireApprovalForDangerousCommands: config.guardrails?.requireApprovalForDangerousCommands ?? true,
      requireApprovalForFileChanges: config.guardrails?.requireApprovalForFileChanges ?? true,
      runtime: {
        ...getDefaultRuntimePolicy(config.archetype),
        ...(config.guardrails?.runtime || {}),
      },
    },
  }
}
const runtimeDeps = {
  readAgentConfig,
  loadStructuredMemory,
  flattenStructuredMemory,
  getRecentFolderChanges,
  getGitStatus,
  onJobsUpdated: (folderPath: string, jobs: AgentJob[]) => {
    mainWindow?.webContents.send('agent:jobsUpdated', { folderPath, jobs } satisfies AgentJobsPayload)
  },
  onEventsUpdated: (folderPath: string, events: AgentRuntimeEvent[]) => {
    mainWindow?.webContents.send('agent:eventsUpdated', { folderPath, events } satisfies AgentEventsPayload)
  },
  onTaskVerified: (folderPath: string, taskId: string, output: string) => {
    const memory = loadStructuredMemory(folderPath)
    const task = memory.tasks.items.find(item => item.id === taskId)
    if (!task) return
    task.status = 'done'
    if (task.runs && task.runs.length > 0) {
      const prior = task.runs[0].summary || ''
      task.runs[0] = { ...task.runs[0], summary: `${prior}\n\nVerification passed.\n${output.slice(0, 1200)}`.trim() }
    }
    persistStructuredMemory(folderPath, memory)
    mainWindow?.webContents.send('agent:memoryUpdated', flattenStructuredMemory(memory))
    mainWindow?.webContents.send('tasks:updated', { folderPath, tasks: memory.tasks.items })
  },
  onTasksSuggested: (folderPath: string, job: AgentJob, tasks: string[]) => {
    const policy = readAgentConfig(folderPath).guardrails?.runtime
    if (!policy?.autoCreateSuggestedTasks || tasks.length === 0) return
    const cappedTasks = tasks.slice(0, Math.max(1, policy.maxSuggestedTasksPerJob || 1))
    const memory = loadStructuredMemory(folderPath)
    const existing = new Set(memory.tasks.items.filter(item => item.status === 'open' || item.status === 'suggested').map(item => item.text.trim().toLowerCase()))
    let added = false
    for (const text of cappedTasks) {
      const normalized = text.trim()
      if (!normalized) continue
      const key = normalized.toLowerCase()
      if (existing.has(key)) continue
      memory.tasks.items.unshift({
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: normalized,
        status: 'suggested',
        source: 'agent',
        suggestedByJobId: job.id,
        runs: [],
      })
      existing.add(key)
      added = true
    }
    if (!added) return
    persistStructuredMemory(folderPath, memory)
    mainWindow?.webContents.send('agent:memoryUpdated', flattenStructuredMemory(memory))
    mainWindow?.webContents.send('tasks:updated', { folderPath, tasks: memory.tasks.items })
  },
  onChainsArchived: (folderPath: string, jobs: AgentJob[]) => {
    if (jobs.length === 0) return
    const memory = loadStructuredMemory(folderPath)
    let archivedAgentHistory = memory.archivedAgentHistory.trimEnd()
    let changed = false
    for (const job of jobs) {
      const marker = `[agent-archive:${job.id}]`
      if (archivedAgentHistory.includes(marker)) continue
      const summary = (job.structuredResult?.summary || job.summary || 'Resolved agent chain archived.').split(/\r?\n/)[0]
      const line = `- ${marker} ${job.title}: ${summary}`
      archivedAgentHistory = archivedAgentHistory.includes('_None yet._')
        ? archivedAgentHistory.replace('_None yet._', line)
        : `${archivedAgentHistory}\n${line}`.trim()
      changed = true
    }
    if (!changed) return
    memory.archivedAgentHistory = archivedAgentHistory
    persistStructuredMemory(folderPath, memory)
    mainWindow?.webContents.send('agent:memoryUpdated', flattenStructuredMemory(memory))
  },
}
function getAgentConfigPath(folderPath: string) { return join(folderPath, AGENT_DIR, 'agent.json') }
function readAgentConfig(folderPath: string): AgentConfig { return normalizeAgentConfig(JSON.parse(readFileSync(getAgentConfigPath(folderPath), 'utf-8'))) }
function writeAgentConfig(folderPath: string, config: AgentConfig) { writeFileSync(getAgentConfigPath(folderPath), JSON.stringify(normalizeAgentConfig(config), null, 2), 'utf-8') }
function getMemoryPaths(folderPath: string) { const memoryDir = join(folderPath, AGENT_DIR, 'memory'); return { dir: memoryDir, project: join(memoryDir, 'project.md'), decisions: join(memoryDir, 'decisions.md'), preferences: join(memoryDir, 'preferences.md'), archivedAgentHistory: join(memoryDir, 'agent-history.md'), tasks: join(memoryDir, 'tasks.json'), chat: join(memoryDir, 'chat.json'), legacy: join(folderPath, AGENT_DIR, 'memory.md') } }
function normalizeTaskStatus(status: string | undefined): TaskStatus { return status === 'done' || status === 'open' || status === 'suggested' ? status : 'open' }
function withTaskIds(items: Array<{ id?: string; text: string; status: TaskStatus; source?: TaskSource; suggestedByJobId?: string; archivedFromJobId?: string; runs?: TaskRun[] }>): TaskItem[] { return items.map((item) => ({ id: item.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: item.text, status: normalizeTaskStatus(item.status), source: item.source === 'agent' ? 'agent' : 'user', suggestedByJobId: typeof item.suggestedByJobId === 'string' ? item.suggestedByJobId : undefined, archivedFromJobId: typeof item.archivedFromJobId === 'string' ? item.archivedFromJobId : undefined, runs: item.runs || [] })) }
function ensureStructuredMemory(folderPath: string, projectName: string): StructuredMemory { const paths = getMemoryPaths(folderPath); if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true }); const legacyExists = existsSync(paths.legacy); const legacy = legacyExists ? readFileSync(paths.legacy, 'utf-8') : `# ${projectName} — Agent Memory\n\n## What I Know\n\n_Nothing yet. Start a conversation._\n`; if (!existsSync(paths.project)) writeFileSync(paths.project, legacy, 'utf-8'); if (!existsSync(paths.decisions)) writeFileSync(paths.decisions, '# Decisions\n\n_None yet._\n', 'utf-8'); if (!existsSync(paths.preferences)) writeFileSync(paths.preferences, '# Preferences\n\n_None yet._\n', 'utf-8'); if (!existsSync(paths.archivedAgentHistory)) writeFileSync(paths.archivedAgentHistory, '# Archived Agent History\n\n_None yet._\n', 'utf-8'); if (!existsSync(paths.tasks)) writeFileSync(paths.tasks, JSON.stringify({ items: [] }, null, 2), 'utf-8'); if (!existsSync(paths.chat)) writeFileSync(paths.chat, JSON.stringify({ messages: [] }, null, 2), 'utf-8'); const structured = loadStructuredMemory(folderPath); writeLegacyMemorySnapshot(folderPath, structured); return structured }
function loadStructuredMemory(folderPath: string): StructuredMemory { const paths = getMemoryPaths(folderPath); const rawTasks = existsSync(paths.tasks) ? JSON.parse(readFileSync(paths.tasks, 'utf-8')) : { items: [] }; const memory: StructuredMemory = { project: existsSync(paths.project) ? readFileSync(paths.project, 'utf-8') : '# Project\n\n_None yet._\n', decisions: existsSync(paths.decisions) ? readFileSync(paths.decisions, 'utf-8') : '# Decisions\n\n_None yet._\n', preferences: existsSync(paths.preferences) ? readFileSync(paths.preferences, 'utf-8') : '# Preferences\n\n_None yet._\n', archivedAgentHistory: existsSync(paths.archivedAgentHistory) ? readFileSync(paths.archivedAgentHistory, 'utf-8') : '# Archived Agent History\n\n_None yet._\n', tasks: { items: withTaskIds(Array.isArray(rawTasks.items) ? rawTasks.items : []) } }; writeFileSync(paths.tasks, JSON.stringify(memory.tasks, null, 2), 'utf-8'); return memory }
function flattenStructuredMemory(memory: StructuredMemory): string { return ['# Project Memory', '', memory.project.trim(), '', '# Decisions', '', memory.decisions.trim(), '', '# Preferences', '', memory.preferences.trim(), '', '# Archived Agent History', '', memory.archivedAgentHistory.trim(), '', '# Tasks', '', memory.tasks.items.length ? memory.tasks.items.map((item) => `- [${item.status === 'done' ? 'x' : item.status === 'suggested' ? '?' : ' '}] ${item.text}`).join('\n') : '_None yet._'].join('\n') }
function writeLegacyMemorySnapshot(folderPath: string, memory: StructuredMemory) { writeFileSync(getMemoryPaths(folderPath).legacy, flattenStructuredMemory(memory), 'utf-8') }
function persistStructuredMemory(folderPath: string, memory: StructuredMemory) { const paths = getMemoryPaths(folderPath); if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true }); const normalized = { ...memory, tasks: { items: withTaskIds(memory.tasks.items) } }; writeFileSync(paths.project, normalized.project, 'utf-8'); writeFileSync(paths.decisions, normalized.decisions, 'utf-8'); writeFileSync(paths.preferences, normalized.preferences, 'utf-8'); writeFileSync(paths.archivedAgentHistory, normalized.archivedAgentHistory, 'utf-8'); writeFileSync(paths.tasks, JSON.stringify(normalized.tasks, null, 2), 'utf-8'); writeLegacyMemorySnapshot(folderPath, normalized) }
function getAgentJobs(folderPath: string) { return listAgentJobs(folderPath) }
function getAgentEvents(folderPath: string) { return listAgentEvents(folderPath) }
function getChatHistory(folderPath: string): ChatMessage[] { const path = getMemoryPaths(folderPath).chat; if (!existsSync(path)) return []; try { const parsed = JSON.parse(readFileSync(path, 'utf-8')); return Array.isArray(parsed.messages) ? parsed.messages.filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string').slice(-MAX_CHAT_HISTORY) : [] } catch { return [] } }
function persistChatHistory(folderPath: string, messages: ChatMessage[]) { const paths = getMemoryPaths(folderPath); if (!existsSync(paths.dir)) mkdirSync(paths.dir, { recursive: true }); writeFileSync(paths.chat, JSON.stringify({ messages: messages.slice(-MAX_CHAT_HISTORY) }, null, 2), 'utf-8') }
function summarizeDecisionLines(decisions: string) { return decisions.split(/\r?\n/).map(line => line.replace(/^[-*#\s]+/, '').trim()).filter(Boolean).slice(0, 4) }
function getTasks(folderPath: string) { return loadStructuredMemory(folderPath).tasks.items }
function addTask(folderPath: string, text: string, options?: AddTaskOptions) { const memory = loadStructuredMemory(folderPath); const source = options?.source === 'agent' ? 'agent' : 'user'; const existing = options?.archivedFromJobId ? memory.tasks.items.find((task) => task.archivedFromJobId === options.archivedFromJobId && task.status !== 'done') : null; if (existing) return memory.tasks.items; memory.tasks.items.unshift({ id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, status: source === 'agent' ? 'suggested' : 'open', source, suggestedByJobId: options?.suggestedByJobId, archivedFromJobId: options?.archivedFromJobId, runs: [] }); persistStructuredMemory(folderPath, memory); return memory.tasks.items }
function updateTask(folderPath: string, taskId: string, updates: Partial<Pick<TaskItem, 'text' | 'status'>>) { const memory = loadStructuredMemory(folderPath); const priorTask = memory.tasks.items.find(task => task.id === taskId); memory.tasks.items = memory.tasks.items.map(task => task.id === taskId ? { ...task, ...updates, status: updates.status ? normalizeTaskStatus(updates.status) : task.status, source: task.source || 'user' } : task); persistStructuredMemory(folderPath, memory); const updatedTask = memory.tasks.items.find(task => task.id === taskId); if (priorTask?.status === 'suggested' && updatedTask && updatedTask.status !== 'suggested' && priorTask.suggestedByJobId) acknowledgeAgentJob(folderPath, priorTask.suggestedByJobId, `Acknowledged by task ${updatedTask.status}.`, runtimeDeps); return memory.tasks.items }
function deleteTask(folderPath: string, taskId: string) { const memory = loadStructuredMemory(folderPath); const priorTask = memory.tasks.items.find(task => task.id === taskId); memory.tasks.items = memory.tasks.items.filter(task => task.id !== taskId); persistStructuredMemory(folderPath, memory); if (priorTask?.status === 'suggested' && priorTask.suggestedByJobId) acknowledgeAgentJob(folderPath, priorTask.suggestedByJobId, 'Acknowledged by deleting linked suggested task.', runtimeDeps); return memory.tasks.items }

async function runTaskExecution(folderPath: string, taskId: string, event: Electron.IpcMainInvokeEvent) {
  const memory = loadStructuredMemory(folderPath)
  const task = memory.tasks.items.find(t => t.id === taskId)
  if (!task) throw new Error('Task not found')
  if (task.status === 'suggested') throw new Error('Accept the suggested task before running it.')
  const run: TaskRun = { id: `run-${Date.now()}`, startedAt: Date.now(), status: 'running', filesTouched: [], commands: [], trace: [], planSnapshots: [], activityLog: [] }
  task.runs = [run, ...(task.runs || [])].slice(0, MAX_TASK_RUNS)
  persistStructuredMemory(folderPath, memory)
  try {
    const finalResponse = await runAgentLoop(`Work on this task: ${task.text}\n\nInspect relevant files, make the necessary changes safely, and summarize the result.`, [], { folderPath, memory: flattenStructuredMemory(memory), profile: readAgentConfig(folderPath), onToken: (token) => event.sender.send('agent:token', token), onToolCall: (name, args) => event.sender.send('agent:toolCall', { name, args }), onToolResult: (name, result) => event.sender.send('agent:toolResult', { name, result }), onPlan: (plan) => {
      event.sender.send('agent:plan', plan)
      const current = loadStructuredMemory(folderPath)
      const currentTask = current.tasks.items.find(t => t.id === taskId)
      const currentRun = currentTask?.runs?.find(r => r.id === run.id)
      if (!currentTask || !currentRun) return
      currentRun.planSnapshots = [...(currentRun.planSnapshots || []), { goal: plan.goal, steps: plan.steps, ts: Date.now() }].slice(-MAX_PLAN_SNAPSHOTS)
      persistStructuredMemory(folderPath, current)
    }, onActivity: (entry) => {
      event.sender.send('agent:activity', entry)
      const current = loadStructuredMemory(folderPath)
      const currentTask = current.tasks.items.find(t => t.id === taskId)
      const currentRun = currentTask?.runs?.find(r => r.id === run.id)
      if (!currentTask || !currentRun) return
      currentRun.activityLog = [...(currentRun.activityLog || []), entry].slice(-MAX_ACTIVITY_LOG)
      persistStructuredMemory(folderPath, current)
    }, onApprovalRequest: (request) => new Promise<boolean>((resolve) => { pendingApprovals.set(request.id, resolve); event.sender.send('agent:approvalRequested', request) }), onTrace: (trace) => {
      const current = loadStructuredMemory(folderPath)
      const currentTask = current.tasks.items.find(t => t.id === taskId)
      const currentRun = currentTask?.runs?.find(r => r.id === run.id)
      if (!currentTask || !currentRun) return
      currentRun.trace = [...(currentRun.trace || []), { tool: trace.tool, detail: trace.detail, ts: trace.ts, diff: trace.diff }].slice(-MAX_TRACE_ENTRIES)
      if (trace.file) currentRun.filesTouched = Array.from(new Set([...(currentRun.filesTouched || []), trace.file]))
      if (trace.command) currentRun.commands = Array.from(new Set([...(currentRun.commands || []), trace.command]))
      persistStructuredMemory(folderPath, current)
    } })
    const refreshed = loadStructuredMemory(folderPath)
    const refreshedTask = refreshed.tasks.items.find(t => t.id === taskId)
    if (refreshedTask) {
      const currentRun = (refreshedTask.runs || []).find(r => r.id === run.id)
      const touchedFiles = currentRun?.filesTouched?.length || 0
      const ranCommands = currentRun?.commands?.length || 0
      const verificationPending = touchedFiles > 0 || ranCommands > 0
      const summary = verificationPending
        ? `${finalResponse}\n\nVerification pending: the agent changed files or ran commands. Keep this task open until verification jobs pass.`
        : finalResponse
      refreshedTask.status = verificationPending ? refreshedTask.status : 'done'
      refreshedTask.runs = (refreshedTask.runs || []).map(r => r.id === run.id ? { ...r, status: 'completed', completedAt: Date.now(), durationMs: Date.now() - r.startedAt, summary } : r)
      if (verificationPending) {
        queueTaskVerificationJob(folderPath, taskId, currentRun?.filesTouched || [], runtimeDeps)
      }
      persistStructuredMemory(folderPath, refreshed)
      event.sender.send('agent:memoryUpdated', flattenStructuredMemory(refreshed))
    }
    kickAgentRuntime(folderPath, runtimeDeps)
    return { response: finalResponse, tasks: refreshed.tasks.items }
  } catch (e: any) {
    const failed = loadStructuredMemory(folderPath)
    const failedTask = failed.tasks.items.find(t => t.id === taskId)
    if (failedTask) {
      failedTask.runs = (failedTask.runs || []).map(r => r.id === run.id ? { ...r, status: 'failed', completedAt: Date.now(), durationMs: Date.now() - r.startedAt, summary: e.message } : r)
      persistStructuredMemory(folderPath, failed)
    }
    throw e
  }
}

async function getGitStatus(folderPath: string): Promise<GitStatus> { try { const { stdout: inside } = await execAsync('git rev-parse --is-inside-work-tree', { cwd: folderPath }); if (!inside.trim().includes('true')) return { isRepo: false, branch: null, changedFiles: [], stagedFiles: [], untrackedFiles: [], aheadBehind: null, suggestedCommitMessage: null }; const [{ stdout: branchOut }, { stdout: statusOut }, { stdout: aheadBehindOut }] = await Promise.all([execAsync('git branch --show-current', { cwd: folderPath }), execAsync('git status --short', { cwd: folderPath }), execAsync('git status --short --branch', { cwd: folderPath })]); const lines = statusOut.split(/\r?\n/).filter(Boolean); const changedFiles: string[] = []; const stagedFiles: string[] = []; const untrackedFiles: string[] = []; for (const line of lines) { const status = line.slice(0, 2); const file = line.slice(3).trim(); changedFiles.push(file); if (status[0] && status[0] !== ' ' && status[0] !== '?') stagedFiles.push(file); if (status === '??') untrackedFiles.push(file) } const aheadBehindLine = aheadBehindOut.split(/\r?\n/)[0] || ''; const aheadBehindMatch = aheadBehindLine.match(/\[(.*?)\]/); const aheadBehind = aheadBehindMatch?.[1] || null; const suggestedCommitMessage = changedFiles.length > 0 ? buildCommitMessageSuggestion(changedFiles) : null; return { isRepo: true, branch: branchOut.trim() || null, changedFiles: changedFiles.slice(0, 20), stagedFiles: stagedFiles.slice(0, 20), untrackedFiles: untrackedFiles.slice(0, 20), aheadBehind, suggestedCommitMessage } } catch { return { isRepo: false, branch: null, changedFiles: [], stagedFiles: [], untrackedFiles: [], aheadBehind: null, suggestedCommitMessage: null } } }
function buildCommitMessageSuggestion(files: string[]) { const lower = files.map(f => f.toLowerCase()); if (lower.some(f => f.includes('readme') || f.endsWith('.md'))) return 'docs: update project documentation'; if (lower.some(f => f.includes('package.json') || f.includes('lock'))) return 'chore: update project dependencies'; if (lower.some(f => f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.js'))) return 'feat: update application logic and UI'; if (lower.some(f => f.endsWith('.css'))) return 'style: refine application styling'; return 'chore: update workspace files' }
async function collectOnboarding(projectName: string): Promise<Pick<AgentConfig, 'archetype' | 'goals' | 'constraints'>> { if (!mainWindow) return { archetype: 'general', goals: [], constraints: [] }; const { response: archetypeIndex } = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['General', 'Codebase', 'Research', 'Content', 'Operations'], defaultId: 0, cancelId: 0, title: 'Choose folder archetype', message: `What kind of folder is "${projectName}"?`, detail: 'This helps FolderMind adapt its behavior, priorities, and suggestions.' }); const archetypes: AgentConfig['archetype'][] = ['general', 'codebase', 'research', 'content', 'operations']; const archetype = archetypes[archetypeIndex] || 'general'; const goalMap: Record<AgentConfig['archetype'], string[]> = { general: ['Keep the folder organized', 'Help execute tasks quickly'], codebase: ['Ship reliable code changes', 'Keep docs and implementation aligned'], research: ['Synthesize findings clearly', 'Preserve source-backed insights'], content: ['Produce polished content quickly', 'Maintain voice and consistency'], operations: ['Track work clearly', 'Reduce friction in repeatable workflows'] }; const constraintMap: Record<AgentConfig['archetype'], string[]> = { general: ['Do not make risky changes without approval'], codebase: ['Prefer minimal edits', 'Avoid destructive commands without approval'], research: ['Do not invent facts', 'Preserve citations and source context'], content: ['Preserve tone consistency', 'Do not overwrite final assets without approval'], operations: ['Avoid changing core records without approval', 'Keep outputs structured and traceable'] }; return { archetype, goals: goalMap[archetype], constraints: constraintMap[archetype] } }

function createWindow(): void { mainWindow = new BrowserWindow({ width: 1320, height: 860, minWidth: 1040, minHeight: 700, backgroundColor: '#0f0f0f', webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }, title: 'FolderMind' }); if (process.env['ELECTRON_RENDERER_URL']) { mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']); mainWindow.webContents.openDevTools() } else { mainWindow.loadURL(`http://127.0.0.1:${localPort}/index.html`) } mainWindow.on('closed', () => { mainWindow = null }) }
async function seedAgent(folderPath: string, projectName: string): Promise<void> { const agentDir = join(folderPath, AGENT_DIR); if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true }); const agentConfig = getAgentConfigPath(folderPath); if (!existsSync(agentConfig)) { const onboarding = await collectOnboarding(projectName); writeFileSync(agentConfig, JSON.stringify({ name: projectName, created: new Date().toISOString(), model: 'gpt-4o', tone: 'direct, practical, helpful', archetype: onboarding.archetype, goals: onboarding.goals, constraints: onboarding.constraints, guardrails: { requireApprovalForDangerousCommands: true, requireApprovalForFileChanges: true, runtime: getDefaultRuntimePolicy(onboarding.archetype) } }, null, 2)) } ensureStructuredMemory(folderPath, projectName); ensureAgentRuntimeState(folderPath) }
function pushFolderChange(folderPath: string, event: string, filePath: string) { const existing = folderChangeLog.get(folderPath) || []; folderChangeLog.set(folderPath, [...existing, { event, filePath, ts: Date.now() }].slice(-MAX_FOLDER_CHANGE_LOG)) }
function getRecentFolderChanges(folderPath: string) { return (folderChangeLog.get(folderPath) || []).slice(-MAX_RECENT_CHANGES).reverse() }
function scanFolder(folderPath: string) { const files: string[] = []; const walk = (dir: string) => { for (const item of readdirSync(dir)) { if (IGNORED_DIRS.has(item)) continue; const full = join(dir, item); let stat; try { stat = statSync(full) } catch { continue } if (stat.isDirectory()) walk(full); else files.push(relative(folderPath, full)) } }; walk(folderPath); return files }
function heuristicSuggestions(files: string[], changes: FolderChangeEvent[], config?: AgentConfig, git?: GitStatus) { const suggestions: string[] = []; const lower = files.map(f => f.toLowerCase()); if (config?.archetype === 'codebase') suggestions.push('Ask FolderMind for an implementation plan, diff review, or codebase audit.'); if (config?.archetype === 'research') suggestions.push('Ask FolderMind to synthesize findings, extract insights, or identify knowledge gaps.'); if (config?.archetype === 'content') suggestions.push('Ask FolderMind to draft, revise, or repurpose content in the folder’s voice.'); if (config?.archetype === 'operations') suggestions.push('Ask FolderMind to summarize status, update trackers, or standardize workflows.'); if (lower.some(f => f.endsWith('.csv'))) suggestions.push('New or existing CSV data detected — ask FolderMind to profile the data or generate a report.'); if (lower.some(f => f.includes('readme')) && changes.some(c => /src|package|main|app/i.test(c.filePath))) suggestions.push('Code files changed recently — review whether README or docs should be updated.'); if (changes.some(c => /package\.json|requirements|pnpm-lock|package-lock/i.test(c.filePath))) suggestions.push('Dependency-related files changed — consider checking install/build health.'); if (changes.length >= 3) suggestions.push('Several files changed recently — generate a “what changed” summary before continuing work.'); if (git?.isRepo && git.changedFiles.length > 0) suggestions.push('Git changes detected — ask FolderMind to summarize diffs or draft a commit message.'); if (suggestions.length === 0) suggestions.push('Ask FolderMind for a folder audit, next-step plan, or implementation pass.'); return [...new Set(suggestions)].slice(0, 5) }
async function generateFolderBriefing(folderPath: string, folderName: string): Promise<FolderBriefing> { const files = scanFolder(folderPath); const topFiles = files.slice(0, 8); const recentChanges = getRecentFolderChanges(folderPath).map(change => `${change.event}: ${relative(folderPath, change.filePath)}`); const config = readAgentConfig(folderPath); const structured = loadStructuredMemory(folderPath); const git = await getGitStatus(folderPath); const suggestions = heuristicSuggestions(files, getRecentFolderChanges(folderPath), config, git); const memory = flattenStructuredMemory(structured); const openTasks = structured.tasks.items.filter(item => item.status === 'open' || item.status === 'suggested').map(item => item.status === 'suggested' ? `[Suggested] ${item.text}` : item.text).slice(0, 4); const keyDecisions = summarizeDecisionLines(structured.decisions); const ai = getOpenAI(); let summary = `${folderName} is configured as a ${config.archetype} workspace with ${files.length} files in scope.`; if (ai) { try { const res = await ai.chat.completions.create({ model: 'gpt-4o', temperature: 0.2, messages: [{ role: 'system', content: 'You generate concise folder briefings. Return a short paragraph that explains what the folder likely is, what matters now, and what the user should consider next.' }, { role: 'user', content: `Folder: ${folderName}
Archetype: ${config.archetype}
Goals: ${config.goals.join('; ')}
Constraints: ${config.constraints.join('; ')}

Memory:
${memory}

Files (${files.length}):
${topFiles.join('\\n') || '_No files_'}

Recent Changes:
${recentChanges.join('\\n') || '_None_'}

Open Tasks:
${openTasks.join('\\n') || '_None_'}

Key Decisions:
${keyDecisions.join('\\n') || '_None_'}

Git:
${JSON.stringify(git, null, 2)}

Suggestions:
${suggestions.join('\\n')}` }] }); summary = res.choices[0].message.content || summary } catch {} } return { summary, fileCount: files.length, topFiles, recentChanges, suggestions, keyDecisions, openTasks, git } }
function watchFolder(folderPath: string): void { activeFolderPath = folderPath; if (activeWatcher) activeWatcher.close(); activeWatcher = chokidar.watch(folderPath, { ignored: /(^|[/\\])\.(foldermind|git)|node_modules|out|dist|release/, persistent: true, ignoreInitial: true }); activeWatcher.on('all', (event, filePath) => { const change = { event, filePath, ts: Date.now() }; pushFolderChange(folderPath, event, filePath); notifyAgentFileChange(folderPath, change, runtimeDeps); mainWindow?.webContents.send('folder:changed', { event, filePath }) }) }

ipcMain.handle('folder:create', async () => { if (!mainWindow) return null; const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Choose or Create a Smart Folder', buttonLabel: 'Make it Smart' }); if (result.canceled || !result.filePaths.length) return null; const folderPath = result.filePaths[0]; const name = folderPath.split(/[\\/]/).pop() || 'Project'; await seedAgent(folderPath, name); watchFolder(folderPath); kickAgentRuntime(folderPath, runtimeDeps); const structured = loadStructuredMemory(folderPath); return { path: folderPath, name, agentConfig: readAgentConfig(folderPath), memory: flattenStructuredMemory(structured) } })
ipcMain.handle('folder:open', async () => { if (!mainWindow) return null; const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Open Smart Folder' }); if (result.canceled || !result.filePaths.length) return null; const folderPath = result.filePaths[0]; const name = folderPath.split(/[\\/]/).pop() || 'Project'; await seedAgent(folderPath, name); watchFolder(folderPath); kickAgentRuntime(folderPath, runtimeDeps); const structured = loadStructuredMemory(folderPath); return { path: folderPath, name, agentConfig: readAgentConfig(folderPath), memory: flattenStructuredMemory(structured) } })
ipcMain.handle('folder:activate', async (_event, folderPath: string) => { if (!existsSync(folderPath)) return null; const name = folderPath.split(/[\\/]/).pop() || 'Project'; await seedAgent(folderPath, name); watchFolder(folderPath); kickAgentRuntime(folderPath, runtimeDeps); const structured = loadStructuredMemory(folderPath); return { path: folderPath, name, agentConfig: readAgentConfig(folderPath), memory: flattenStructuredMemory(structured) } })
ipcMain.handle('folder:getBriefing', async (_event, folderPath: string, folderName: string) => { try { return await generateFolderBriefing(folderPath, folderName) } catch (e: any) { return { summary: `Unable to generate briefing: ${e.message}`, fileCount: 0, topFiles: [], recentChanges: [], suggestions: [], keyDecisions: [], openTasks: [], git: { isRepo: false, branch: null, changedFiles: [], stagedFiles: [], untrackedFiles: [], aheadBehind: null, suggestedCommitMessage: null } } } })
ipcMain.handle('folder:getGitStatus', async (_event, folderPath: string) => getGitStatus(folderPath))
ipcMain.handle('folder:getConfig', async (_event, folderPath: string) => readAgentConfig(folderPath))
ipcMain.handle('agent:listJobs', async (_event, folderPath: string) => getAgentJobs(folderPath))
ipcMain.handle('agent:listEvents', async (_event, folderPath: string) => getAgentEvents(folderPath))
ipcMain.handle('agent:runJobs', async (_event, folderPath: string) => { kickAgentRuntime(folderPath, runtimeDeps); return getAgentJobs(folderPath) })
ipcMain.handle('agent:approveJob', async (_event, folderPath: string, jobId: string) => approveAgentJob(folderPath, jobId, runtimeDeps))
ipcMain.handle('agent:retryJob', async (_event, folderPath: string, jobId: string) => retryAgentJob(folderPath, jobId, runtimeDeps))
ipcMain.handle('agent:dismissJob', async (_event, folderPath: string, jobId: string, reason?: string) => dismissAgentJob(folderPath, jobId, reason, runtimeDeps))
ipcMain.handle('chat:getHistory', async (_event, folderPath: string) => getChatHistory(folderPath))
ipcMain.handle('chat:clearHistory', async (_event, folderPath: string) => { persistChatHistory(folderPath, []); return true })
ipcMain.handle('folder:updateConfig', async (_event, folderPath: string, updates: Partial<Pick<AgentConfig, 'tone' | 'archetype' | 'goals' | 'constraints' | 'guardrails'>>) => { const current = readAgentConfig(folderPath); const updated = normalizeAgentConfig({ ...current, ...updates, guardrails: { ...current.guardrails, ...(updates.guardrails || {}), runtime: { ...current.guardrails.runtime, ...(updates.guardrails?.runtime || {}) } } }); writeAgentConfig(folderPath, updated); return updated })
ipcMain.handle('tasks:list', async (_event, folderPath: string) => getTasks(folderPath))
ipcMain.handle('tasks:add', async (_event, folderPath: string, text: string, options?: AddTaskOptions) => addTask(folderPath, text, options))
ipcMain.handle('tasks:update', async (_event, folderPath: string, taskId: string, updates: Partial<Pick<TaskItem, 'text' | 'status'>>) => updateTask(folderPath, taskId, updates))
ipcMain.handle('tasks:delete', async (_event, folderPath: string, taskId: string) => deleteTask(folderPath, taskId))
ipcMain.handle('tasks:run', async (event, folderPath: string, taskId: string) => runTaskExecution(folderPath, taskId, event))

ipcMain.handle('agent:chat', async (event, folderPath: string, message: string, history: any[], memory: string) => { if (isRateLimited()) return '⚠️ Rate limit: too many AI calls. Please wait a moment before sending another message.'; try { const finalResponse = await runAgentLoop(message, history, { folderPath, memory, profile: readAgentConfig(folderPath), onToken: (token) => event.sender.send('agent:token', token), onToolCall: (name, args) => event.sender.send('agent:toolCall', { name, args }), onToolResult: (name, result) => event.sender.send('agent:toolResult', { name, result }), onPlan: (plan) => event.sender.send('agent:plan', plan), onActivity: (entry) => event.sender.send('agent:activity', entry), onApprovalRequest: (request) => new Promise<boolean>((resolve) => { pendingApprovals.set(request.id, resolve); event.sender.send('agent:approvalRequested', request) }) }); const persistedHistory = [...getChatHistory(folderPath), { role: 'user', content: message, ts: Date.now() }, { role: 'assistant', content: finalResponse, ts: Date.now() }]; persistChatHistory(folderPath, persistedHistory); if (history.length > 0 && history.length % 5 === 0) { const currentStructured = loadStructuredMemory(folderPath); const conv = history.map(h => `${h.role}: ${h.content}`).join('\n') + `\nuser: ${message}\nassistant: ${finalResponse}`; const extracted = await extractStructuredMemory(folderPath, currentStructured, conv); const merged: StructuredMemory = { ...currentStructured, ...extracted, tasks: { items: withTaskIds(extracted.tasks.items) } }; const refreshedProject = await updateMemoryAgent(folderPath, flattenStructuredMemory(merged), conv); merged.project = refreshedProject || merged.project; persistStructuredMemory(folderPath, merged); event.sender.send('agent:memoryUpdated', flattenStructuredMemory(merged)) } return finalResponse } catch (e: any) { console.error('Agent chat error:', e); return `⚠️ Error: ${e.message}` } })

ipcMain.handle('agent:approve', (_e, approvalId: string, approved: boolean) => { const resolver = pendingApprovals.get(approvalId); if (resolver) { resolver(approved); pendingApprovals.delete(approvalId); return true } return false })
ipcMain.handle('agent:setKey', (_e, key: string) => { setApiKey(key); if (activeFolderPath) kickAgentRuntime(activeFolderPath, runtimeDeps); return true })
ipcMain.handle('agent:status', () => ({ hasApiKey: hasApiKey() || !!(process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY) }))
ipcMain.handle('voice:transcribe', async (_e, audioBase64: string) => {
  const jobId = randomUUID()
  voiceTranscriptions.set(jobId, { status: 'processing' })
  try {
    const key = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    if (!key) throw new Error('OpenAI API key is not set.')
    const ai = new OpenAI({ apiKey: key })
    const buffer = Buffer.from(audioBase64, 'base64')
    const blob = new Blob([buffer], { type: 'audio/webm' })
    const file = new File([blob], 'voice.webm', { type: 'audio/webm' })
    const result = await ai.audio.transcriptions.create({ file, model: 'gpt-4o-mini-transcribe' as any })
    voiceTranscriptions.set(jobId, { status: 'completed', text: (result as any).text || '' })
    return { jobId }
  } catch (error: any) {
    voiceTranscriptions.set(jobId, { status: 'failed', error: error?.message || 'Voice transcription failed.' })
    return { jobId }
  }
})
ipcMain.handle('voice:getResult', async (_e, jobId: string) => voiceTranscriptions.get(jobId) || { status: 'failed', error: 'Voice transcription job not found.' })
ipcMain.handle('voice:speak', async (_e, text: string) => {
  const jobId = randomUUID()
  voiceSpeech.set(jobId, { status: 'processing' })
  try {
    const key = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    if (!key) throw new Error('OpenAI API key is not set.')
    const ai = new OpenAI({ apiKey: key })
    const response = await ai.audio.speech.create({
      model: 'gpt-4o-mini-tts' as any,
      voice: 'alloy' as any,
      input: text,
      format: 'mp3' as any,
    })
    const arrayBuffer = await response.arrayBuffer()
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64')
    voiceSpeech.set(jobId, { status: 'completed', audioBase64, mimeType: 'audio/mpeg' })
    return { jobId }
  } catch (error: any) {
    voiceSpeech.set(jobId, { status: 'failed', error: error?.message || 'Voice synthesis failed.' })
    return { jobId }
  }
})
ipcMain.handle('voice:getSpeechResult', async (_e, jobId: string) => voiceSpeech.get(jobId) || { status: 'failed', error: 'Voice speech job not found.' })
ipcMain.handle('folder:openInExplorer', (_e, folderPath: string, target: string) => shell.openPath(target ? join(folderPath, target) : folderPath))

// ── Memory read/write ────────────────────────────────────────────────────────
ipcMain.handle('memory:read', (_e, folderPath: string) => {
  const structured = loadStructuredMemory(folderPath)
  return { project: structured.project, decisions: structured.decisions, preferences: structured.preferences, archivedAgentHistory: structured.archivedAgentHistory }
})
ipcMain.handle('memory:write', (_e, folderPath: string, updates: { project?: string; decisions?: string; preferences?: string; archivedAgentHistory?: string }) => {
  const current = loadStructuredMemory(folderPath)
  const updated: StructuredMemory = {
    ...current,
    project: updates.project ?? current.project,
    decisions: updates.decisions ?? current.decisions,
    preferences: updates.preferences ?? current.preferences,
    archivedAgentHistory: updates.archivedAgentHistory ?? current.archivedAgentHistory,
  }
  persistStructuredMemory(folderPath, updated)
  return true
})

// ── Git operations (use execFile to prevent shell injection) ─────────────────

ipcMain.handle('git:stageFile', async (_e, folderPath: string, filepath: string) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['add', '--', filepath], { cwd: folderPath })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e: any) { return { ok: false, output: e.message } }
})

ipcMain.handle('git:unstageFile', async (_e, folderPath: string, filepath: string) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['restore', '--staged', '--', filepath], { cwd: folderPath })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e: any) { return { ok: false, output: e.message } }
})

ipcMain.handle('git:stageAll', async (_e, folderPath: string) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['add', '.'], { cwd: folderPath })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e: any) { return { ok: false, output: e.message } }
})

ipcMain.handle('git:commit', async (_e, folderPath: string, message: string) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['commit', '-m', message], { cwd: folderPath })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e: any) { return { ok: false, output: e.message } }
})

ipcMain.handle('git:push', async (_e, folderPath: string) => {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['push'], { cwd: folderPath, timeout: 30000 })
    return { ok: true, output: (stdout + stderr).trim() }
  } catch (e: any) { return { ok: false, output: e.message } }
})

ipcMain.handle('git:getFileDiff', async (_e, folderPath: string, filepath: string, staged: boolean) => {
  try {
    const args = staged ? ['diff', '--cached', '--', filepath] : ['diff', '--', filepath]
    const { stdout } = await execFileAsync('git', args, { cwd: folderPath })
    return { ok: true, diff: stdout || '(no diff output)' }
  } catch (e: any) { return { ok: false, diff: '' } }
})

const ALLOWED_PERMISSIONS = new Set(['media', 'audioCapture', 'microphone'])
app.whenReady().then(async () => { await startLocalServer(); session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission))); session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission)); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() }) })
app.on('window-all-closed', () => { activeWatcher?.close(); if (process.platform !== 'darwin') app.quit() })
process.on('uncaughtException', (err) => { console.error('[FolderMind] Uncaught exception:', err) })












