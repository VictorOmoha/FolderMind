import { AgentJob, AgentJobArtifact, AgentJobAttentionState, AgentJobKind, AgentJobPlanStep, AgentJobStructuredResult, RuntimePolicy } from './runtimeTypes'
import { findCommandByScriptName, findCommandRule } from './runtimePolicy'

export function buildJobPlan(kind: AgentJobKind): AgentJobPlanStep[] {
  if (kind === 'test_run') {
    return [
      { id: 'validate_command', label: 'Validate command policy', status: 'pending' },
      { id: 'execute_command', label: 'Run verification command', status: 'pending' },
      { id: 'finalize', label: 'Finalize verification result', status: 'pending' },
    ]
  }
  return [
    { id: 'collect_context', label: 'Collect workspace context', status: 'pending' },
    { id: 'generate_result', label: 'Generate analysis', status: 'pending' },
    { id: 'finalize', label: 'Finalize structured result', status: 'pending' },
  ]
}

export function applyCheckpoint(job: AgentJob, phase: string, summary: string, extras?: Partial<AgentJob>): AgentJob {
  const basePlan = job.planSteps || buildJobPlan(job.kind)
  const activeIndex = basePlan.findIndex((step) => step.id === phase)
  const planSteps = basePlan.map((step, index) => {
    if (index < activeIndex) return { ...step, status: 'done' as const }
    if (step.id === phase) return { ...step, status: 'active' as const }
    return { ...step, status: step.status === 'done' ? 'done' : 'pending' }
  })
  return {
    ...job,
    ...extras,
    planSteps,
    activeStepId: phase,
    checkpoint: { phase, summary, updatedAt: Date.now() },
    summary,
    updatedAt: Date.now(),
  }
}

export function completeJobPlan(job: AgentJob) {
  return {
    ...job,
    planSteps: (job.planSteps || buildJobPlan(job.kind)).map((step) => ({ ...step, status: 'done' as const })),
    activeStepId: undefined,
    checkpoint: job.checkpoint ? { ...job.checkpoint, phase: 'finalize', summary: 'Completed.', updatedAt: Date.now() } : { phase: 'finalize', summary: 'Completed.', updatedAt: Date.now() },
    executionState: undefined,
  }
}

export function withStepArtifact(job: AgentJob, phase: string, title: string, body: string) {
  const normalizedBody = body.trim()
  if (!normalizedBody) return job
  const artifacts = [...(job.stepArtifacts || [])]
  const existingIndex = artifacts.findIndex((artifact) => artifact.phase === phase && artifact.title === title)
  const nextArtifact: AgentJobArtifact = {
    id: existingIndex >= 0 ? artifacts[existingIndex].id : `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    phase,
    title,
    body: normalizedBody,
    createdAt: existingIndex >= 0 ? artifacts[existingIndex].createdAt : Date.now(),
  }
  if (existingIndex >= 0) artifacts[existingIndex] = nextArtifact
  else artifacts.unshift(nextArtifact)
  return {
    ...job,
    stepArtifacts: artifacts.slice(0, 12),
  }
}

function extractSection(result: string | undefined, title: string) {
  if (!result) return null
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\n)#+\\s*${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n#+\\s|$)`, 'i')
  const match = result.match(pattern)
  return match?.[1]?.trim() || null
}

function extractCommitMessage(result: string | undefined) {
  if (!result) return null
  const headingMatch = extractSection(result, 'Commit Message')
  if (headingMatch) return headingMatch.split('\n').find(Boolean)?.replace(/^[-*]\s*/, '').trim() || null
  const lineMatch = result.match(/(?:^|\n)Commit Message:\s*([^\n]+)/i)
  return lineMatch?.[1]?.trim() || null
}

