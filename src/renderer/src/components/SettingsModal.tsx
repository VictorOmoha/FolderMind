import { useState, useEffect } from 'react'
import type { AgentConfig } from '../../../vite-env'
import styles from './SettingsModal.module.css'

interface Props {
  open: boolean
  folderName: string
  folderPath: string
  agentConfig: AgentConfig | null
  onClose: () => void
  onSaveApiKey: (key: string) => void
  onSaveProfile: (updates: {
    tone: string;
    archetype: AgentConfig['archetype'];
    goals: string[];
    constraints: string[];
    guardrails: AgentConfig['guardrails']
  }) => void
}

const ARCHETYPE_OPTIONS: Array<{ value: AgentConfig['archetype']; label: string }> = [
  { value: 'general', label: 'General Assistant' },
  { value: 'codebase', label: 'Codebase Expert' },
  { value: 'research', label: 'Research Agent' },
  { value: 'content', label: 'Content Creator' },
  { value: 'operations', label: 'Operations Manager' },
]

export function SettingsModal({ open, folderName, folderPath, agentConfig, onClose, onSaveApiKey, onSaveProfile }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [tone, setTone] = useState('')
  const [archetype, setArchetype] = useState<AgentConfig['archetype']>('general')
  const [goals, setGoals] = useState<string[]>([])
  const [constraints, setConstraints] = useState<string[]>([])
  const [guardrails, setGuardrails] = useState<AgentConfig['guardrails'] | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    if (agentConfig) {
      setTone(agentConfig.tone)
      setArchetype(agentConfig.archetype)
      setGoals(agentConfig.goals)
      setConstraints(agentConfig.constraints)
      setGuardrails(agentConfig.guardrails)
    }
  }, [agentConfig])

  if (!open) return null

  const handleSaveAll = () => {
    if (apiKey.trim()) onSaveApiKey(apiKey.trim())
    if (guardrails) {
      onSaveProfile({ tone, archetype, goals, constraints, guardrails })
    }
    setStatusMessage('Settings updated.')
    setTimeout(() => setStatusMessage(null), 3000)
  }

  return (
    <div className="modal-overlay">
      <div className={`modal ${styles.modal}`}>
        <div className={styles.header}>
          <div>
            <h2>Settings</h2>
            <p className="muted">Configure FolderMind and the active agent profile.</p>
          </div>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>

        <div className={styles.grid}>
          <div className={styles.section}>
            <h3>Workspace</h3>
            <div className={styles.meta}>
              <div><span className={styles.k}>Folder Name</span><span className={styles.v}>{folderName}</span></div>
              <div><span className={styles.k}>Local Path</span><span className={`${styles.v} ${styles.mono}`}>{folderPath}</span></div>
            </div>
            <div className={styles.divider} />
            <span className={styles.label}>OpenAI API Key (Session-only)</span>
            <input
              type="password"
              className={styles.input}
              placeholder="sk-..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
            <p className={styles.help}>This key is stored only in memory for the current session. For permanent usage, add VITE_OPENAI_API_KEY to your project's .env file.</p>
          </div>

          <div className={styles.section}>
            <h3>Agent Profile</h3>
            <div className={styles.meta}>
              <div style={{ flexDirection: 'row', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <span className={styles.k}>Tone</span>
                  <select className={styles.input} value={tone} onChange={e => setTone(e.target.value)}>
                    <option value="professional">Professional</option>
                    <option value="concise">Concise</option>
                    <option value="creative">Creative</option>
                    <option value="helpful">Helpful</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <span className={styles.k}>Archetype</span>
                  <select className={styles.input} value={archetype} onChange={e => setArchetype(e.target.value as AgentConfig['archetype'])}>
                    {ARCHETYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div>
              <span className={styles.k}>Goals (one per line)</span>
              <textarea
                className={styles.textarea}
                rows={3}
                value={goals.join('\n')}
                onChange={e => setGoals(e.target.value.split('\n'))}
              />
            </div>
            <div>
              <span className={styles.k}>Constraints (one per line)</span>
              <textarea
                className={styles.textarea}
                rows={3}
                value={constraints.join('\n')}
                onChange={e => setConstraints(e.target.value.split('\n'))}
              />
            </div>
          </div>

          <div className={`${styles.section} ${styles.sectionFull}`}>
            <h3>Runtime Policy & Guardrails</h3>
            <div className={styles.grid}>
              <div className={styles.policyList}>
                <label className={styles.check}><input type="checkbox" checked={guardrails?.requireApprovalForDangerousCommands} onChange={e => guardrails && setGuardrails({...guardrails, requireApprovalForDangerousCommands: e.target.checked})} /> Require approval for dangerous shell commands</label>
                <label className={styles.check}><input type="checkbox" checked={guardrails?.requireApprovalForFileChanges} onChange={e => guardrails && setGuardrails({...guardrails, requireApprovalForFileChanges: e.target.checked})} /> Require approval for file modifications</label>
                <label className={styles.check}><input type="checkbox" checked={guardrails?.runtime.allowBackgroundAgent} onChange={e => guardrails && setGuardrails({...guardrails, runtime: {...guardrails.runtime, allowBackgroundAgent: e.target.checked}})} /> Allow autonomous background agent</label>
              </div>
              <div className={styles.policyList}>
                <label className={styles.check}><input type="checkbox" checked={guardrails?.runtime.autoRunFileReview} onChange={e => guardrails && setGuardrails({...guardrails, runtime: {...guardrails.runtime, autoRunFileReview: e.target.checked}})} /> Auto-review files on change</label>
                <label className={styles.check}><input type="checkbox" checked={guardrails?.runtime.autoRunDiffSummary} onChange={e => guardrails && setGuardrails({...guardrails, runtime: {...guardrails.runtime, autoRunDiffSummary: e.target.checked}})} /> Auto-generate git diff summaries</label>
                <label className={styles.check}><input type="checkbox" checked={guardrails?.runtime.autoQueueTestRuns} onChange={e => guardrails && setGuardrails({...guardrails, runtime: {...guardrails.runtime, autoQueueTestRuns: e.target.checked}})} /> Auto-queue verification/test runs</label>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          {statusMessage && <span className={styles.statusMessage}>{statusMessage}</span>}
          <button className="btn-primary" onClick={handleSaveAll}>Save All Settings</button>
        </div>
      </div>
    </div>
  )
}
