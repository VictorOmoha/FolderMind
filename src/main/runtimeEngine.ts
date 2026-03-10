import { exec } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { basename, join, relative } from 'path'
import { promisify } from 'util'
import { hasApiKey, runAutonomousReview } from './agent'
import { findCommandRule } from './runtimePolicy'
import { firstStructuredLine, inferVerificationCommandFromResult } from './runtimeWorkflow'
import { AgentJob, JOB_TIMEOUT_MS, RuntimeDeps } from './runtimeTypes'
import { appendRuntimeEvent, readJobs, saveAndEmit } from './runtimeState'

const execAsync = promisify(exec)

function isCodeLikeFile(filePath: string) {
  return /\.(ts|tsx|js|jsx|json|md|css|scss|html|yml|yaml|ps1|sh)$/i.test(filePath)
}

function collectFileSnippets(folderPath: string, filePaths: string[]) {
  const snippets: string[] = []
  for (const relPath of filePaths.slice(0, 3)) {
    try {
      const fullPath = join(folderPath, relPath)
      const content = readFileSync(fullPath, 'utf-8')
      snippets.push(`### ${relPath}\n${content.slice(0, 2000)}`)
    } catch {
      snippets.push(`### ${relPath}\n[unavailable or non-text file]`)
    }
  }
  return snippets.join('\n\n') || '_No readable files in this review batch._'
}

function collectDocSnippets(folderPath: string) {
  const docCandidates = ['README.md', 'readme.md', 'docs/README.md', 'docs/index.md', 'docs/overview.md']
  const snippets: string[] = []
  for (const relPath of docCandidates) {
    try {
      const fullPath = join(folderPath, relPath)
      if (!existsSync(fullPath)) continue
      const content = readFileSync(fullPath, 'utf-8')
      snippets.push(`### ${relPath}\n${content.slice(0, 2000)}`)
    } catch {
      continue
    }
  }
  return snippets
}

function shouldQueueDocsDrift(job: AgentJob, folderPath: string) {
  if (!job.filePaths.some(isCodeLikeFile)) return false
  return collectDocSnippets(folderPath).length > 0
}

function getShell() {
  return process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
}

async function runFixedCommand(command: string, folderPath: string, timeoutMs = JOB_TIMEOUT_MS) {
  const { stdout, stderr } = await execAsync(command, { cwd: folderPath, shell: getShell(), timeout: timeoutMs })
  return (stdout + '\n' + stderr).trim() || 'Command executed successfully.'
}

async function buildDiffSummaryContext(folderPath: string, filePaths: string[], deps: RuntimeDeps) {
  const [statusOut, diffStatOut] = await Promise.all([
    runFixedCommand('git status --short', folderPath),
    runFixedCommand('git diff --stat', folderPath),
  ])
  const memory = deps.flattenStructuredMemory(deps.loadStructuredMemory(folderPath))
  return [
    `Git status:\n${statusOut}`,
    `Git diff stat:\n${diffStatOut}`,
    `Files in scope:\n${filePaths.map((file) => `- ${file}`).join('\n') || '_None_'}`,
    `Memory:\n${memory}`,
  ].join('\n\n')
}

async function buildFileReviewContext(folderPath: string, filePaths: string[], deps: RuntimeDeps) {
  const memory = deps.flattenStructuredMemory(deps.loadStructuredMemory(folderPath))
  const recentChanges = deps.getRecentFolderChanges(folderPath).slice(0, 8)
  const git = await deps.getGitStatus(folderPath)
  const fileSnippets = collectFileSnippets(folderPath, filePaths)
  return [
    `Recent changes:\n${recentChanges.map((change) => `- ${change.event}: ${relative(folderPath, change.filePath)}`).join('\n') || '_None_'}`,
    `Changed files in this job:\n${filePaths.map((file) => `- ${file}`).join('\n') || '_None_'}`,
    `Git status:\n${JSON.stringify(git, null, 2)}`,
    `Memory:\n${memory}`,
    `File snippets:\n${fileSnippets}`,
  ].join('\n\n')
}

