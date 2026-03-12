import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { AgentJobTrigger, JOB_TIMEOUT_MS, RuntimeDeps, RuntimePolicy, VerificationCommandRule } from './runtimeTypes'

export function getRuntimePolicy(folderPath: string, deps: RuntimeDeps): RuntimePolicy {
  const runtime = deps.readAgentConfig(folderPath).guardrails?.runtime || {}
  return {
    allowBackgroundAgent: runtime.allowBackgroundAgent !== false,
    autoRunFileReview: runtime.autoRunFileReview !== false,
    autoRunDiffSummary: runtime.autoRunDiffSummary === true,
    autoQueueTestRuns: runtime.autoQueueTestRuns === true,
    autoCreateSuggestedTasks: runtime.autoCreateSuggestedTasks !== false,
    requireApprovalForTestRuns: runtime.requireApprovalForTestRuns !== false,
    allowedVerificationCommands: Array.isArray(runtime.allowedVerificationCommands)
      ? runtime.allowedVerificationCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : ['npm run test', 'npm run check', 'npm run lint'],
    verificationCommandRules: Array.isArray(runtime.verificationCommandRules)
      ? runtime.verificationCommandRules.filter((rule): rule is VerificationCommandRule => typeof rule?.command === 'string' && rule.command.trim().length > 0).map((rule) => ({
          command: rule.command.trim(),
          allowedTriggers: Array.isArray(rule.allowedTriggers) && rule.allowedTriggers.length > 0
            ? rule.allowedTriggers.filter((trigger): trigger is AgentJobTrigger => trigger === 'file_watcher' || trigger === 'git_state' || trigger === 'task_run')
            : ['file_watcher', 'git_state', 'task_run'],
          requiresApproval: rule.requiresApproval !== false,
          timeoutMs: typeof rule.timeoutMs === 'number' && rule.timeoutMs > 0 ? rule.timeoutMs : JOB_TIMEOUT_MS,
        }))
      : (Array.isArray(runtime.allowedVerificationCommands)
          ? runtime.allowedVerificationCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((command) => ({
              command: command.trim(),
              allowedTriggers: ['file_watcher', 'git_state', 'task_run'] as AgentJobTrigger[],
              requiresApproval: runtime.requireApprovalForTestRuns !== false,
              timeoutMs: JOB_TIMEOUT_MS,
            }))
          : []),
    maxJobAttempts: typeof runtime.maxJobAttempts === 'number' && runtime.maxJobAttempts > 0 ? runtime.maxJobAttempts : 3,
    retryCooldownMinutes: typeof runtime.retryCooldownMinutes === 'number' && runtime.retryCooldownMinutes >= 0 ? runtime.retryCooldownMinutes : 5,
    maxSuggestedTasksPerJob: typeof runtime.maxSuggestedTasksPerJob === 'number' && runtime.maxSuggestedTasksPerJob > 0 ? runtime.maxSuggestedTasksPerJob : 2,
  }
}

function readPackageScripts(folderPath: string): Record<string, string> {
  try {
    const packageJsonPath = join(folderPath, 'package.json')
    if (!existsSync(packageJsonPath)) return {}
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { scripts?: Record<string, string> }
    return parsed.scripts || {}
  } catch {
    return {}
  }
}

export function detectTestCommand(folderPath: string): string | null {
  const scripts = readPackageScripts(folderPath)
  const candidates = ['test', 'check', 'lint']
  for (const name of candidates) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) {
      return `npm run ${name}`
    }
  }
  return null
}

export function findCommandRule(command: string, trigger: AgentJobTrigger, policy: RuntimePolicy) {
  return policy.verificationCommandRules.find((rule) => rule.command.trim().toLowerCase() === command.trim().toLowerCase() && rule.allowedTriggers.includes(trigger))
}

export function findCommandByScriptName(folderPath: string, scriptName: string) {
  const scripts = readPackageScripts(folderPath)
  return typeof scripts[scriptName] === 'string' && scripts[scriptName].trim() ? `npm run ${scriptName}` : null
}
