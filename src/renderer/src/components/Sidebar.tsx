import type { SmartFolder } from '../hooks/useFolder'
import { FolderMark, FolderIcon, ChatBubbleIcon } from './Icons'
import styles from './Sidebar.module.css'

interface Props {
  activeFolder: SmartFolder | null
  recentFolders: SmartFolder[]
  onCreateFolder: () => void
  onOpenFolder: () => void
  onSelectFolder: (folder: SmartFolder) => void
  onOpenSettings: () => void
  onSendFeedback: () => void
}

export function Sidebar({ activeFolder, recentFolders, onCreateFolder, onOpenFolder, onSelectFolder, onOpenSettings, onSendFeedback }: Props) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.logo}><FolderMark size={19} /> FolderMind</span>
      </div>

      <div className={styles.actions}>
        <button className="btn-primary" onClick={onCreateFolder}>+ New Smart Folder</button>
        <button className="btn-secondary" onClick={onOpenFolder}>Open Folder</button>
        <button className="btn-secondary" onClick={onOpenSettings}>Settings</button>
      </div>

      {recentFolders.length > 0 && (
        <div className={styles.section}>
          <span className={styles.label}>Recent</span>
          {recentFolders.map(folder => (
            <button
              key={folder.path}
              className={`${styles.folderItem} ${activeFolder?.path === folder.path ? styles.active : ''}`}
              onClick={() => onSelectFolder(folder)}
              title={folder.path}
            >
              <FolderIcon size={15} />
              <span className={styles.folderName}>{folder.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        {activeFolder ? (
          <div className={styles.activeFolder}>
            <span className={styles.label}>Active Folder</span>
            <span className={styles.activeName}>{activeFolder.name}</span>
            <span className={styles.activePath} title={activeFolder.path}>{activeFolder.path}</span>
          </div>
        ) : (
          <div className={styles.emptyHint}>
            Open a folder to activate memory, briefing, tasks, and agent tools.
          </div>
        )}
        <button className={styles.feedbackBtn} onClick={onSendFeedback}><ChatBubbleIcon size={13} /> Send feedback</button>
        <span className={styles.version}>v0.1.0 — Local-first v1</span>
      </div>
    </aside>
  )
}