async function buildDocsDriftContext(folderPath: string, filePaths: string[], deps: RuntimeDeps) {
  const memory = deps.flattenStructuredMemory(deps.loadStructuredMemory(folderPath))
  const docSnippets = collectDocSnippets(folderPath)
  const fileSnippets = collectFileSnippets(folderPath, filePaths)
  return [
    'Check whether workspace documentation is drifting from recent code changes.',
    `Changed files:\n${filePaths.map((file) => `- ${file}`).join('\n') || '_None_'}`,
    `Code snippets:\n${fileSnippets}`,
    `Documentation snippets:\n${docSnippets.join('\n\n') || '_No docs found_'}`,
    `Memory:\n${memory}`,
  ].join('\n\n')
}

async function buildCommitPrepContext(folderPath: string, filePaths: string[], deps: RuntimeDeps) {
  const memory = deps.flattenStructuredMemory(deps.loadStructuredMemory(folderPath))
  const git = await deps.getGitStatus(folderPath)
  const [statusOut, diffStatOut] = await Promise.all([
    runFixedCommand('git status --short', folderPath),
    runFixedCommand('git diff --stat', folderPath),
  ])
  return [
    'Prepare a commit summary and draft commit message for the current repo state.',
    'Return markdown with sections exactly named: Commit Message, Summary, Risks.',
    'Under Commit Message, provide a single commit message line.',
    `Suggested commit message: ${git.suggestedCommitMessage || '_None_'}`,
    `Files in scope:\n${filePaths.map((file) => `- ${file}`).join('\n') || '_None_'}`,
    `Git status:\n${statusOut}`,
    `Diff stat:\n${diffStatOut}`,
    `Memory:\n${memory}`,
  ].join('\n\n')
}

export async function buildJobContext(folderPath: string, job: AgentJob, deps: RuntimeDeps) {
  if (job.kind === 'file_review') return buildFileReviewContext(folderPath, job.filePaths, deps)
  if (job.kind === 'diff_summary') return buildDiffSummaryContext(folderPath, job.filePaths, deps)
  if (job.kind === 'docs_drift') return buildDocsDriftContext(folderPath, job.filePaths, deps)
  if (job.kind === 'commit_prep') return buildCommitPrepContext(folderPath, job.filePaths, deps)
  return ''
}

export async function executeJob(folderPath: string, job: AgentJob, deps: RuntimeDeps, onProgress: (phase: string, summary: string, extras?: Partial<AgentJob>) => Promise<void>) {
  if (job.kind === 'test_run') {
    await onProgress('validate_command', `Validating verification command: ${job.command || 'npm run test'}`, {
      stepArtifacts: [{
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        phase: 'validate_command',
        title: 'Command Policy',
        body: `Command: ${job.command || 'npm run test'}\nTrigger: ${job.trigger}\nApproval required: ${job.approvalRequired ? 'yes' : 'no'}`,
        createdAt: Date.now(),
      }],
    })
    await onProgress('execute_command', `Running verification command: ${job.command || 'npm run test'}`)
    const output = await runFixedCommand(job.command || 'npm run test', folderPath, job.commandTimeoutMs || JOB_TIMEOUT_MS)
    await onProgress('finalize', 'Finalizing verification result.', {
      stepArtifacts: [{
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        phase: 'finalize',
        title: 'Command Output',
        body: output.slice(0, 2000),
        createdAt: Date.now(),
      }],
    })
    return {
      result: output,
      summary: `Verification command completed: ${job.command || 'npm run test'}`,
      verificationStatus: 'passed' as const,
    }
  }

  const preparedContext = job.executionState?.preparedContext || await buildJobContext(folderPath, job, deps)
  if (!job.executionState?.preparedContext) {
    await onProgress('collect_context', 'Collecting workspace context for analysis.', {
      executionState: { preparedContext },
      stepArtifacts: [{
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        phase: 'collect_context',
        title: 'Prepared Context',
        body: preparedContext.slice(0, 2000),
        createdAt: Date.now(),
      }],
    })
  } else {
    await onProgress('collect_context', 'Reusing cached workspace context from the last checkpoint.', {
      executionState: { preparedContext },
    })
  }

  await onProgress('generate_result', `Generating ${job.kind.replace('_', ' ')} output.`, {
    executionState: { preparedContext },
  })
  const result = await runAutonomousReview({ folderPath, profile: deps.readAgentConfig(folderPath), context: preparedContext })
  await onProgress('finalize', 'Finalizing structured analysis result.', {
    executionState: { preparedContext },
    stepArtifacts: [{
      id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phase: 'finalize',
      title: 'Analysis Output',
      body: result.slice(0, 2000),
      createdAt: Date.now(),
    }],
  })

  return {
    result,
    summary:
      job.kind === 'diff_summary'
        ? 'Diff summary completed.'
        : job.kind === 'docs_drift'
          ? 'Documentation drift review completed.'
          : job.kind === 'commit_prep'
            ? 'Commit preparation completed.'
            : 'Background review completed.',
    verificationStatus: job.verificationStatus,
  }
}

