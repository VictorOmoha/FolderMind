import { useEffect, useState } from 'react'
import type { AgentConfig, AgentRuntimePolicy, VerificationCommandRule } from '../../../../src/vite-env'

interface Props {
  open: boolean
  folderName: string
  folderPath: string
  agentConfig: AgentConfig | null
  onClose: () => void
  onSaveApiKey: (key: string) => Promise<void>
  onSaveProfile: (updates: { tone: string; archetype: AgentConfig['archetype']; goals: string[]; constraints: string[]; guardrails: AgentConfig['guardrails'] }) => Promise<void>
}

const defaultVerificationRules: VerificationCommandRule[] = [
  { command: 'npm run test', allowedTriggers: ['file_watcher', 'git_state', 'task_run'], requiresApproval: true, timeoutMs: 120000 },
  { command: 'npm run check', allowedTriggers: ['file_watcher', 'git_state', 'task_run'], requiresApproval: true, timeoutMs: 120000 },
  { command: 'npm run lint', allowedTriggers: ['file_watcher', 'git_state', 'task_run'], requiresApproval: true, timeoutMs: 120000 },
]

const defaultRuntimePolicy: AgentRuntimePolicy = {
  allowBackgroundAgent: true,
  autoRunFileReview: true,
  autoRunDiffSummary: true,
  autoQueueTestRuns: true,
  autoCreateSuggestedTasks: true,
  requireApprovalForTestRuns: true,
  allowedVerificationCommands: ['npm run test', 'npm run check', 'npm run lint'],
  verificationCommandRules: defaultVerificationRules,
  maxJobAttempts: 3,
  retryCooldownMinutes: 5,
  maxSuggestedTasksPerJob: 2,
}

async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) return
  await navigator.clipboard.writeText(value)
}

function parseArchivedJobId(line: string) {
  return line.match(/\[agent-archive:([^\]]+)\]/)?.[1]
}

function formatArchiveTaskText(line: string) {
  const normalized = line
    .replace(/^-+\s*/, '')
    .replace(/\[agent-archive:[^\]]+\]\s*/, '')
    .trim()
  return normalized ? `Follow up archived agent history: ${normalized}` : 'Follow up archived agent history'
}

