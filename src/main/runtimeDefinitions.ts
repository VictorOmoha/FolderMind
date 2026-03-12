import { AgentJob, AgentJobKind, AgentJobPlanStep } from './runtimeTypes'

export type AgentWorkflowMode = 'analysis' | 'verification'
export type AgentFollowUpKind = 'recommended_verification' | 'docs_drift' | 'commit_prep'

export interface AgentWorkflowDefinition {
  kind: AgentJobKind
  mode: AgentWorkflowMode
  completionSummary: string
  steps: AgentJobPlanStep[]
  followUps: AgentFollowUpKind[]
}

const ANALYSIS_STEPS: AgentJobPlanStep[] = [
  { id: 'collect_context', label: 'Collect workspace context', status: 'pending' },
  { id: 'generate_result', label: 'Generate analysis', status: 'pending' },
  { id: 'finalize', label: 'Finalize structured result', status: 'pending' },
]

const VERIFICATION_STEPS: AgentJobPlanStep[] = [
  { id: 'validate_command', label: 'Validate command policy', status: 'pending' },
  { id: 'execute_command', label: 'Run verification command', status: 'pending' },
  { id: 'finalize', label: 'Finalize verification result', status: 'pending' },
]

const WORKFLOW_DEFINITIONS: Record<AgentJobKind, AgentWorkflowDefinition> = {
  file_review: {
    kind: 'file_review',
    mode: 'analysis',
    completionSummary: 'Background review completed.',
    steps: ANALYSIS_STEPS,
    followUps: ['recommended_verification', 'docs_drift'],
  },
  diff_summary: {
    kind: 'diff_summary',
    mode: 'analysis',
    completionSummary: 'Diff summary completed.',
    steps: ANALYSIS_STEPS,
    followUps: ['recommended_verification', 'docs_drift', 'commit_prep'],
  },
  docs_drift: {
    kind: 'docs_drift',
    mode: 'analysis',
    completionSummary: 'Documentation drift review completed.',
    steps: ANALYSIS_STEPS,
    followUps: ['recommended_verification', 'commit_prep'],
  },
  commit_prep: {
    kind: 'commit_prep',
    mode: 'analysis',
    completionSummary: 'Commit preparation completed.',
    steps: ANALYSIS_STEPS,
    followUps: [],
  },
  test_run: {
    kind: 'test_run',
    mode: 'verification',
    completionSummary: 'Verification command completed.',
    steps: VERIFICATION_STEPS,
    followUps: [],
  },
}

export function getWorkflowDefinition(kind: AgentJobKind): AgentWorkflowDefinition {
  return WORKFLOW_DEFINITIONS[kind]
}

export function getWorkflowSteps(kind: AgentJobKind): AgentJobPlanStep[] {
  return getWorkflowDefinition(kind).steps.map((step) => ({ ...step }))
}

export function getWorkflowFollowUps(job: AgentJob): AgentFollowUpKind[] {
  return [...getWorkflowDefinition(job.kind).followUps]
}