export function queueDocsDriftFollowUp(folderPath: string, completedJob: AgentJob, deps: RuntimeDeps, runNextJob: () => void) {
  if ((completedJob.kind !== 'file_review' && completedJob.kind !== 'diff_summary') || !hasApiKey()) return
  if (!shouldQueueDocsDrift(completedJob, folderPath)) return

  let jobs = readJobs(folderPath)
  const hasExisting = jobs.some((job) => job.kind === 'docs_drift' && job.parentJobId === completedJob.id && (job.status === 'queued' || job.status === 'running' || job.status === 'blocked' || job.status === 'completed'))
  if (hasExisting) return

  const followUp: AgentJob = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'docs_drift',
    status: 'queued',
    title: 'Check documentation drift',
    trigger: completedJob.trigger,
    reason: 'Triggered by a completed review of code changes.',
    rootJobId: completedJob.rootJobId || completedJob.id,
    parentJobId: completedJob.id,
    childJobIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptCount: 0,
    filePaths: completedJob.filePaths,
    planSteps: [
      { id: 'collect_context', label: 'Collect workspace context', status: 'pending' },
      { id: 'generate_result', label: 'Generate analysis', status: 'pending' },
      { id: 'finalize', label: 'Finalize structured result', status: 'pending' },
    ],
    summary: 'Queued after review completion to check whether documentation still matches the code.',
  }
  jobs = [followUp, ...jobs].map((job) => job.id === completedJob.id ? { ...job, childJobIds: Array.from(new Set([...(job.childJobIds || []), followUp.id])) } : job)
  appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_queued', jobId: followUp.id, rootJobId: completedJob.rootJobId || completedJob.id, message: 'Queued documentation drift follow-up.' })
  saveAndEmit(folderPath, jobs, deps)
  runNextJob()
}

export async function queueCommitPrepFollowUp(folderPath: string, completedJob: AgentJob, deps: RuntimeDeps, runNextJob: () => void) {
  if ((completedJob.kind !== 'diff_summary' && completedJob.kind !== 'docs_drift') || !hasApiKey()) return
  if (/\bblocker|broken|failing|failed|error\b/i.test(completedJob.structuredResult?.risks || '')) return

  const git = await deps.getGitStatus(folderPath)
  if (!git.isRepo || git.changedFiles.length === 0) return

  let jobs = readJobs(folderPath)
  const hasExisting = jobs.some((job) => job.kind === 'commit_prep' && job.parentJobId === completedJob.id && (job.status === 'queued' || job.status === 'running' || job.status === 'blocked' || job.status === 'completed'))
  if (hasExisting) return

  const followUp: AgentJob = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'commit_prep',
    status: 'queued',
    title: 'Prepare commit summary',
    trigger: completedJob.trigger,
    reason: 'Triggered by completed diff-oriented analysis.',
    rootJobId: completedJob.rootJobId || completedJob.id,
    parentJobId: completedJob.id,
    childJobIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptCount: 0,
    filePaths: completedJob.filePaths,
    planSteps: [
      { id: 'collect_context', label: 'Collect workspace context', status: 'pending' },
      { id: 'generate_result', label: 'Generate analysis', status: 'pending' },
      { id: 'finalize', label: 'Finalize structured result', status: 'pending' },
    ],
    summary: 'Queued after diff-oriented analysis to draft a commit summary and message.',
  }
  jobs = [followUp, ...jobs].map((job) => job.id === completedJob.id ? { ...job, childJobIds: Array.from(new Set([...(job.childJobIds || []), followUp.id])) } : job)
  appendRuntimeEvent(folderPath, deps, { level: 'info', type: 'job_queued', jobId: followUp.id, rootJobId: completedJob.rootJobId || completedJob.id, message: 'Queued commit preparation follow-up.' })
  saveAndEmit(folderPath, jobs, deps)
  runNextJob()
}

