import { OpenAI } from 'openai'
import { dirname, join, normalize, relative, resolve } from 'path'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

let openai: OpenAI | null = null

export function setApiKey(key: string) {
  openai = new OpenAI({ apiKey: key })
}

export function hasApiKey() {
  return openai !== null
}

const getOpenAI = () => {
  if (!openai) {
    const key = process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY
    if (key) {
      openai = new OpenAI({ apiKey: key })
    } else {
      throw new Error('OpenAI API key is not set.')
    }
  }
  return openai
}

interface AgentProfile {
  name?: string
  archetype?: string
  tone?: string
  goals?: string[]
  constraints?: string[]
  guardrails?: Record<string, unknown>
}

interface StructuredMemory {
  project: string
  decisions: string
  preferences: string
  tasks: { items: Array<{ text: string; status: 'open' | 'done' }> }
}

interface AgentContext {
  folderPath: string
  memory: string
  profile?: AgentProfile
  onToken: (token: string) => void
  onToolCall: (toolName: string, args: any) => void
  onToolResult: (toolName: string, result: string) => void
  onPlan?: (plan: PlanState) => void
  onActivity?: (entry: ActivityEntry) => void
  onApprovalRequest?: (request: ApprovalRequest) => Promise<boolean>
  onTrace?: (entry: { tool: string; detail: string; ts: number; file?: string; command?: string; diff?: string }) => void
}

interface ActivityEntry {
  kind: 'thought' | 'tool' | 'result' | 'approval' | 'system'
  message: string
  ts: number
}

interface PlanState {
  goal: string
  steps: { id: string; text: string; status: 'pending' | 'active' | 'done' }[]
}

interface ApprovalRequest {
  id: string
  type: 'command' | 'file_change'
  title: string
  description: string
  command?: string
  filepath?: string
  diff?: string
}

const IGNORED_DIRS = new Set(['.foldermind', 'node_modules', '.git', 'dist', 'out', 'release'])
const READ_LIMIT = 20000
const COMMAND_LIMIT = 20000
const DIFF_LIMIT = 12000
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+clean\b/i,
  /\bnpm\s+publish\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\binvoke-webrequest\b/i,
  // Shell metacharacters that enable injection / chaining
  /[|;&`]/,
  // Command substitution
  /\$\(/,
  // Privilege escalation
  /\bsudo\b/i,
  /\bsu\s/i,
  // Permission / ownership changes
  /\bchmod\b/i,
  /\bchown\b/i,
  // Output redirection (overwrite)
  /(?<![<])[>]/,
  // Disk / partition tools
  /\bdd\b/i,
  /\bmkfs\b/i,
  /\bfdisk\b/i,
]

function safeJoin(folderPath: string, target: string) {
  const resolvedBase = resolve(folderPath)
  const resolvedTarget = resolve(resolvedBase, normalize(target || '.'))
  const rel = relative(resolvedBase, resolvedTarget)
  if (rel.startsWith('..') || rel.includes(':')) {
    throw new Error(`Path escapes folder boundary: ${target}`)
  }
  return resolvedTarget
}

function truncate(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit)}\n...[TRUNCATED]` : text
}

function buildPlan(userMessage: string): PlanState {
  return {
    goal: userMessage,
    steps: [
      { id: 'inspect', text: 'Inspect relevant files and folder structure', status: 'active' },
      { id: 'act', text: 'Make the necessary changes or run the necessary actions', status: 'pending' },
      { id: 'report', text: 'Summarize outcomes and next steps', status: 'pending' },
    ],
  }
}

function markPlan(plan: PlanState, activeId: string, doneIds: string[] = []): PlanState {
  return {
    ...plan,
    steps: plan.steps.map(step => ({
      ...step,
      status: doneIds.includes(step.id) ? 'done' : step.id === activeId ? 'active' : step.status === 'done' ? 'done' : 'pending',
    })),
  }
}

function needsApproval(command: string) {
  return DANGEROUS_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

function searchInTree(folderPath: string, query: string, subpath = '.') {
  const root = safeJoin(folderPath, subpath)
  const results: string[] = []

  const walk = (dir: string) => {
    for (const item of readdirSync(dir)) {
      if (IGNORED_DIRS.has(item)) continue
      const full = join(dir, item)
      let stat
      try {
        stat = statSync(full)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        walk(full)
        continue
      }
      try {
        const content = readFileSync(full, 'utf-8')
        const lines = content.split(/\r?\n/)
        lines.forEach((line, index) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            results.push(`${relative(folderPath, full)}:${index + 1}: ${line.trim()}`)
          }
        })
      } catch {
        // ignore non-text files
      }
    }
  }

  walk(root)
  return results.length ? truncate(results.join('\n'), READ_LIMIT) : 'No matches found.'
}

