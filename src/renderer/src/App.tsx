import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsModal } from './components/SettingsModal'
import { useFolder } from './hooks/useFolder'
import type { SmartFolder } from './hooks/useFolder'
import type { TaskItem, AgentConfig } from '../../src/vite-env'
import './App.css'

export default function App() {
  const {
    activeFolder,
    recentFolders,
    createFolder,
    openFolder,
    updateMemory,
    setActiveFolder,
    briefing,
    gitStatus,
    tasks,
    briefingLoading,
    briefingError,
    recentChanges,
    refreshBriefing,
    addTask,
    updateTask,
    deleteTask,
    runTask,
    refreshTasks,
  } = useFolder()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const headerButtonStyle = { background: 'transparent', border: '1px solid #444', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' } as const

  useEffect(() => {
    window.foldermind.getAgentStatus().then((status) => setHasApiKey(status.hasApiKey)).catch(() => setHasApiKey(false))
  }, [])

  useEffect(() => {
    if (!activeFolder) return
    setWorkspaceNotice(null)
    window.foldermind.getConfig(activeFolder.path).then(setAgentConfig).catch(() => setAgentConfig(null))
  }, [activeFolder])

  const handleSelectFolder = useCallback((folder: SmartFolder) => {
    console.log('Select folder:', folder.path)
    setActiveFolder(folder)
  }, [setActiveFolder])

  const handleMemoryUpdate = useCallback(async (newMemory: string) => {
    await updateMemory(newMemory)
    refreshBriefing?.()
    refreshTasks?.()
  }, [updateMemory, refreshBriefing, refreshTasks])

  const handleRunTask = useCallback(async (task: TaskItem) => {
    const response = await runTask(task.id)
    refreshBriefing?.()
    refreshTasks?.()
    return response
  }, [runTask, refreshBriefing, refreshTasks])

  const handleSaveApiKey = useCallback(async (key: string) => {
    await window.foldermind.setApiKey(key)
    setHasApiKey(true)
    setWorkspaceNotice('OpenAI API key saved for this session.')
  }, [])

  const handleSaveProfile = useCallback(async (updates: { tone: string; archetype: AgentConfig['archetype']; goals: string[]; constraints: string[] }) => {
    if (!activeFolder) return
    const updated = await window.foldermind.updateConfig(activeFolder.path, updates)
    setAgentConfig(updated)
    setWorkspaceNotice('Folder profile updated.')
    refreshBriefing?.()
  }, [activeFolder, refreshBriefing])

  return (
    <div className="app">
      <Sidebar activeFolder={activeFolder} recentFolders={recentFolders} onCreateFolder={createFolder} onOpenFolder={openFolder} onSelectFolder={handleSelectFolder} onOpenSettings={() => setSettingsOpen(true)} />

      <main className="main">
        {!activeFolder ? (
          <div className="welcome">
            <div className="welcome-inner">
              <h1>🗂️ FolderMind</h1>
              <p className="tagline">Every folder, a co-worker.</p>
              <p className="desc">Drop files into a folder. Ask questions. Get answers.<br />Your AI agent can read, write, and execute code within your project.</p>
              {!hasApiKey && <p className="welcome-note">Tip: open Settings and add your OpenAI API key before running tasks.</p>}
              <div className="welcome-steps">
                <div className="welcome-step"><span>1</span><div><strong>Create or open a folder</strong><p>Choose the workspace you want FolderMind to understand.</p></div></div>
                <div className="welcome-step"><span>2</span><div><strong>Add your API key</strong><p>Use Settings for a session key, or place one in your local .env.</p></div></div>
                <div className="welcome-step"><span>3</span><div><strong>Chat or run tasks</strong><p>Ask for a summary, code changes, planning help, or execute saved tasks.</p></div></div>
              </div>
              <div className="welcome-actions">
                <button className="btn-primary large" onClick={createFolder}>+ Create Smart Folder</button>
                <button className="btn-secondary large" onClick={openFolder}>Open Existing Folder</button>
                <button className="btn-secondary large" onClick={() => setSettingsOpen(true)}>Settings</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="workspace-header">
              <div>
                <h2>{activeFolder.name}</h2>
                <span className="folder-path">{activeFolder.path}</span>
                <div className="status-row">
                  <span className={`status-pill ${hasApiKey ? 'ok' : 'warn'}`}>{hasApiKey ? 'API Key Ready' : 'API Key Needed'}</span>
                  {agentConfig && <span className="status-pill neutral">{agentConfig.archetype}</span>}
                  {agentConfig?.tone && <span className="status-pill neutral">tone: {agentConfig.tone}</span>}
                </div>
              </div>
              <div className="workspace-badge" style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => window.foldermind.openInExplorer(activeFolder.path, '')} style={headerButtonStyle}>📂 Open</button>
                <button onClick={() => refreshBriefing?.()} style={headerButtonStyle}>✨ Brief</button>
                <button onClick={() => setSettingsOpen(true)} style={headerButtonStyle}>⚙️ Settings</button>
                <span>🧠 Agent Active</span>
              </div>
            </div>

            {workspaceNotice && <div className="workspace-notice">{workspaceNotice}</div>}

            <div className="briefing-strip">
              <div className="briefing-main"><strong>Folder Brief</strong><p>{briefingLoading ? 'Generating folder briefing...' : briefingError ? briefingError : briefing?.summary || 'No briefing yet.'}</p></div>
              <div className="briefing-side">
                <div><span className="briefing-label">Recent Changes</span><ul>{(recentChanges.length > 0 ? recentChanges : briefing?.recentChanges || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                <div><span className="briefing-label">Suggestions</span><ul>{(briefing?.suggestions || []).slice(0, 3).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                <div><span className="briefing-label">Open Tasks</span><ul>{(briefing?.openTasks || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                <div><span className="briefing-label">Key Decisions</span><ul>{(briefing?.keyDecisions || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
              </div>
            </div>

            {gitStatus?.isRepo ? <div className="git-strip"><div className="git-card wide"><span className="briefing-label">Git Status</span><p>Branch: <strong>{gitStatus.branch || 'unknown'}</strong>{gitStatus.aheadBehind ? ` · ${gitStatus.aheadBehind}` : ''}</p><p>{gitStatus.changedFiles.length} changed · {gitStatus.stagedFiles.length} staged · {gitStatus.untrackedFiles.length} untracked</p></div><div className="git-card"><span className="briefing-label">Commit Suggestion</span><p>{gitStatus.suggestedCommitMessage || 'No suggested commit message yet.'}</p></div></div> : <div className="git-strip git-strip-empty"><div className="git-card wide"><span className="briefing-label">Git Status</span><p>This folder is not currently detected as a git repository.</p></div><div className="git-card"><span className="briefing-label">Suggestion</span><p>Initialize git to unlock change summaries, branch awareness, and commit suggestions.</p></div></div>}

            <ChatPanel folderName={activeFolder.name} folderPath={activeFolder.path} memory={activeFolder.memory} tasks={tasks} hasApiKey={hasApiKey} onMemoryUpdate={handleMemoryUpdate} onRunTask={handleRunTask} onAddTask={addTask} onToggleTask={(task) => updateTask(task.id, { status: task.status === 'open' ? 'done' : 'open' })} onDeleteTask={deleteTask} />
          </div>
        )}
      </main>

      {activeFolder && <SettingsModal open={settingsOpen} folderName={activeFolder.name} folderPath={activeFolder.path} agentConfig={agentConfig} onClose={() => setSettingsOpen(false)} onSaveApiKey={handleSaveApiKey} onSaveProfile={handleSaveProfile} />}
    </div>
  )
}
