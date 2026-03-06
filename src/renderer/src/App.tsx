import { useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { AuthScreen } from './components/AuthScreen'
import { useFolder } from './hooks/useFolder'
import { useAuth } from './hooks/useAuth'
import type { SmartFolder } from './hooks/useFolder'
import './App.css'

export default function App() {
  const { user, authState, error, loginWithEmail, signupWithEmail, loginWithGoogle, logout } = useAuth()

  const {
    activeFolder,
    recentFolders,
    createFolder,
    openFolder,
    getContext,
    writeFile,
    updateMemory,
  } = useFolder(user)

  const handleSelectFolder = useCallback((_folder: SmartFolder) => {
    // Re-open from path
  }, [])

  const handleFileCreated = useCallback(async (name: string, content: string) => {
    await writeFile(name, content)
  }, [writeFile])

  const handleMemoryUpdate = useCallback(async (newMemory: string) => {
    await updateMemory(newMemory)
  }, [updateMemory])

  // ── Loading state ─────────────────────────────────────────────────────────
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
      <Sidebar
        activeFolder={activeFolder}
        recentFolders={recentFolders}
        onCreateFolder={createFolder}
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
                <button className="btn-primary large" onClick={createFolder}>
                  + Create Smart Folder
                </button>
                <button className="btn-secondary large" onClick={openFolder}>
                  Open Existing Folder
                </button>
              </div>
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
            />
          </div>
        )}
      </main>
    </div>
  )
}
