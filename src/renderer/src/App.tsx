import { useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { useFolder } from './hooks/useFolder'
import type { SmartFolder } from './hooks/useFolder'
import './App.css'

export default function App() {
  const {
    activeFolder,
    recentFolders,
    createFolder,
    openFolder,
    getContext,
    writeFile,
    updateMemory,
  } = useFolder()

  const handleSelectFolder = useCallback((folder: SmartFolder) => {
    // Re-open from path — in future, persist recent folders to localStorage
    console.log('Select folder:', folder.path)
  }, [])

  const handleFileCreated = useCallback(async (name: string, content: string) => {
    await writeFile(name, content)
  }, [writeFile])

  const handleMemoryUpdate = useCallback(async (newMemory: string) => {
    await updateMemory(newMemory)
  }, [updateMemory])

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
              <div className="workspace-badge">🧠 Agent Active</div>
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
