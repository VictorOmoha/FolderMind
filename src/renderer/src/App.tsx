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
import styles from './App.module.css'
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
  const [activeTab, setActiveTab] = useState<'overview' | 'chat' | 'inbox' | 'git'>('overview')

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
  const syncClass = `${styles.syncIndicator} ${styles[sync.status] || ''}`

  // Dynamic badge counts
  const openTasksCount = tasks.filter((t) => t.status === 'open').length
  const pendingJobsCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  const gitChangesCount = gitStatus?.isRepo
    ? (gitStatus.changedFiles?.length || 0) + (gitStatus.stagedFiles?.length || 0)
    : 0

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className={styles.app}>
      <Sidebar
        activeFolder={activeFolder}
        recentFolders={mergedRecentFolders}
        onCreateFolder={handleCreateFolder}
        onOpenFolder={handleOpenFolder}
        onSelectFolder={handleSelectFolder}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className={styles.main}>
        {!activeFolder ? (
          <div className={styles.welcome}>
            <div className={styles.welcomeInner}>
              <h1>🗂️ FolderMind</h1>
              <p className={styles.tagline}>Every folder, a co-worker.</p>
              <p className={styles.desc}>
                Drop files into a folder. Ask questions. Get answers.<br />
                Your AI agent can read, write, and execute code within your project.
              </p>
              {!hasApiKey && (
                <p className={styles.welcomeNote}>Tip: open Settings and add your OpenAI API key before running tasks.</p>
              )}
              <div className={styles.welcomeSteps}>
                <div className={styles.welcomeStep}><span>1</span><div><strong>Create or open a folder</strong><p>Choose the workspace you want FolderMind to understand.</p></div></div>
                <div className={styles.welcomeStep}><span>2</span><div><strong>Add your API key</strong><p>Use Settings for a session key, or place one in your local .env.</p></div></div>
                <div className={styles.welcomeStep}><span>3</span><div><strong>Chat or run tasks</strong><p>Ask for a summary, code changes, planning help, or execute saved tasks.</p></div></div>
              </div>
              <div className={styles.welcomeActions}>
                <button className="btn-primary large" onClick={handleCreateFolder}>+ Create Smart Folder</button>
                <button className="btn-secondary large" onClick={handleOpenFolder}>Open Existing Folder</button>
                <button className="btn-secondary large" onClick={() => setSettingsOpen(true)}>Settings</button>
              </div>
            </div>
          </div>
        ) : (
          <div className={`${styles.workspace} ${activeTab === 'chat' || activeTab === 'inbox' ? styles.noScroll : ''}`}>
            <div className={styles.workspaceHeader}>
              <div>
                <h2>{activeFolder.name}</h2>
                <span className={styles.folderPath}>{activeFolder.path}</span>
                <div className={styles.statusRow}>
                  <span className={`${styles.statusPill} ${hasApiKey ? styles.ok : styles.warn}`}>
                    {hasApiKey ? 'API Key Ready' : 'API Key Needed'}
                  </span>
                  {agentConfig && <span className={`${styles.statusPill} ${styles.neutral}`}>{agentConfig.archetype}</span>}
                  {agentConfig?.tone && <span className={`${styles.statusPill} ${styles.neutral}`}>tone: {agentConfig.tone}</span>}
                </div>
              </div>
              <div className={styles.workspaceBadge} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button onClick={() => window.foldermind.openInExplorer(activeFolder.path, '')} style={headerButtonStyle}>📂 Open</button>
                <button onClick={() => refreshBriefing?.()} style={headerButtonStyle}>✨ Brief</button>
                <button onClick={() => setSettingsOpen(true)} style={headerButtonStyle}>⚙️ Settings</button>
                <span>🧠 Agent Active</span>
              </div>
            </div>

            {/* ── Tabs Navigation Bar ── */}
            <div className={styles.tabsHeader}>
              <button
                className={`${styles.tabButton} ${activeTab === 'overview' ? styles.activeTab : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                📁 Overview
              </button>
              <button
                className={`${styles.tabButton} ${activeTab === 'chat' ? styles.activeTab : ''}`}
                onClick={() => setActiveTab('chat')}
              >
                💬 Chat & Tasks
                {openTasksCount > 0 && <span className={`${styles.tabBadge} ${styles.badgeInfo}`}>{openTasksCount}</span>}
              </button>
              <button
                className={`${styles.tabButton} ${activeTab === 'inbox' ? styles.activeTab : ''}`}
                onClick={() => setActiveTab('inbox')}
              >
                📥 Inbox & Jobs
                {pendingJobsCount > 0 && <span className={`${styles.tabBadge} ${styles.badgeWarning}`}>{pendingJobsCount}</span>}
              </button>
              <button
                className={`${styles.tabButton} ${activeTab === 'git' ? styles.activeTab : ''}`}
                onClick={() => setActiveTab('git')}
              >
                🌿 Git Control
                {gitChangesCount > 0 && <span className={`${styles.tabBadge} ${styles.badgeError}`}>{gitChangesCount}</span>}
              </button>
            </div>

            {workspaceNotice && <div className={styles.workspaceNotice}>{workspaceNotice}</div>}

            <div className={`${styles.tabContent} ${activeTab === 'chat' || activeTab === 'inbox' ? styles.noScroll : ''}`}>
              {activeTab === 'overview' && (
                <div className={styles.overviewContainer}>
                  {/* Briefing Strip */}
                  <div className={styles.briefingStrip}>
                    <div className={styles.briefingMain}>
                      <strong>Folder Brief</strong>
                      <p>{briefingLoading ? 'Generating folder briefing...' : briefingError ? briefingError : briefing?.summary || 'No briefing yet.'}</p>
                    </div>
                    <div className={styles.briefingSide}>
                      <div><span className={styles.briefingLabel}>Recent Changes</span><ul>{(recentChanges.length > 0 ? recentChanges : briefing?.recentChanges || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                      <div><span className={styles.briefingLabel}>Suggestions</span><ul>{(briefing?.suggestions || []).slice(0, 3).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                      <div><span className={styles.briefingLabel}>Open Tasks</span><ul>{(briefing?.openTasks || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                      <div><span className={styles.briefingLabel}>Key Decisions</span><ul>{(briefing?.keyDecisions || []).slice(0, 4).map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                    </div>
                  </div>

                  {/* Plan / Account Usage persistent details at bottom of Overview */}
                  <div className={styles.usageBar}>
                    <div className={styles.usageBarLeft}>
                      <span className={`${styles.usagePlanPill} ${styles[usage.planTier] || ''}`}>{usage.planTier}</span>
                      <span className={`${styles.usageCallsLabel} ${!canSendAI ? styles.exhausted : ''}`}>
                        {aiCallsLabel}
                        {isFreeTier && (
                          <span className={styles.usageCallsTrack}>
                            <span
                              className={styles.usageCallsFill}
                              style={{ width: `${Math.min(100, ((50 - aiCallsRemaining) / 50) * 100)}%` }}
                            />
                          </span>
                        )}
                      </span>
                      {isFreeTier && (
                        <button className={styles.usageUpgradeBtn} onClick={() => setUpgradeReason('ai_calls')}>
                          Upgrade →
                        </button>
                      )}
                    </div>
                    <div className={styles.usageBarRight}>
                      {syncLabel && <span className={syncClass}>{syncLabel}</span>}
                      <span className={styles.usageUserEmail}>{user?.email}</span>
                      <button className={styles.usageSignoutBtn} onClick={logout}>Sign out</button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'chat' && (
                <ChatPanel
                  folderName={activeFolder.name}
                  folderPath={activeFolder.path}
                  memory={activeFolder.memory}
                  tasks={tasks}
                  jobs={jobs}
                  selectedTaskId={selectedTaskId}
                  hasApiKey={hasApiKey}
                  canSendAI={canSendAI}
                  onRunTask={handleRunTask}
                  onAddTask={addTask}
                  onToggleTask={(task) => updateTask(task.id, { status: task.status === 'suggested' ? 'open' : task.status === 'open' ? 'done' : 'open' })}
                  onDeleteTask={deleteTask}
                  onSelectTask={setSelectedTaskId}
                  onSelectJob={setSelectedJobId}
                  onAfterAICall={handleAfterAICall}
                  onUsageLimitHit={() => setUpgradeReason('ai_calls')}
                />
              )}

              {activeTab === 'inbox' && (
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
                  onOpenTask={(taskId) => {
                    setSelectedTaskId(taskId)
                    setActiveTab('chat')
                  }}
                />
              )}

              {activeTab === 'git' && (
                gitStatus?.isRepo
                  ? <GitPanel
                      folderPath={activeFolder.path}
                      gitStatus={gitStatus}
                      onRefresh={() => refreshBriefing?.()}
                    />
                  : <div className={`${styles.gitStrip} ${styles.gitStripEmpty}`}><div className={`${styles.gitCard} ${styles.wide}`}><span className={styles.briefingLabel}>Git Status</span><p>This folder is not a git repository.</p></div><div className={styles.gitCard}><span className={styles.briefingLabel}>Suggestion</span><p>Run <code>git init</code> to unlock branch tracking, diffs, and commit workflow.</p></div></div>
              )}
            </div>
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