export function queueVerificationFollowUpFromAnalysis(folderPath: string, completedJob: AgentJob, deps: RuntimeDeps, runNextJob: () => void) {
  if (!hasApiKey()) return
  if (completedJob.kind !== 'file_review' && completedJob.kind !== 'diff_summary' && completedJob.kind !== 'docs_drift') return
  const policy = deps.readAgentConfig(folderPath).guardrails?.runtime
  if (!policy?.allowBackgroundAgent || !policy.autoQueueTestRuns) return

  const normalizedPolicy = {
    ...policy,
    verificationCommandRules: policy.verificationCommandRules || [],
    allowedVerificationCommands: policy.allowedVerificationCommands || [],
    maxJobAttempts: policy.maxJobAttempts || 3,
    retryCooldownMinutes: policy.retryCooldownMinutes || 5,
    maxSuggestedTasksPerJob: policy.maxSuggestedTasksPerJob || 2,
    autoRunFileReview: policy.autoRunFileReview !== false,
    autoRunDiffSummary: policy.autoRunDiffSummary === true,
    autoCreateSuggestedTasks: policy.autoCreateSuggestedTasks !== false,
    requireApprovalForTestRuns: policy.requireApprovalForTestRuns !== false,
  }
  const command = inferVerificationCommandFromResult(folderPath, completedJob, normalizedPolicy)
  if (!command) return
  const commandRule = findCommandRule(command, completedJob.trigger, normalizedPolicy)
  if (!commandRule) return

  let jobs = readJobs(folderPath)
  const hasExisting = jobs.some((job) =>
    job.kind === 'test_run'
    && job.parentJobId === completedJob.id
    && job.command?.trim().toLowerCase() === command.trim().toLowerCase()
    && (job.status === 'queued' || job.status === 'running' || job.status === 'blocked' || job.status === 'completed'))
  if (hasExisting) return

  const followUp: AgentJob = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'test_run',
    status: commandRule.requiresApproval ? 'blocked' : 'queued',
    title: 'Run recommended verification',
    trigger: completedJob.trigger,
    reason: `Triggered by completed analysis recommending verification. Command: ${command}`,
    rootJobId: completedJob.rootJobId || completedJob.id,
    parentJobId: completedJob.id,
    childJobIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    attemptCount: 0,
    filePaths: completedJob.filePaths,
    command,
    commandTimeoutMs: commandRule.timeoutMs,
    approvalRequired: commandRule.requiresApproval,
    approved: !commandRule.requiresApproval,
    verificationStatus: 'pending',
    planSteps: [
      { id: 'validate_command', label: 'Validate command policy', status: 'pending' },
      { id: 'execute_command', label: 'Run verification command', status: 'pending' },
      { id: 'finalize', label: 'Finalize verification result', status: 'pending' },
    ],
    summary: commandRule.requiresApproval
      ? `Analysis recommended verification. Approval required before running: ${command}`
      : `Analysis recommended verification. Queued command: ${command}`,
    stepArtifacts: [{
      id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phase: 'validate_command',
      title: 'Branch Reason',
      body: completedJob.attentionSummary || firstStructuredLine(completedJob.structuredResult?.nextActions) || 'Completed analysis recommended follow-up verification.',
      createdAt: Date.now(),
    }],
  }
  jobs = [followUp, ...jobs].map((job) => job.id === completedJob.id ? { ...job, childJobIds: Array.from(new Set([...(job.childJobIds || []), followUp.id])) } : job)
  appendRuntimeEvent(folderPath, deps, { level: commandRule.requiresApproval ? 'warn' : 'info', type: commandRule.requiresApproval ? 'job_blocked' : 'job_queued', jobId: followUp.id, rootJobId: completedJob.rootJobId || completedJob.id, message: commandRule.requiresApproval ? `Analysis recommended verification and is awaiting approval: ${command}` : `Analysis recommended verification: ${command}` })
  saveAndEmit(folderPath, jobs, deps)
  if (!commandRule.requiresApproval) runNextJob()
}
