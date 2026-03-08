import { useEffect, useState } from 'react'

interface AgentConfigLike {
  name?: string
  tone?: string
  archetype?: 'general' | 'codebase' | 'research' | 'content' | 'operations'
  goals?: string[]
  constraints?: string[]
}

interface Props {
  open: boolean
  folderName: string
  folderPath: string
  agentConfig: AgentConfigLike | null
  onClose: () => void
  onSaveApiKey: (key: string) => Promise<void>
  onSaveProfile: (updates: { tone: string; archetype: AgentConfigLike['archetype']; goals: string[]; constraints: string[] }) => Promise<void>
}

export function SettingsModal({ open, folderName, folderPath, agentConfig, onClose, onSaveApiKey, onSaveProfile }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [tone, setTone] = useState('direct, practical, helpful')
  const [archetype, setArchetype] = useState<AgentConfigLike['archetype']>('general')
  const [goals, setGoals] = useState('')
  const [constraints, setConstraints] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!agentConfig) return
    setTone(agentConfig.tone || 'direct, practical, helpful')
    setArchetype(agentConfig.archetype || 'general')
    setGoals((agentConfig.goals || []).join('\n'))
    setConstraints((agentConfig.constraints || []).join('\n'))
    setSaveMessage(null)
  }, [agentConfig, open])

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
      })
      setSaveMessage('Settings saved.')
      onClose()
    } catch (error: any) {
      setSaveMessage(error?.message || 'Unable to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2 className="modal-title">Settings</h2>
            <p className="modal-message">Manage your API key and folder profile.</p>
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
            <select className="settings-input" value={archetype} onChange={(e) => setArchetype(e.target.value as AgentConfigLike['archetype'])}>
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

        <div className="settings-actions">
          {saveMessage && <span className="settings-status-message">{saveMessage}</span>}
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</button>
        </div>
      </div>
    </div>
  )
}
