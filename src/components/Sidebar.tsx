import type { SmartFolder } from '../hooks/useFolder'

interface Props {
  activeFolder: SmartFolder | null
  recentFolders: SmartFolder[]
  onCreateFolder: () => void
  onOpenFolder: () => void
  onSelectFolder: (folder: SmartFolder) => void
}

export function Sidebar({ activeFolder, recentFolders, onCreateFolder, onOpenFolder, onSelectFolder }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="logo">🗂️ FolderMind</span>
      </div>

      <div className="sidebar-actions">
        <button className="btn-primary" onClick={onCreateFolder}>+ New Smart Folder</button>
        <button className="btn-secondary" onClick={onOpenFolder}>Open Folder</button>
      </div>

      {recentFolders.length > 0 && (
        <div className="sidebar-section">
          <span className="sidebar-label">Recent</span>
          {recentFolders.map(folder => (
            <button
              key={folder.path}
              className={`folder-item ${activeFolder?.path === folder.path ? 'active' : ''}`}
              onClick={() => onSelectFolder(folder)}
              title={folder.path}
            >
              <span className="folder-icon">📁</span>
              <span className="folder-name">{folder.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-footer">
        <span className="version">v0.1.0 — MVP</span>
      </div>
    </aside>
  )
}