export function SettingsModal({ open, folderName, folderPath, agentConfig, onClose, onSaveApiKey, onSaveProfile }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [tone, setTone] = useState('direct, practical, helpful')
  const [archetype, setArchetype] = useState<AgentConfig['archetype']>('general')
  const [goals, setGoals] = useState('')
  const [constraints, setConstraints] = useState('')
  const [runtimePolicy, setRuntimePolicy] = useState<AgentRuntimePolicy>(defaultRuntimePolicy)
  const [allowedCommands, setAllowedCommands] = useState(defaultRuntimePolicy.allowedVerificationCommands.join('\n'))
  const [commandRulesText, setCommandRulesText] = useState(JSON.stringify(defaultRuntimePolicy.verificationCommandRules, null, 2))
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [memoryProject, setMemoryProject] = useState('')
  const [memoryDecisions, setMemoryDecisions] = useState('')
  const [memoryPreferences, setMemoryPreferences] = useState('')
  const [archivedAgentHistory, setArchivedAgentHistory] = useState('')
  const [archiveFilter, setArchiveFilter] = useState('')
  const [selectedArchiveLine, setSelectedArchiveLine] = useState('')
  const [memorySaving, setMemorySaving] = useState(false)
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!agentConfig) return
    setTone(agentConfig.tone || 'direct, practical, helpful')
    setArchetype(agentConfig.archetype || 'general')
    setGoals((agentConfig.goals || []).join('\n'))
    setConstraints((agentConfig.constraints || []).join('\n'))
    const nextPolicy = { ...defaultRuntimePolicy, ...(agentConfig.guardrails?.runtime || {}) }
    setRuntimePolicy(nextPolicy)
    setAllowedCommands(nextPolicy.allowedVerificationCommands.join('\n'))
    setCommandRulesText(JSON.stringify((nextPolicy.verificationCommandRules?.length ? nextPolicy.verificationCommandRules : defaultVerificationRules), null, 2))
    setSaveMessage(null)
  }, [agentConfig, open])

  useEffect(() => {
    if (!open || !folderPath) return
    setMemoryMessage(null)
    window.foldermind.readMemory(folderPath).then((mem) => {
      setMemoryProject(mem.project)
      setMemoryDecisions(mem.decisions)
      setMemoryPreferences(mem.preferences)
      setArchivedAgentHistory(mem.archivedAgentHistory)
      setSelectedArchiveLine('')
    }).catch(() => {})
  }, [open, folderPath])

  if (!open) return null

  const handleSave = async () => {
    setSaving(true)
    setSaveMessage(null)
    try {
      if (apiKey.trim()) await onSaveApiKey(apiKey.trim())
      await onSaveProfile({
        tone,
        archetype,
        goals: goals.split('\n').map(v => v.trim()).filter(Boolean),
        constraints: constraints.split('\n').map(v => v.trim()).filter(Boolean),
        guardrails: {
          requireApprovalForDangerousCommands: true,
          requireApprovalForFileChanges: true,
          runtime: {
            ...runtimePolicy,
            allowedVerificationCommands: allowedCommands.split('\n').map(v => v.trim()).filter(Boolean),
          },
        },
      })
      setSaveMessage('Settings saved.')
      onClose()
    } catch (error: unknown) {
      setSaveMessage(error instanceof Error ? error.message : 'Unable to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveMemory = async () => {
    setMemorySaving(true)
    setMemoryMessage(null)
    try {
      await window.foldermind.writeMemory(folderPath, {
        project: memoryProject,
        decisions: memoryDecisions,
        preferences: memoryPreferences,
        archivedAgentHistory,
      })
      setMemoryMessage('Memory saved.')
    } catch (error: unknown) {
      setMemoryMessage(error instanceof Error ? error.message : 'Unable to save memory.')
    } finally {
      setMemorySaving(false)
    }
  }

  const togglePolicy = (key: 'allowBackgroundAgent' | 'autoRunFileReview' | 'autoRunDiffSummary' | 'autoQueueTestRuns' | 'autoCreateSuggestedTasks' | 'requireApprovalForTestRuns') => {
    setRuntimePolicy(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const updateNumberPolicy = (key: 'maxJobAttempts' | 'retryCooldownMinutes' | 'maxSuggestedTasksPerJob', value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) return
    setRuntimePolicy(prev => ({
      ...prev,
      [key]: key === 'retryCooldownMinutes' ? Math.max(0, parsed) : Math.max(1, parsed),
    }))
  }

  const archivedHistoryLines = archivedAgentHistory.split(/\r?\n/).filter(Boolean)
  const filteredArchiveLines = archiveFilter.trim()
    ? archivedHistoryLines.filter((line) => line.toLowerCase().includes(archiveFilter.trim().toLowerCase()))
    : archivedHistoryLines

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2 className="modal-title">Settings</h2>
            <p className="modal-message">Manage your API key, folder profile, and runtime policy.</p>
          </div>
        </div>

        <div className="settings-grid">
          <section className="settings-section">
            <h3>OpenAI</h3>
            <label className="settings-label">API Key</label>
            <input className="settings-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
            <p className="settings-help">Stored only for the current app session unless you also place it in your local .env.</p>
            <p className="settings-help">Leave blank if your key is already available through the environment.</p>
          </section>

          <section className="settings-section">
            <h3>Folder Profile</h3>
            <div className="settings-meta">
              <div><span className="settings-k">Folder</span><span className="settings-v">{folderName}</span></div>
              <div><span className="settings-k">Path</span><span className="settings-v mono">{folderPath}</span></div>
            </div>

            <label className="settings-label">Archetype</label>
            <select className="settings-input" value={archetype} onChange={(e) => setArchetype(e.target.value as AgentConfig['archetype'])}>
              <option value="general">General</option>
              <option value="codebase">Codebase</option>
              <option value="research">Research</option>
              <option value="content">Content</option>
              <option value="operations">Operations</option>
            </select>

            <label className="settings-label">Tone</label>
            <input className="settings-input" value={tone} onChange={(e) => setTone(e.target.value)} />

            <label className="settings-label">Goals</label>
            <textarea className="settings-textarea" rows={4} value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="One goal per line" />

            <label className="settings-label">Constraints</label>
            <textarea className="settings-textarea" rows={4} value={constraints} onChange={(e) => setConstraints(e.target.value)} placeholder="One constraint per line" />
          </section>
        </div>

        <div className="settings-grid">
          <section className="settings-section settings-section-full">
            <h3>Runtime Policy</h3>
            <div className="settings-policy-list">
              <label className="settings-check"><input type="checkbox" checked={runtimePolicy.allowBackgroundAgent} onChange={() => togglePolicy('allowBackgroundAgent')} />Allow background agent jobs</label>
              <label className="settings-check"><input type="checkbox" checked={runtimePolicy.autoRunFileReview} onChange={() => togglePolicy('autoRunFileReview')} />Auto-run file review jobs</label>
              <label className="settings-check"><input type="checkbox" checked={runtimePolicy.autoRunDiffSummary} onChange={() => togglePolicy('autoRunDiffSummary')} />Auto-run diff summary jobs</label>
              <label className="settings-check"><input type="checkbox" checked={runtimePolicy.autoQueueTestRuns} onChange={() => togglePolicy('autoQueueTestRuns')} />Auto-queue verification jobs</label>
              <label className="settings-check"><input type="checkbox" checked={runtimePolicy.autoCreateSuggestedTasks} onChange={() => togglePolicy('autoCreateSuggestedTasks')} />Auto-create suggested tasks from analysis</label>
              <label className="settings-check"><input type="checkbox" checked={runtimePolicy.requireApprovalForTestRuns} onChange={() => togglePolicy('requireApprovalForTestRuns')} />Require approval before verification commands</label>
            </div>
            <div className="settings-grid">
              <div>
                <label className="settings-label">Max Job Attempts</label>
                <input className="settings-input" type="number" min={1} value={runtimePolicy.maxJobAttempts} onChange={(e) => updateNumberPolicy('maxJobAttempts', e.target.value)} />
              </div>
              <div>
                <label className="settings-label">Retry Cooldown (Minutes)</label>
                <input className="settings-input" type="number" min={0} value={runtimePolicy.retryCooldownMinutes} onChange={(e) => updateNumberPolicy('retryCooldownMinutes', e.target.value)} />
              </div>
              <div>
                <label className="settings-label">Max Suggested Tasks Per Job</label>
                <input className="settings-input" type="number" min={1} value={runtimePolicy.maxSuggestedTasksPerJob} onChange={(e) => updateNumberPolicy('maxSuggestedTasksPerJob', e.target.value)} />
              </div>
            </div>
            <label className="settings-label">Allowed Verification Commands</label>
            <textarea className="settings-textarea" rows={4} value={allowedCommands} onChange={(e) => setAllowedCommands(e.target.value)} placeholder="One allowed command per line" />
            <p className="settings-help">Only commands listed here can be queued or executed by the background verifier.</p>
            <label className="settings-label">Verification Command Rules (JSON)</label>
            <textarea className="settings-textarea" rows={8} value={commandRulesText} onChange={(e) => setCommandRulesText(e.target.value)} placeholder='[{"command":"npm run test","allowedTriggers":["task_run"],"requiresApproval":true,"timeoutMs":120000}]' />
            <p className="settings-help">Each rule defines the exact command, allowed triggers, approval requirement, and timeout in milliseconds.</p>
          </section>
        </div>

        <div className="settings-actions">
          {saveMessage && <span className="settings-status-message">{saveMessage}</span>}
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</button>
        </div>

        <div className="settings-divider" />

        <div className="settings-grid">
          <section className="settings-section settings-section-full">
            <h3>Agent Memory</h3>
            <p className="settings-help">Edit the agent's persistent memory directly. Changes take effect immediately for future conversations.</p>
            <label className="settings-label">Project Knowledge</label>
            <textarea className="settings-textarea" rows={6} value={memoryProject} onChange={(e) => setMemoryProject(e.target.value)} placeholder="What the agent knows about this project..." />
            <label className="settings-label">Decisions</label>
            <textarea className="settings-textarea" rows={4} value={memoryDecisions} onChange={(e) => setMemoryDecisions(e.target.value)} placeholder="Key decisions recorded by the agent..." />
            <label className="settings-label">Preferences</label>
            <textarea className="settings-textarea" rows={4} value={memoryPreferences} onChange={(e) => setMemoryPreferences(e.target.value)} placeholder="User preferences the agent has learned..." />
            <label className="settings-label">Archived Agent History</label>
            <input className="settings-input" value={archiveFilter} onChange={(e) => setArchiveFilter(e.target.value)} placeholder="Filter archived history..." />
            <p className="settings-help">{filteredArchiveLines.length} matching line{filteredArchiveLines.length === 1 ? '' : 's'}</p>
            <select className="settings-input" value={selectedArchiveLine} onChange={(e) => setSelectedArchiveLine(e.target.value)}>
              <option value="">Select a matching line...</option>
              {filteredArchiveLines.map((line, index) => <option key={`${index}-${line}`} value={line}>{line.slice(0, 140)}</option>)}
            </select>
            <div className="settings-actions" style={{ marginTop: '8px', justifyContent: 'flex-start' }}>
              <button className="btn-secondary" onClick={() => setArchiveFilter('')}>Clear Filter</button>
              <button className="btn-secondary" onClick={() => void copyText(filteredArchiveLines.join('\n'))} disabled={filteredArchiveLines.length === 0}>Copy Matches</button>
              <button
                className="btn-secondary"
                onClick={async () => {
                  if (!selectedArchiveLine) return
                  await window.foldermind.addTask(folderPath, formatArchiveTaskText(selectedArchiveLine), {
                    source: 'agent',
                    archivedFromJobId: parseArchivedJobId(selectedArchiveLine),
                  })
                  setMemoryMessage('Archive line promoted to task.')
                }}
                disabled={!selectedArchiveLine}
              >
                Promote To Task
              </button>
            </div>
            <textarea className="settings-textarea" rows={4} value={filteredArchiveLines.join('\n')} readOnly placeholder="Filtered archive matches will appear here." />
            <textarea className="settings-textarea" rows={6} value={archivedAgentHistory} onChange={(e) => setArchivedAgentHistory(e.target.value)} placeholder="Pruned agent chain summaries..." />
            <div className="settings-actions" style={{ marginTop: '12px' }}>
              {memoryMessage && <span className="settings-status-message">{memoryMessage}</span>}
              <button className="btn-primary" onClick={handleSaveMemory} disabled={memorySaving}>{memorySaving ? 'Saving...' : 'Save Memory'}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
