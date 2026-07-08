import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsModal } from './components/SettingsModal'
import { FeedbackModal } from './components/FeedbackModal'
import { AuthScreen } from './components/AuthScreen'
import { UpgradeModal } from './components/UpgradeModal'
import { GitPanel } from './components/GitPanel'
import { AgentInbox } from './components/AgentInbox'
import { FolderMark } from './components/Icons'
import { useFolder } from './hooks/useFolder'
import { firebaseConfigured } from './lib/firebase'
import { useAuth } from './hooks/useAuth'
import { useUsage } from './hooks/useUsage'
import { useSync } from './hooks/useSync'
import type { SmartFolder } from './hooks/useFolder'
import type { TaskItem, AgentConfig } from '../../../src/vite-env'
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
  const [aiMode, setAiMode] = useState<'byo' | 'hosted' | 'none'>('none')
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null)
  const [upgradeReason, setUpgradeReason] = useState<'folders' | 'ai_calls' | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<'chat' | 'overview' | 'agent' | 'git'>('chat')
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const headerButtonStyle = {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-muted)',
    padding: '6px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 500,
  } as const

  const refreshAiStatus = useCallback(async () => {
    try {
      const s = await window.foldermind.getAgentStatus()
      setAiMode(s.mode ?? (s.hasApiKey ? 'byo' : 'none'))
    } catch {
      setAiMode('none')
    }
  }, [])

  // Hand the main process a fresh Firebase ID token + plan so it can reach the hosted
  // AI gateway, then re-read AI status (hosted mode only unlocks once the token lands).
  // Refreshed periodically because ID tokens expire (~1h).
  useEffect(() => {
    let cancelled = false
    const push = async () => {
      if (!firebaseConfigured || !user) {
        await window.foldermind.setAuthContext(null, usage.planTier)
      } else {
        try {
          const token = await user.getIdToken()
          if (!cancelled) await window.foldermind.setAuthContext(token, usage.planTier)
        } catch {
          if (!cancelled) await window.foldermind.setAuthContext(null, usage.planTier)
        }
      }
      if (!cancelled) await refreshAiStatus()
    }
    void push()
    const id = setInterval(push, 45 * 60 * 1000)
    return () => { cancelled = true; clearInterval(id) }
  }, [user, usage.planTier, refreshAiStatus])

  // BYO calls are free and unlimited by design — only hosted calls draw down the allowance.
  const aiReady = aiMode !== 'none'
  const metered = aiMode === 'hosted'
  const effectiveCanSendAI = metered ? canSendAI : true

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
    if (response && metered) await trackAICall()
    refreshBriefing?.()
    refreshTasks?.()
    return response
  }, [runTask, trackAICall, metered, refreshBriefing, refreshTasks])

  const handleAfterAICall = useCallback(async () => {
    if (metered) await trackAICall()
    // Sync chat after every AI response
    if (activeFolder) {
      try {
        const messages = await window.foldermind.getChatHistory(activeFolder.path)
        sync.onChatMessages(activeFolder.path, messages)
      } catch { /* non-critical */ }
    }
  }, [trackAICall, metered, activeFolder, sync])

  const handleSaveApiKey = useCallback(async (key: string) => {
    await window.foldermind.setApiKey(key)
    await refreshAiStatus()
    setWorkspaceNotice('OpenAI API key saved for this session — unlimited AI on your key.')
    refreshJobs?.()
  }, [refreshAiStatus, refreshJobs])

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
          <div className="splash-logo"><FolderMark size={56} /></div>
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
  const aiCallsLabel = aiMode === 'byo'
    ? 'Your key · unlimited'
    : !isFreeTier
    ? 'Unlimited AI'
    : `${aiCallsRemaining} hosted call${aiCallsRemaining !== 1 ? 's' : ''} left`
  const showCallsMeter = metered && isFreeTier

  // Sync status display
  const syncLabel = sync.status === 'syncing' ? '⟳ Syncing' : sync.status === 'synced' ? '☁ Synced' : sync.status === 'error' ? '⚠ Sync error' : ''
  const syncClass = `${styles.syncIndicator} ${styles[sync.status] || ''}`

  // Jobs that still need attention — surfaced as a badge on the Agent Inbox tab
  const pendingJobCount = jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'blocked').length

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
        onSendFeedback={() => setFeedbackOpen(true)}
      />

      <main className={styles.main}>
        {!activeFolder ? (
          <div className={styles.welcome}>
            <div className={styles.welcomeInner}>
              <FolderMark size={44} className={styles.welcomeMark} />
              <h1>FolderMind</h1>
              <p className={styles.tagline}>Every folder, a co-worker.</p>
              <p className={styles.desc}>
                Drop files into a folder. Ask questions. Get answers.<br />
                Your AI agent can read, write, and execute code within your project.
              </p>
              {!aiReady && (
                <p className={styles.welcomeNote}>AI isn't connected yet — add your OpenAI key in Settings (free & unlimited), or sign in where hosted AI is enabled and it connects automatically.</p>
              )}
              <div className={styles.welcomeSteps}>
                <div className={styles.welcomeStep}><span>1</span><div><strong>Open a code folder</strong><p>Point FolderMind at a repo — it detects code projects and tunes itself for reading, editing, and verifying.</p></div></div>
                <div className={styles.welcomeStep}><span>2</span><div><strong>AI is included</strong><p>Hosted AI comes with your account — no key, no setup, a free monthly allowance. Bring your own OpenAI key any time for unlimited use.</p></div></div>
                <div className={styles.welcomeStep}><span>3</span><div><strong>Chat or run tasks</strong><p>Ask it to explain the architecture, review your changes, or make a guarded edit — with approval before anything risky.</p></div></div>
              </div>
              <div className={styles.welcomeActions}>
                <button className="btn-primary large" onClick={handleCreateFolder}>+ Create Smart Folder</button>
                <button className="btn-secondary large" onClick={handleOpenFolder}>Open Existing Folder</button>
                <button className="btn-secondary large" onClick={() => setSettingsOpen(true)}>Settings</button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.workspace}>
            <div className={styles.workspaceHeader}>
              <div>
                <h2>{activeFolder.name}</h2>
                <span className={styles.folderPath}>{activeFolder.path}</span>
                <div className={styles.statusRow}>
                  <span className={`${styles.statusPill} ${aiReady ? styles.ok : styles.warn}`}>
                    {aiMode === 'byo' ? 'AI ready · your key' : aiMode === 'hosted' ? 'AI ready · hosted' : 'Connect AI'}
                  </span>
                  {agentConfig && <span className={`${styles.statusPill} ${styles.neutral}`}>{agentConfig.archetype}</span>}
                  {agentConfig?.tone && <span className={`${styles.statusPill} ${styles.neutral}`}>tone: {agentConfig.tone}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button onClick={() => window.foldermind.openInExplorer(activeFolder.path, '')} style={headerButtonStyle}>Open</button>
                <button onClick={() => refreshBriefing?.()} style={headerButtonStyle}>Brief</button>
                <button onClick={() => setSettingsOpen(true)} style={headerButtonStyle}>Settings</button>
                <span className={styles.workspaceBadge}>Agent Active</span>
              </div>
            </div>

            {/* ── Usage bar ── */}
            <div className={styles.usageBar}>
              <div className={styles.usageBarLeft}>
                <span className={`${styles.usagePlanPill} ${styles[usage.planTier] || ''}`}>{usage.planTier}</span>
                <span className={`${styles.usageCallsLabel} ${!effectiveCanSendAI ? styles.exhausted : ''}`}>
                  {aiCallsLabel}
                  {showCallsMeter && (
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

            {workspaceNotice && <div className={styles.workspaceNotice}>{workspaceNotice}</div>}

            <nav className={styles.workspaceTabs}>
              <button className={`${styles.wsTab} ${workspaceTab === 'chat' ? styles.wsTabActive : ''}`} onClick={() => setWorkspaceTab('chat')}>Chat</button>
              <button className={`${styles.wsTab} ${workspaceTab === 'overview' ? styles.wsTabActive : ''}`} onClick={() => setWorkspaceTab('overview')}>Overview</button>
              <button className={`${styles.wsTab} ${workspaceTab === 'agent' ? styles.wsTabActive : ''}`} onClick={() => setWorkspaceTab('agent')}>
                Agent Inbox{pendingJobCount > 0 && <span className={styles.wsTabBadge}>{pendingJobCount}</span>}
              </button>
              <button className={`${styles.wsTab} ${workspaceTab === 'git' ? styles.wsTabActive : ''}`} onClick={() => setWorkspaceTab('git')}>Git</button>
            </nav>

            <div className={styles.workspaceBody}>
              {workspaceTab === 'chat' && (
                <ChatPanel
                  folderName={activeFolder.name}
                  folderPath={activeFolder.path}
                  memory={activeFolder.memory}
                  tasks={tasks}
                  jobs={jobs}
                  selectedTaskId={selectedTaskId}
                  aiReady={aiReady}
                  voiceReady={aiMode === 'byo'}
                  archetype={agentConfig?.archetype}
                  canSendAI={effectiveCanSendAI}
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

              {workspaceTab === 'overview' && (
                <div className={styles.tabScroll}>
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
                </div>
              )}

              {workspaceTab === 'agent' && (
                <div className={styles.tabScroll}>
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
                </div>
              )}

              {workspaceTab === 'git' && (
                <div className={styles.tabScroll}>
                  {gitStatus?.isRepo
                    ? <GitPanel
                        folderPath={activeFolder.path}
                        gitStatus={gitStatus}
                        onRefresh={() => refreshBriefing?.()}
                      />
                    : <div className={`${styles.gitStrip} ${styles.gitStripEmpty}`}><div className={`${styles.gitCard} ${styles.wide}`}><span className={styles.briefingLabel}>Git Status</span><p>This folder is not a git repository.</p></div><div className={styles.gitCard}><span className={styles.briefingLabel}>Suggestion</span><p>Run <code>git init</code> to unlock branch tracking, diffs, and commit workflow.</p></div></div>
                  }
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        folderName={activeFolder?.name}
        folderPath={activeFolder?.path}
        agentConfig={activeFolder ? agentConfig : null}
        onClose={() => setSettingsOpen(false)}
        onSaveApiKey={handleSaveApiKey}
        onSaveProfile={handleSaveProfile}
      />

      {upgradeReason && (
        <UpgradeModal
          reason={upgradeReason}
          user={user}
          onClose={() => setUpgradeReason(null)}
        />
      )}

      <FeedbackModal
        open={feedbackOpen}
        user={user}
        context={{ plan: usage.planTier, archetype: agentConfig?.archetype, hasFolder: Boolean(activeFolder), tab: workspaceTab }}
        onClose={() => setFeedbackOpen(false)}
      />
    </div>
  )
}
