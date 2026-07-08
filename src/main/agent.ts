import { runPlannerAgent } from './plannerAgent'
import { runCoderAgent } from './coderAgent'
import { runExecutorAgent } from './executorAgent'
import { join, normalize, relative, resolve } from 'path'
import { readFileSync, readdirSync, statSync } from 'fs'
import { getLLM, hasLLM, setUserKey } from './llmClient'

// LLM access is resolved centrally by llmClient (BYO key vs hosted gateway).
export function setApiKey(key: string) {
  setUserKey(key)
}

export function hasApiKey() {
  return hasLLM()
}

export const getOpenAI = () => getLLM()

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
  tasks: { items: Array<{ text: string; status: 'suggested' | 'open' | 'done' }> }
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

interface AutonomousReviewContext {
  folderPath: string
  profile?: AgentProfile
  context: string
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
  // Interpreter one-liners can run arbitrary code that no keyword deny-list can vet
  /\bnode\b[^\n]*\s-e\b/i,
  /\b(python3?|ruby|perl|php)\b[^\n]*\s-(e|c)\b/i,
  /\beval\b/i,
  /\bnpx\b/i,
  // Shell metacharacters that enable injection / chaining (newlines chain in bash too)
  /[|;&`\n\r]/,
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

// Injected into every agent's system prompt so behavior adapts to the folder type.
// The codebase profile is the deepest — it's the primary lane.
export function archetypeGuidance(archetype?: string): string {
  switch (archetype) {
    case 'codebase':
      return `This is a CODE REPOSITORY. Work like a careful senior engineer:
- Read the relevant files fully before proposing or making changes. Never guess file contents, APIs, or imports.
- Make the smallest, surgical diff that solves the task. Match the existing style, naming, and structure.
- Preserve existing behavior unless the task is to change it. Do not reformat unrelated code or add narration comments.
- Prefer verifying with the project's own tooling (build, typecheck, tests, lint) over assuming correctness.
- Reference code as file:line when explaining. Never introduce secrets, credentials, or hard-coded config.`
    case 'research':
      return `This is a RESEARCH workspace. Preserve citations and sources, never invent facts, and synthesize findings clearly with source-backed reasoning.`
    case 'content':
      return `This is a CONTENT workspace. Preserve the established voice and tone, and do not overwrite finished assets without clear intent.`
    case 'operations':
      return `This is an OPERATIONS workspace. Keep outputs structured and traceable, and avoid changing core records or trackers without care.`
    default:
      return `Keep changes safe and minimal. Read before you write, and prefer verification over assumption.`
  }
}

// Allow-list of command shapes considered safe to run without an approval prompt.
// This is intentionally a DEFAULT-DENY model: anything not matched here requires the
// user to approve it, so an LLM cannot silently execute an arbitrary command. A
// deny-list can always be evaded (interpreter one-liners, novel binaries); an
// allow-list cannot. Each entry must match the WHOLE trimmed command.
const AUTO_APPROVED_COMMAND_PATTERNS: RegExp[] = [
  // Package manager: scripts, install/ci, list/why/outdated. No publish, no arbitrary `npm exec`.
  /^npm\s+(run\s+[\w:-]+|test|ci|install|i|ls|list|why|outdated|version)\s*$/i,
  /^(pnpm|yarn)\s+(run\s+[\w:-]+|test|install|list|why|outdated)\s*$/i,
  // Read-only git inspection (no reset/clean/push/rebase/checkout — those mutate).
  /^git\s+(status|diff|log|show|branch|remote|rev-parse|describe|blame)\b[\w\s./:@=-]*$/i,
  // Build / typecheck / lint / test runners.
  /^(tsc|eslint|prettier|jest|vitest|mocha|playwright)\b[\w\s./:@=-]*$/i,
  /^(node|npm|pnpm|yarn|python3?)\s+--?version\s*$/i,
  // Benign read-only shell inspection.
  /^(ls|pwd|whoami|date|echo)\b[\w\s./:@=-]*$/i,
  /^cat\s+[\w./-]+\s*$/i,
]

// True only when the command matches an allow-list entry AND carries no shell
// metacharacters (which would let an approved prefix smuggle a second command).
function isAutoApproved(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  if (/[|;&`$<>\n\r\\]/.test(trimmed) || /\$\(/.test(trimmed)) return false
  return AUTO_APPROVED_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))
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
  const { onPlan, onActivity } = context
  let plan = buildPlan(userMessage)
  onPlan?.(plan)
  onActivity?.({ kind: 'system', message: 'Task planning started. Routing disabled monolithic agent removed.', ts: Date.now() })

  const helpers = { truncate, safeJoin, searchInTree, IGNORED_DIRS, READ_LIMIT, COMMAND_LIMIT, DIFF_LIMIT, applyPatchToContent, buildSimpleDiff, requestFileChangeApproval, needsApproval, isAutoApproved }

  onActivity?.({ kind: 'system', message: 'Delegating to Planner Agent (Context Gathering)...', ts: Date.now() })
  const plannerResult = await runPlannerAgent(userMessage, history, context, helpers)
  
  plan = markPlan(plan, 'act', ['inspect'])
  onPlan?.(plan)

  onActivity?.({ kind: 'system', message: 'Delegating to Coder Agent (Code Modification)...', ts: Date.now() })
  const coderResult = await runCoderAgent(userMessage, history, context, helpers, plannerResult.finalResponse)

  onActivity?.({ kind: 'system', message: 'Delegating to Executor Agent (Terminal Execution)...', ts: Date.now() })
  const executorResult = await runExecutorAgent(userMessage, history, context, helpers, plannerResult.finalResponse)

  plan = markPlan(plan, 'report', ['inspect', 'act'])
  onPlan?.(plan)

  plan = { ...plan, steps: plan.steps.map((step) => ({ ...step, status: 'done' })) }
  onPlan?.(plan)
  onActivity?.({ kind: 'system', message: 'Task complete.', ts: Date.now() })

  return plannerResult.finalResponse + '\n\n' + coderResult.finalResponse + '\n\n' + executorResult.finalResponse
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
              .filter((item) => item && typeof item.text === 'string' && (item.status === 'suggested' || item.status === 'open' || item.status === 'done'))
              .slice(0, 20)
          : current.tasks.items,
      },
    }
  } catch {
    return current
  }
}


export async function runAutonomousReview(input: AutonomousReviewContext): Promise<string> {
  const ai = getOpenAI()
  const profileSection = input.profile ? `
Agent Profile:
- Name: ${input.profile.name || 'FolderMind'}
- Archetype: ${input.profile.archetype || 'general'}
- Tone: ${input.profile.tone || 'direct, practical, helpful'}
- Goals: ${(input.profile.goals || []).join('; ') || 'No explicit goals set'}
- Constraints: ${(input.profile.constraints || []).join('; ') || 'No explicit constraints set'}
` : ''

  const res = await ai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `You are FolderMind's autonomous review worker.
You review workspace changes in the background and produce safe, non-destructive operational guidance.
Do not claim to have changed files or run commands.
Return a concise markdown update with exactly these sections:
## What changed
## Risks
## Recommended next actions
Use short bullets. Prefer concrete file-level observations when possible.${profileSection}`,
      },
      {
        role: 'user',
        content: `Workspace: ${input.folderPath}

Review context:
${input.context}`,
      },
    ],
  })

  return res.choices[0].message.content?.trim() || '## What changed\n- Background review could not determine the impact.\n## Risks\n- Unable to assess risks.\n## Recommended next actions\n- Open the workspace and inspect the recent file changes.'
}