export function parseStructuredResult(result: string | undefined): AgentJobStructuredResult | undefined {
  if (!result) return undefined
  const structuredResult: AgentJobStructuredResult = {
    commitMessage: extractCommitMessage(result) || undefined,
    summary: extractSection(result, 'Summary') || undefined,
    risks: extractSection(result, 'Risks') || undefined,
    findings: extractSection(result, 'Findings') || undefined,
    nextActions: extractSection(result, 'Recommended Actions') || extractSection(result, 'Next Actions') || undefined,
  }
  return Object.values(structuredResult).some(Boolean) ? structuredResult : undefined
}

function summarizeAttention(structuredResult: AgentJobStructuredResult | undefined) {
  if (!structuredResult) return undefined
  if (structuredResult.risks) return structuredResult.risks.split('\n').find(Boolean)?.replace(/^[-*]\s*/, '').trim() || 'Job reported risks that need review.'
  if (structuredResult.findings) return structuredResult.findings.split('\n').find(Boolean)?.replace(/^[-*]\s*/, '').trim() || 'Job reported findings that need review.'
  if (structuredResult.nextActions) return structuredResult.nextActions.split('\n').find(Boolean)?.replace(/^[-*]\s*/, '').trim() || 'Job suggested follow-up actions.'
  return undefined
}

export function deriveAttentionState(structuredResult: AgentJobStructuredResult | undefined): AgentJobAttentionState {
  const attentionSummary = summarizeAttention(structuredResult)
  return {
    needsAttention: !!attentionSummary,
    attentionSummary,
  }
}

export function firstStructuredLine(value: string | undefined) {
  return value?.split('\n').find(Boolean)?.replace(/^[-*]\s*/, '').trim() || null
}

export function deriveSuggestedTasks(job: AgentJob, policy: RuntimePolicy) {
  if (!policy.autoCreateSuggestedTasks) return []
  const tasks = new Set<string>()
  const structuredResult = job.structuredResult
  const nextAction = firstStructuredLine(structuredResult?.nextActions)
  const finding = firstStructuredLine(structuredResult?.findings)
  const risk = firstStructuredLine(structuredResult?.risks)
  const primaryFile = job.filePaths[0] || 'recent changes'

  if (job.kind === 'docs_drift' && finding) {
    tasks.add(`Resolve documentation drift for ${primaryFile}: ${finding}`)
  }
  if (job.kind === 'commit_prep' && structuredResult?.commitMessage) {
    tasks.add(`Review and use proposed commit message: ${structuredResult.commitMessage}`)
  }
  if (risk) {
    tasks.add(`Review agent-identified risk from ${job.title}: ${risk}`)
  }
  if (nextAction) {
    tasks.add(`Follow agent next action from ${job.title}: ${nextAction}`)
  }
  if ((job.kind === 'diff_summary' || job.kind === 'file_review') && finding) {
    tasks.add(`Review finding from ${job.title}: ${finding}`)
  }

  return Array.from(tasks).slice(0, policy.maxSuggestedTasksPerJob)
}

export function inferVerificationCommandFromResult(folderPath: string, completedJob: AgentJob, policy: RuntimePolicy) {
  const text = [
    completedJob.structuredResult?.summary,
    completedJob.structuredResult?.risks,
    completedJob.structuredResult?.findings,
    completedJob.structuredResult?.nextActions,
    completedJob.result,
  ].filter(Boolean).join('\n').toLowerCase()
  if (!text) return null

  const candidates: Array<{ match: RegExp; script: 'lint' | 'check' | 'test' }> = [
    { match: /\blint|format|style\b/, script: 'lint' },
    { match: /\btypecheck|check|build|compile\b/, script: 'check' },
    { match: /\btest|verify|verification|regression\b/, script: 'test' },
  ]
  for (const candidate of candidates) {
    if (!candidate.match.test(text)) continue
    const command = findCommandByScriptName(folderPath, candidate.script)
    if (!command) continue
    if (!findCommandRule(command, completedJob.trigger, policy)) continue
    return command
  }
  return null
}
