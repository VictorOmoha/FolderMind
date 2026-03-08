import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  toolArgs?: any
  toolResult?: string
}

interface Props {
  folderPath: string
  folderName: string
  memory: string
  onMemoryUpdate: (memory: string) => void
}

export function ChatPanel({ folderPath, folderName, memory, onMemoryUpdate }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [currentTool, setCurrentTool] = useState<{name: string, args: any} | null>(null)
  
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, currentTool])

  useEffect(() => {
    const unsubToken = window.foldermind.onToken((token) => {
      setStreamingContent(prev => prev + token)
    })
    
    const unsubToolCall = window.foldermind.onToolCall((data) => {
      if (streamingContent) {
        setMessages(prev => [...prev, { role: 'assistant', content: streamingContent }])
        setStreamingContent('')
      }
      setCurrentTool(data)
    })
    
    const unsubToolResult = window.foldermind.onToolResult((data) => {
      setMessages(prev => [
        ...prev, 
        { role: 'tool', content: '', toolName: data.name, toolResult: data.result }
      ])
      setCurrentTool(null)
    })

    const unsubMemory = window.foldermind.onMemoryUpdated((newMem) => {
      onMemoryUpdate(newMem)
    })

    return () => {
      unsubToken()
      unsubToolCall()
      unsubToolResult()
      unsubMemory()
    }
  }, [streamingContent, onMemoryUpdate])

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text }
    const history = [...messages]
    
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setStreamingContent('')

    try {
      const cleanHistory = history.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
        role: m.role,
        content: m.content
      }))
      
      const finalResponse = await window.foldermind.chat(folderPath, text, cleanHistory, memory)
      
      setMessages(prev => [...prev, { role: 'assistant', content: finalResponse }])
      setStreamingContent('')
      setCurrentTool(null)
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error reaching AI. Check your API key.' }])
    } finally {
      setLoading(false)
      setStreamingContent('')
    }
  }, [loading, messages, folderPath, memory])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>👋 I'm active in <strong>{folderName}</strong>.</p>
            <p>I can read your files, write code, run commands, and maintain context.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role !== 'tool' && <span className="message-role">{msg.role === 'user' ? 'You' : '🧠 FolderMind'}</span>}
            
            {msg.role === 'tool' ? (
              <div className="message-tool" style={{fontSize: '0.8em', background: '#333', padding: '10px', borderRadius: '5px', marginTop: '5px'}}>
                <span className="tool-badge" style={{color: '#a8c7fa', fontWeight: 'bold'}}>⚙️ {msg.toolName}</span>
                <pre className="tool-result" style={{maxHeight: '150px', overflowY: 'auto', margin: '5px 0 0', whiteSpace: 'pre-wrap', color: '#999'}}>{msg.toolResult}</pre>
              </div>
            ) : (
              <p className="message-content" style={{whiteSpace: 'pre-wrap'}}>{msg.content}</p>
            )}
          </div>
        ))}
        
        {streamingContent && (
          <div className="message assistant">
            <span className="message-role">🧠 FolderMind</span>
            <p className="message-content" style={{whiteSpace: 'pre-wrap'}}>{streamingContent}</p>
          </div>
        )}
        
        {currentTool && (
          <div className="message tool-active" style={{fontSize: '0.8em', background: '#333', padding: '10px', borderRadius: '5px', marginTop: '5px'}}>
            <span className="tool-badge active" style={{color: '#fbbc04', fontWeight: 'bold'}}>⚙️ Running {currentTool.name}...</span>
            <pre className="tool-args" style={{margin: '5px 0 0', color: '#999'}}>{JSON.stringify(currentTool.args, null, 2)}</pre>
          </div>
        )}
        
        {loading && !streamingContent && !currentTool && (
          <div className="message assistant">
            <span className="message-role">🧠 FolderMind</span>
            <p className="message-content typing">Thinking...</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask me to read files, write code, run commands..."
          rows={2}
          disabled={loading}
        />
        <button
          className="btn-send"
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
