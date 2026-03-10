import type { ChatMessageListProps } from './chatPanelTypes'
import styles from './ChatMessageList.module.css'

export function ChatMessageList({ messages, streamingContent, currentTool, loading, bottomRef }: ChatMessageListProps) {
  return (
    <div className={styles.container}>
      {messages.map((msg, i) => (
        <div key={i} className={`${styles.message} ${styles[msg.role] || ''}`}>
          {msg.role !== 'tool' && <span className={styles.role}>{msg.role === 'user' ? 'You' : '🧠 FolderMind'}</span>}
          {msg.role === 'tool'
            ? (
              <div className={styles.tool}>
                <span className={styles.toolBadge}>⚙️ {msg.toolName}</span>
                <pre className={styles.toolResult}>{msg.toolResult}</pre>
              </div>
            )
            : <p className={styles.content}>{msg.content}</p>}
        </div>
      ))}
      {streamingContent && (
        <div className={`${styles.message} ${styles.assistant}`}>
          <span className={styles.role}>🧠 FolderMind</span>
          <p className={styles.content}>{streamingContent}</p>
        </div>
      )}
      {currentTool && (
        <div className={styles.message}>
          <span className={`${styles.toolBadge} ${styles.active}`}>⚙️ Running {currentTool.name}...</span>
          <pre className={styles.toolArgs}>{JSON.stringify(currentTool.args, null, 2)}</pre>
        </div>
      )}
      {loading && !streamingContent && !currentTool && (
        <div className={`${styles.message} ${styles.assistant}`}>
          <span className={styles.role}>🧠 FolderMind</span>
          <p className={`${styles.content} ${styles.typing}`}>Thinking...</p>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
