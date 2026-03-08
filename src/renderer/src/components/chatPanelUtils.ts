export const QUICK_PROMPTS = [
  'Summarize this folder and what matters most right now.',
  'Inspect the project structure and identify key files.',
  'Review recent changes and suggest next steps.',
  'Look for risks, TODOs, or unfinished work in this folder.',
]

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