function applyPatchToContent(original: string, findText: string, replaceText: string) {
  if (!findText) throw new Error('findText is required for applyPatch')
  if (!original.includes(findText)) throw new Error('findText not found in file')
  return original.replace(findText, replaceText)
}

function buildSimpleDiff(oldContent: string, newContent: string, filepath: string) {
  const oldLines = oldContent.split(/\r?\n/)
  const newLines = newContent.split(/\r?\n/)
  const max = Math.max(oldLines.length, newLines.length)
  const diff: string[] = [`--- ${filepath}`, `+++ ${filepath}`]

  for (let i = 0; i < max; i++) {
    const before = oldLines[i]
    const after = newLines[i]
    if (before === after) continue
    if (before !== undefined) diff.push(`- ${before}`)
    if (after !== undefined) diff.push(`+ ${after}`)
  }

  return truncate(diff.join('\n') || `No changes for ${filepath}`, DIFF_LIMIT)
}

async function requestFileChangeApproval(
  folderPath: string,
  filepath: string,
  beforeContent: string,
  afterContent: string,
  onApprovalRequest?: (request: ApprovalRequest) => Promise<boolean>,
  onActivity?: (entry: ActivityEntry) => void,
) {
  const relPath = relative(folderPath, safeJoin(folderPath, filepath))
  const diff = buildSimpleDiff(beforeContent, afterContent, relPath)
  const request: ApprovalRequest = {
    id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'file_change',
    title: 'File change approval required',
    description: `The agent wants to modify ${relPath}. Review the diff before applying.`,
    filepath: relPath,
    diff,
  }
  onActivity?.({ kind: 'approval', message: `Approval requested for file change: ${relPath}`, ts: Date.now() })
  return (await onApprovalRequest?.(request)) ?? false
}

