import { useCallback, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { AuthScreen } from './components/AuthScreen'
import { UpgradeModal } from './components/UpgradeModal'
import { useFolder } from './hooks/useFolder'
import { useAuth } from './hooks/useAuth'
import { useUsage } from './hooks/useUsage'
import type { SmartFolder } from './hooks/useFolder'
import './App.css'

export default function App() {
  const { user, authState, error, loginWithEmail, signupWithEmail, loginWithGoogle, logout } = useAuth()
  const { canCreateFolder, canSendAI, foldersRemaining, aiCallsRemaining, trackFolderCreated, trackAICall } = useUsage(user)
  const [upgradeReason, setUpgradeReason] = useState<'folders' | 'ai_calls' | null>(null)

  const {
    activeFolder,
    recentFolders,
    createFolder,
    openFolder,
    getContext,
    writeFile,
    updateMemory,
  } = useFolder(user)

  const handleSelectFolder = useCallback((_folder: SmartFolder) => {}, [])

  const handleCreateFolder = useCallback(async () => {
    if (!canCreateFolder) { setUpgradeReason('folders'); return }
    const folder = await createFolder()
    if (folder) trackFolderCreated()
  }, [canCreateFolder, createFolder, trackFolderCreated])

  const handleFileCreated = useCallback(async (name: string, content: string) => {
    await writeFile(name, content)
  }, [writeFile])

  const handleMemoryUpdate = useCallback(async (newMemory: string) => {
    await updateMemory(newMemory)
  }, [updateMemory])

  const handleAICall = useCallback(() => {
    if (!canSendAI) { setUpgradeReason('ai_calls'); return false }
    trackAICall()
    return true
  }, [canSendAI, trackAICall])

  const handleUpgrade = async () => {
    if (!user) return
    try {
      const res = await fetch('https://createcheckoutsession-n7hgfyuk2q-uc.a.run.app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, email: user.email, plan: 'pro' }),
      })
      const { url } = await res.json()
      if (url) window.open(url, '_blank')
    } catch (err) {
      console.error('Checkout failed:', err)
    }
    setUpgradeReason(null)
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (authState === 'loading') {
    return (
      <div className="splash">
        <div className="splash-inner">
          <span className="splash-icon">🗂️</span>
          <p>Loading FolderMind...</p>
        </div>
      </div>
    )
  }

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (authState === 'unauthenticated') {
    return (
      <AuthScreen
        onLogin={loginWithEmail}
        onSignup={signupWithEmail}
        onGoogle={loginWithGoogle}
        error={error}
      />
    )
  }

  // ── Main app ──────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {upgradeReason && (
        <UpgradeModal
          reason={upgradeReason}
          onClose={() => setUpgradeReason(null)}
          onUpgrade={handleUpgrade}
        />
      )}

      <Sidebar
        activeFolder={activeFolder}
        recentFolders={recentFolders}
        onCreateFolder={handleCreateFolder}
        onOpenFolder={openFolder}
        onSelectFolder={handleSelectFolder}
      />

      <main className="main">
        {!activeFolder ? (
          <div className="welcome">
            <div className="welcome-inner">
              <div className="welcome-user">
                <span>👤 {user?.email}</span>
                <button className="btn-ghost small" onClick={logout}>Sign out</button>
              </div>
              <h1>🗂️ FolderMind</h1>
              <p className="tagline">Every folder, a co-worker.</p>
              <p className="desc">
                Drop files into a folder. Ask questions. Get answers.<br />
                Your AI reads everything — no re-explaining required.
              </p>
              <div className="welcome-actions">
                <button className="btn-primary large" onClick={handleCreateFolder}>
                  + Create Smart Folder
                </button>
                <button className="btn-secondary large" onClick={openFolder}>
                  Open Existing Folder
                </button>
              </div>
              <p className="usage-hint">
                {foldersRemaining === Infinity
                  ? '✨ Pro — unlimited folders'
                  : `${foldersRemaining} folder${foldersRemaining !== 1 ? 's' : ''} remaining on free plan`}
                {' · '}
                {aiCallsRemaining === Infinity
                  ? 'unlimited AI calls'
                  : `${aiCallsRemaining} AI calls left this month`}
                {' · '}
                <button className="btn-link" onClick={() => setUpgradeReason('folders')}>Upgrade</button>
              </p>
            </div>
          </div>
        ) : (
          <div className="workspace">
            <div className="workspace-header">
              <div>
                <h2>{activeFolder.name}</h2>
                <span className="folder-path">{activeFolder.path}</span>
              </div>
              <div className="workspace-right">
                <span className="usage-pill">
                  {aiCallsRemaining === Infinity ? '∞' : aiCallsRemaining} calls left
                </span>
                <div className="workspace-badge">🧠 Agent Active</div>
                <button className="btn-ghost small" onClick={logout}>Sign out</button>
              </div>
            </div>

            <ChatPanel
              folderName={activeFolder.name}
              folderPath={activeFolder.path}
              memory={activeFolder.memory}
              onMemoryUpdate={handleMemoryUpdate}
              onFileCreated={handleFileCreated}
              getContext={getContext}
              onBeforeSend={handleAICall}
            />
          </div>
        )}
      </main>
    </div>
  )
}
