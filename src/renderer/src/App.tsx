import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsModal } from './components/SettingsModal'
import { AuthScreen } from './components/AuthScreen'
import { UpgradeModal } from './components/UpgradeModal'
import { GitPanel } from './components/GitPanel'
import { AgentInbox } from './components/AgentInbox'
import { useFolder } from './hooks/useFolder'
import { useAuth } from './hooks/useAuth'
import { useUsage } from './hooks/useUsage'
import { useSync } from './hooks/useSync'
import type { SmartFolder } from './hooks/useFolder'
import type { TaskItem, AgentConfig } from '../../src/vite-env'
import './App.css'

export default function App() {
  // ── Auth ──────────────────────────────────────────────────────
  const { user, authState, error: authError, loginWithEmail, signupWithEmail, loginWithGoogle, logout } = useAuth()
  const {
    usage,
    canCreateFolder,
    canSendAI,
    aiCallsRemaining,
    trackFolderCreated,
    trackAICall,
  } = useUsage(user)

  const sync = useSync(user)

  // ── Folder state ──────────────────────────────────────────────
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
    jobs,
    events,
    briefingLoading,
    briefingError,
    recentChanges,
    refreshBriefing,
    addTask,
    updateTask,
    deleteTask,
    runTask,
    refreshTasks,
    refreshJobs,
  } = useFolder()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [upgradeReason, setUpgradeReason] = useState<'folders' | 'ai_calls' | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const headerButtonStyle = {
    background: 'transparent', border: '1px solid #444', color: '#fff',
    padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
  } as const

  useEffect(() => {
    window.foldermind.getAgentStatus().then((s) => setHasApiKey(s.hasApiKey)).catch(() => setHasApiKey(false))
  }, [])

  useEffect(() => {
    if (!activeFolder) return
    setWorkspaceNotice(null)
    window.foldermind.getConfig(activeFolder.path).then(setAgentConfig).catch(() => setAgentConfig(null))
  }, [activeFolder])

  // ── Handlers ──────────────────────────────────────────────────
  // ── Sync tasks whenever they change ──────────────────────────────────────
  const tasksSyncedOnce = useRef(false)
  useEffect(() => {
    if (!activeFolder) { tasksSyncedOnce.current = false; return }
    if (!tasksSyncedOnce.current) { tasksSyncedOnce.current = true; return } // skip first load
    sync.onTasksChange(activeFolder.path, tasks)
  }, [tasks]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectFolder = useCallback(async (folder: SmartFolder) => {
    const activated = await window.foldermind.activateFolder(folder.path)
    const nextFolder = activated || folder
    setActiveFolder(nextFolder)
    await sync.onFolderOpen(nextFolder)
  }, [setActiveFolder, sync])

  const handleCreateFolder = useCallback(async () => {
    if (!canCreateFolder) { setUpgradeReason('folders'); return }
    const folder = await createFolder()
    if (folder) {
      await trackFolderCreated()
      await sync.onFolderOpen(folder)
    }
  }, [canCreateFolder, createFolder, trackFolderCreated, sync])

  const handleOpenFolder = useCallback(async () => {
    const folder = await openFolder()
    if (folder) await sync.onFolderOpen(folder)
  }, [openFolder, sync])

  const handleMemoryUpdate = useCallback(async (newMemory: string) => {
    await updateMemory(newMemory)
    if (activeFolder) sync.onMemoryChange(activeFolder.path, newMemory)
    refreshBriefing?.()
    refreshTasks?.()
  }, [updateMemory, activeFolder, sync, refreshBriefing, refreshTasks])

  const handleRunTask = useCallback(async (task: TaskItem) => {
    const response = await runTask(task.id)
    if (response) await trackAICall()
    refreshBriefing?.()
    refreshTasks?.()
    return response
  }, [runTask, trackAICall, refreshBriefing, refreshTasks])

  const handleAfterAICall = useCallback(async () => {
    await trackAICall()
    // Sync chat after every AI response
    if (activeFolder) {
      try {
        const messages = await window.foldermind.getChatHistory(activeFolder.path)
        sync.onChatMessages(activeFolder.path, messages)
      } catch { /* non-critical */ }
    }
  }, [trackAICall, activeFolder, sync])

  const handleSaveApiKey = useCallback(async (key: string) => {
    await window.foldermind.setApiKey(key)
    setHasApiKey(true)
    setWorkspaceNotice('OpenAI API key saved for this session.')
    refreshJobs?.()
  }, [refreshJobs])

  const handleSaveProfile = useCallback(async (updates: {
    tone: string; archetype: AgentConfig['archetype']; goals: string[]; constraints: string[]; guardrails: AgentConfig['guardrails']
  }) => {
    if (!activeFolder) return
    const updated = await window.foldermind.updateConfig(activeFolder.path, updates)
    setAgentConfig(updated)
    setWorkspaceNotice('Folder profile updated.')
    refreshBriefing?.()
  }, [activeFolder, refreshBriefing])

  // ── Cloud folder merge (must be before any early return) ─────────────────
  const cloudMergedRef = useRef(false)
  const [cloudOnlyFolders, setCloudOnlyFolders] = useState<SmartFolder[]>([])
  useEffect(() => {
    if (!sync.cloudFoldersLoaded || cloudMergedRef.current) return
    cloudMergedRef.current = true
    const localPaths = new Set(recentFolders.map((f) => f.path))
    const fromCloud = sync.cloudFolders
      .filter((cf) => cf.localPath && !localPaths.has(cf.localPath))
      .map((cf) => ({ path: cf.localPath, name: cf.name, memory: cf.memory, agentConfig: {} }))
    if (fromCloud.length > 0) setCloudOnlyFolders(fromCloud)
  }, [sync.cloudFoldersLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth gate (all hooks above this line) ─────────────────────
  if (authState === 'loading') {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="splash-logo">🗂️</div>
          <p className="splash-label">FolderMind</p>
          <div className="splash-spinner" />
        </div>
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return (
      <AuthScreen
        onLogin={loginWithEmail}
        onSignup={signupWithEmail}
        onGoogle={loginWithGoogle}
        error={authError}
      />
    )
  }

  const mergedRecentFolders = [
    ...recentFolders,
    ...cloudOnlyFolders.filter((cf) => !recentFolders.some((rf) => rf.path === cf.path)),
  ]

  // ── Plan tier helpers ──────────────────────────────────────────
  const isFreeTier = usage.planTier === 'free'
  const aiCallsLabel = isFreeTier
    ? `${aiCallsRemaining} AI call${aiCallsRemaining !== 1 ? 's' : ''} left`
    : 'Unlimited AI'

  // Sync status display
  const syncLabel = sync.status === 'syncing' ? '⟳ Syncing' : sync.status === 'synced' ? '☁ Synced' : sync.status === 'error' ? '⚠ Sync error' : ''
  const syncClass = `sync-indicator ${sync.status}`

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app">
      <Sidebar
        activeFolder={activeFolder}
        recentFolders={mergedRecentFolders}
        onCreateFolder={handleCreateFolder}
        onOpenFolder={handleOpenFolder}
        onSelectFolder={handleSelectFolder}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main">
        {!activeFolder ? (
          <div className="welcome">
            <div className="welcome-inner">
              <h1>🗂️ FolderMind</h1>
              <p className="tagline">Every folder, a co-worker.</p>
              <p className="desc">
                Drop files into a folder. Ask questions. Get answers.<br />
                Your AI agent can read, write, and execute code within your project.
              </p>
              {!hasApiKey && (
                <p className="welcome-note">Tip: open Settings and add your OpenAI API key before running tasks.</p>
              )}
              <div className="welcome-steps">
                <div className="welcome-step"><span>1</span><div><strong>Create or open a folder</strong><p>Choose the workspace you want FolderMind to understand.</p></div></div>
                <div className="welcome-step"><span>2</span><div><strong>Add your API key</strong><p>Use Settings for a session key, or place one in your local .env.</p></div></div>
                <div className="welcome-step"><span>3</span><div><strong>Chat or run tasks</strong><p>Ask for a summary, code changes, planning help, or execute saved tasks.</p></div></div>
              </div>
              <div className="welcome-actions">
                <button className="btn-primary large" onClick={handleCreateFolder}>+ Create Smart Folder</button>
                <button className="btn-secondary large" onClick={handleOpenFolder}>Open Existing Folder</button>
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
                  <span className={`status-pill ${hasApiKey ? 'ok' : 'warn'}`}>
                    {hasApiKey ? 'API Key Ready' : 'API Key Needed'}
                  </span>
                  {agentConfig && <span className="status-pill neutral">{agentConfig.archetype}</span>}
                  {agentConfig?.tone && <span className="status-pill neutral">tone: {agentConfig.tone}</span>}
                </div>
              </div>
              <div className="workspace-badge" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button onClick={() => window.foldermind.openInExplorer(activeFolder.path, '')} style={headerButtonStyle}>📂 Open</button>
                <button onClick={() => refreshBriefing?.()} style={headerButtonStyle}>✨ Brief</button>
                <button onClick={() => setSettingsOpen(true)} style={headerButtonStyle}>⚙️ Settings</button>
                <span>🧠 Agent Active</span>
              </div>
            </div>

            {/* ── Usage bar ── */}
            <div className="usage-bar">
              <div className="usage-bar-left">
                <span className={`usage-plan-pill ${usage.planTier}`}>{usage.planTier}</span>
                <span className={`usage-calls-label ${!canSendAI ? 'exhausted' : ''}`}>
                  {aiCallsLabel}
                  {isFreeTier && (
                    <span className="usage-calls-track">
                      <span
                        className="usage-calls-fill"
                        style={{ width: `${Math.min(100, ((50 - aiCallsRemaining) / 50) * 100)}%` }}
                      />
                    </span>
                  )}
                </span>
                {isFreeTier && (
                  <button className="usage-upgrade-btn" onClick={() => setUpgradeReason('ai_calls')}>
                    Upgrade →
                  </button>
                )}
              </div>
              <div className="usage-bar-right">
                {syncLabel && <span className={syncClass}>{syncLabel}</span>}
                <span className="usage-user-email">{user?.email}</span>
                <button className="usage-signout-btn" onClick={logout}>Sign out</button>
              </div>
            </div>

            {workspaceNotice && <div className="workspace-notice">{workspaceNotice}</div>}

            <div className="briefing-strip">
              <div className="briefing-main">
                <strong>Folder Brief</strong>
                <p>{briefingLoading ? 'Generating folder briefing...' : briefingError ? briefingError : briefing?.summary || 'No briefing yet.'}</p>
              </div>
              <div className="briefing-side">
                <div><span className="briefing-label">Recent Changes</span><ul>{(recentChanges.length > 0 ? recentChanges : briefing?.recentChanges || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                <div><span className="briefing-label">Suggestions</span><ul>{(briefing?.suggestions || []).slice(0, 3).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                <div><span className="briefing-label">Open Tasks</span><ul>{(briefing?.openTasks || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                <div><span className="briefing-label">Key Decisions</span><ul>{(briefing?.keyDecisions || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
              </div>
            </div>

            <AgentInbox
              tasks={tasks}
              jobs={jobs}
              events={events}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
              onRunNow={async () => {
                if (!activeFolder) return
                await window.foldermind.runAgentJobs(activeFolder.path)
                refreshJobs?.()
              }}
              onApproveJob={async (jobId) => {
                if (!activeFolder) return
                await window.foldermind.approveAgentJob(activeFolder.path, jobId)
                refreshJobs?.()
                refreshTasks?.()
              }}
              onRetryJob={async (jobId) => {
                if (!activeFolder) return
                await window.foldermind.retryAgentJob(activeFolder.path, jobId)
                refreshJobs?.()
              }}
              onDismissJob={async (jobId, reason) => {
                if (!activeFolder) return
                await window.foldermind.dismissAgentJob(activeFolder.path, jobId, reason)
                refreshJobs?.()
              }}
              onCreateTask={async (text) => {
                await addTask(text)
                refreshTasks?.()
              }}
              onOpenTask={(taskId) => setSelectedTaskId(taskId)}
            />

            {gitStatus?.isRepo
              ? <GitPanel
                  folderPath={activeFolder.path}
                  gitStatus={gitStatus}
                  onRefresh={() => refreshBriefing?.()}
                />
              : <div className="git-strip git-strip-empty"><div className="git-card wide"><span className="briefing-label">Git Status</span><p>This folder is not a git repository.</p></div><div className="git-card"><span className="briefing-label">Suggestion</span><p>Run <code>git init</code> to unlock branch tracking, diffs, and commit workflow.</p></div></div>
            }

            <ChatPanel
              folderName={activeFolder.name}
              folderPath={activeFolder.path}
              memory={activeFolder.memory}
              tasks={tasks}
              jobs={jobs}
              selectedTaskId={selectedTaskId}
              hasApiKey={hasApiKey}
              canSendAI={canSendAI}
              onMemoryUpdate={handleMemoryUpdate}
              onRunTask={handleRunTask}
              onAddTask={addTask}
              onToggleTask={(task) => updateTask(task.id, { status: task.status === 'suggested' ? 'open' : task.status === 'open' ? 'done' : 'open' })}
              onDeleteTask={deleteTask}
              onSelectTask={setSelectedTaskId}
              onSelectJob={setSelectedJobId}
              onAfterAICall={handleAfterAICall}
              onUsageLimitHit={() => setUpgradeReason('ai_calls')}
            />
          </div>
        )}
      </main>

      {activeFolder && (
        <SettingsModal
          open={settingsOpen}
          folderName={activeFolder.name}
          folderPath={activeFolder.path}
          agentConfig={agentConfig}
          onClose={() => setSettingsOpen(false)}
          onSaveApiKey={handleSaveApiKey}
          onSaveProfile={handleSaveProfile}
        />
      )}

      {upgradeReason && (
        <UpgradeModal
          reason={upgradeReason}
          onClose={() => setUpgradeReason(null)}
          onUpgrade={() => { window.open('https://foldermind.app/pricing', '_blank'); setUpgradeReason(null) }}
        />
      )}
    </div>
  )
}





