import type { ChatMessageListProps } from './chatPanelTypes'

export function ChatMessageList({ messages, streamingContent, currentTool, loading, bottomRef }: ChatMessageListProps) {
  return (
    <div className="chat-messages">
      {messages.map((msg, i) => (
        <div key={i} className={`message ${msg.role}`}>
          {msg.role !== 'tool' && <span className="message-role">{msg.role === 'user' ? 'You' : '🧠 FolderMind'}</span>}
          {msg.role === 'tool'
            ? <div className="message-tool"><span className="tool-badge">⚙️ {msg.toolName}</span><pre className="tool-result">{msg.toolResult}</pre></div>
            : <p className="message-content">{msg.content}</p>}
        </div>
      ))}
      {streamingContent && <div className="message assistant"><span className="message-role">🧠 FolderMind</span><p className="message-content">{streamingContent}</p></div>}
      {currentTool && <div className="message tool-active-card"><span className="tool-badge active">⚙️ Running {currentTool.name}...</span><pre className="tool-args">{JSON.stringify(currentTool.args, null, 2)}</pre></div>}
      {loading && !streamingContent && !currentTool && <div className="message assistant"><span className="message-role">🧠 FolderMind</span><p className="message-content typing">Thinking...</p></div>}
      <div ref={bottomRef} />
    </div>
  )
}