export async function runAgentLoop(
  userMessage: string,
  history: { role: 'user' | 'assistant' | 'system', content: string }[],
  context: AgentContext
): Promise<string> {
  const ai = getOpenAI()
  const { folderPath, memory, profile, onToken, onToolCall, onToolResult, onPlan, onActivity, onApprovalRequest, onTrace } = context

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'listDirectory',
        description: 'List contents of a directory to see what files exist.',
        parameters: {
          type: 'object',
          properties: {
            subpath: { type: 'string', description: 'Relative path to list, use "." for root' }
          },
          required: ['subpath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'readFile',
        description: 'Read the contents of a specific file.',
        parameters: {
          type: 'object',
          properties: {
            filepath: { type: 'string', description: 'Relative path of the file to read' }
          },
          required: ['filepath']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'readFileRange',
        description: 'Read a specific line range from a text file.',
        parameters: {
          type: 'object',
          properties: {
            filepath: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' }
          },
          required: ['filepath', 'startLine', 'endLine']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'searchInFiles',
        description: 'Search for a text query across files in the folder.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            subpath: { type: 'string', description: 'Optional relative subpath to search from', default: '.' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'writeFile',
        description: 'Write or overwrite a file with new content. This may require approval.',
        parameters: {
          type: 'object',
          properties: {
            filepath: { type: 'string', description: 'Relative path of the file to write' },
            content: { type: 'string', description: 'Complete content to write to the file' }
          },
          required: ['filepath', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'applyPatch',
        description: 'Modify a file by replacing exact text with new text. This may require approval.',
        parameters: {
          type: 'object',
          properties: {
            filepath: { type: 'string' },
            findText: { type: 'string' },
            replaceText: { type: 'string' }
          },
          required: ['filepath', 'findText', 'replaceText']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'runCommand',
        description: 'Run a shell command in the folder. Potentially dangerous commands may require approval.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The command to run' }
          },
          required: ['command']
        }
      }
    }
  ]

  const profileSection = profile ? `
Agent Profile:
- Name: ${profile.name || 'FolderMind'}
- Archetype: ${profile.archetype || 'general'}
- Tone: ${profile.tone || 'direct, practical, helpful'}
- Goals: ${(profile.goals || []).join('; ') || 'No explicit goals set'}
- Constraints: ${(profile.constraints || []).join('; ') || 'No explicit constraints set'}
` : ''

  const systemPrompt = `You are FolderMind, an autonomous AI desktop agent working inside the user's project folder.
Folder Path: ${folderPath}
${profileSection}
You have access to tools to interact with the file system. Use them to gather context, read files, write code, and run commands.
Do NOT guess file contents. Use listDirectory, searchInFiles, readFile, and readFileRange to inspect the environment.
Prefer applyPatch for targeted edits. Use writeFile only for new files or full rewrites.
When editing, make the smallest safe change needed.
Align your work style to the folder archetype and goals when present.
Respect stated constraints and guardrails.
Use runCommand sparingly and only when necessary.
Maintain a practical execution style: inspect first, act second, summarize last.

Project Memory:
${memory}

When communicating with the user, be concise, direct, and professional.`

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ]

  let plan = buildPlan(userMessage)
  onPlan?.(plan)
  onActivity?.({ kind: 'system', message: 'Started task planning.', ts: Date.now() })

  let finalResponse = ''
  let depth = 0
  const maxDepth = 15

  while (depth < maxDepth) {
    depth++

    const stream = await ai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
      stream: true,
      temperature: 0.2
    })

    let currentResponse = ''
    const toolCalls: any[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      if (delta?.content) {
        currentResponse += delta.content
        onToken(delta.content)
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) {
            toolCalls[tc.index] = {
              id: tc.id,
              type: tc.type,
              function: { name: tc.function?.name || '', arguments: '' }
            }
          }
          if (tc.function?.arguments) {
            toolCalls[tc.index].function.arguments += tc.function.arguments
          }
        }
      }
    }

    if (currentResponse) {
      messages.push({ role: 'assistant', content: currentResponse })
      finalResponse += currentResponse
    }

    if (toolCalls.length > 0) {
      plan = markPlan(plan, 'act', ['inspect'])
      onPlan?.(plan)

      messages.push({
        role: 'assistant',
        content: currentResponse || null,
        tool_calls: toolCalls
      })

      for (const call of toolCalls) {
        const name = call.function.name
        let args: any
        try {
          args = JSON.parse(call.function.arguments)
        } catch {
          args = {}
        }

        onToolCall(name, args)
        onActivity?.({ kind: 'tool', message: `Running ${name}`, ts: Date.now() })
        let result = ''

        try {
          if (name === 'listDirectory') {
            onTrace?.({ tool: name, detail: `Listed directory ${String(args.subpath || '.')}`, ts: Date.now() })
            const targetPath = safeJoin(folderPath, args.subpath === '.' ? '' : args.subpath)
            const items = readdirSync(targetPath)
            const mapped = items.filter(i => !IGNORED_DIRS.has(i)).map(i => {
              const full = join(targetPath, i)
              try {
                return statSync(full).isDirectory() ? `[DIR] ${i}` : `[FILE] ${i}`
              } catch {
                return `[UNKNOWN] ${i}`
              }
            })
            result = mapped.join('\n') || 'Empty directory.'
          }
          else if (name === 'readFile') {
            onTrace?.({ tool: name, detail: `Read file ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            result = truncate(readFileSync(safeJoin(folderPath, args.filepath), 'utf-8'), READ_LIMIT)
          }
          else if (name === 'readFileRange') {
            onTrace?.({ tool: name, detail: `Read file range ${String(args.filepath)}:${Number(args.startLine || 1)}-${Number(args.endLine || args.startLine || 1)}`, ts: Date.now(), file: String(args.filepath) })
            const content = readFileSync(safeJoin(folderPath, args.filepath), 'utf-8')
            const lines = content.split(/\r?\n/)
            const start = Math.max(1, Number(args.startLine || 1))
            const end = Math.max(start, Number(args.endLine || start))
            result = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n') || 'No content in requested range.'
          }
          else if (name === 'searchInFiles') {
            onTrace?.({ tool: name, detail: `Searched for "${String(args.query || '')}" in ${String(args.subpath || '.')}`, ts: Date.now() })
            result = searchInTree(folderPath, String(args.query || ''), String(args.subpath || '.'))
          }
          else if (name === 'writeFile') {
            onTrace?.({ tool: name, detail: `Prepared write to ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            const target = safeJoin(folderPath, args.filepath)
            const parent = dirname(target)
            const before = existsSync(target) ? readFileSync(target, 'utf-8') : ''
            const after = String(args.content || '')
            const approved = await requestFileChangeApproval(folderPath, args.filepath, before, after, onApprovalRequest, onActivity)
            if (!approved) {
              result = `File change blocked: ${args.filepath}`
            } else {
              if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
              writeFileSync(target, after, 'utf-8')
              const writeDiff = buildSimpleDiff(before, after, String(args.filepath))
              onTrace?.({ tool: 'writeFile:committed', detail: `Wrote ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath), diff: writeDiff })
              result = `Success: wrote ${args.filepath}`
            }
          }
          else if (name === 'applyPatch') {
            onTrace?.({ tool: name, detail: `Prepared patch for ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            const target = safeJoin(folderPath, args.filepath)
            const originalContent = readFileSync(target, 'utf-8')
            const updated = applyPatchToContent(originalContent, String(args.findText || ''), String(args.replaceText || ''))
            const approved = await requestFileChangeApproval(folderPath, args.filepath, originalContent, updated, onApprovalRequest, onActivity)
            if (!approved) {
              result = `File patch blocked: ${args.filepath}`
            } else {
              writeFileSync(target, updated, 'utf-8')
              const patchDiff = buildSimpleDiff(originalContent, updated, String(args.filepath))
              onTrace?.({ tool: 'applyPatch:committed', detail: `Patched ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath), diff: patchDiff })
              result = `Success: patched ${args.filepath}`
            }
          }
          else if (name === 'runCommand') {
            const command = String(args.command || '').trim()
            onTrace?.({ tool: name, detail: `Prepared command: ${command}`, ts: Date.now(), command })
            if (!command) throw new Error('Command is required')

            if (needsApproval(command)) {
              const approval: ApprovalRequest = {
                id: `approval-${Date.now()}`,
                type: 'command',
                title: 'Command approval required',
                description: 'The agent wants to run a potentially dangerous command.',
                command,
              }
              onActivity?.({ kind: 'approval', message: `Approval requested for command: ${command}`, ts: Date.now() })
              const approved = await onApprovalRequest?.(approval)
              if (!approved) {
                result = 'Command blocked: user did not approve execution.'
              } else {
                const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                const { stdout, stderr } = await execAsync(command, { cwd: folderPath, shell, timeout: 30000 })
                result = truncate((stdout + '\n' + stderr).trim() || 'Command executed successfully.', COMMAND_LIMIT)
              }
            } else {
              const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
              const { stdout, stderr } = await execAsync(command, { cwd: folderPath, shell, timeout: 30000 })
              result = truncate((stdout + '\n' + stderr).trim() || 'Command executed successfully.', COMMAND_LIMIT)
            }
          }
          else {
            result = `Unknown tool: ${name}`
          }
        } catch (err: any) {
          result = `Error: ${err.message}`
        }

        onToolResult(name, result)
        onActivity?.({ kind: 'result', message: `${name}: ${result.slice(0, 200)}`, ts: Date.now() })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result
        })
      }
    } else {
      plan = markPlan(plan, 'report', ['inspect', 'act'])
      onPlan?.(plan)
      break
    }
  }

  plan = {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step, status: 'done' })),
  }
  onPlan?.(plan)
  onActivity?.({ kind: 'system', message: 'Task complete.', ts: Date.now() })

  return finalResponse
}

export async function updateMemoryAgent(folderPath: string, oldMemory: string, conversation: string): Promise<string> {
  const ai = getOpenAI()
  const systemPrompt = `You are maintaining the memory for a project folder.
Review the current memory and the latest conversation. Update the memory with any new, persistent facts, decisions, or context.
Return ONLY the raw markdown content for the updated memory. Keep it concise.`

  const res = await ai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Folder Path: ${folderPath}\n\nCurrent Memory:\n${oldMemory}\n\nRecent Conversation:\n${conversation}` }
    ]
  })

  return res.choices[0].message.content || oldMemory
}

export async function extractStructuredMemory(
  folderPath: string,
  current: StructuredMemory,
  conversation: string,
): Promise<StructuredMemory> {
  const ai = getOpenAI()
  const systemPrompt = `You maintain structured memory for a persistent folder agent.
Update four fields based on durable information only:
- project: stable facts, architecture, important context
- decisions: explicit decisions and tradeoffs
- preferences: user preferences, style choices, workflow preferences
- tasks: open or completed tasks with statuses

Return strict JSON with shape:
{
  "project": string,
  "decisions": string,
  "preferences": string,
  "tasks": { "items": [{ "text": string, "status": "open" | "done" }] }
}

Keep memory concise and deduplicated. Do not include ephemeral chatter.`

  const res = await ai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Folder Path: ${folderPath}\n\nCurrent Structured Memory:\n${JSON.stringify(current, null, 2)}\n\nRecent Conversation:\n${conversation}`
      }
    ]
  })

  const content = res.choices[0].message.content
  if (!content) return current

  try {
    const parsed = JSON.parse(content) as StructuredMemory
    return {
      project: parsed.project || current.project,
      decisions: parsed.decisions || current.decisions,
      preferences: parsed.preferences || current.preferences,
      tasks: {
        items: Array.isArray(parsed.tasks?.items)
          ? parsed.tasks.items
              .filter((item) => item && typeof item.text === 'string' && (item.status === 'open' || item.status === 'done'))
              .slice(0, 20)
          : current.tasks,
      },
    }
  } catch {
    return current
  }
}
