export const QUICK_PROMPTS = [
  'Summarize this folder and what matters most right now.',
  'Inspect the project structure and identify key files.',
  'Review recent changes and suggest next steps.',
  'Look for risks, TODOs, or unfinished work in this folder.',
]

const CODEBASE_PROMPTS = [
  'Explain this project’s architecture and how the main pieces fit together.',
  'Review my uncommitted changes and flag risks before I commit.',
  'Find where a feature is implemented and walk me through how it works.',
  'Add tests for the most recently changed files.',
]

// Suggestions shown in the empty chat state, tuned to the folder's archetype.
export function quickPromptsFor(archetype?: string): string[] {
  return archetype === 'codebase' ? CODEBASE_PROMPTS : QUICK_PROMPTS
}

export function formatDiffLines(diff?: string) {
  if (!diff) return []
  return diff.split(/\r?\n/).map((line, index) => ({
    id: `${index}-${line}`,
    text: line,
    kind: line.startsWith('+++') || line.startsWith('---') ? 'meta' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'context',
  }))
}

export function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 1000) return durationMs ? `${durationMs}ms` : '—'
  const seconds = Math.round(durationMs / 100) / 10
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round((seconds % 60) * 10) / 10
  return `${minutes}m ${remainingSeconds}s`
}
