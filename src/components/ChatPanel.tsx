import { useState, useRef, useEffect, useCallback } from 'react'
import { chat, parseFileCreations, stripFileCreations, type Message, type FileContext } from '../lib/agent'

interface Props {
  folderName: string
  memory: string
  onMemoryUpdate: (memory: string) => void
  onFileCreated: (name: string, content: string) => void
  getContext: () => Promise<FileContext[]>
}

export function ChatPanel({ folderName, memory, onMemoryUpdate, onFileCreated, getContext }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const files = await getContext()
      const history = [...messages, userMsg]
      const response = await chat(history, folderName, memory, files)

      // Handle file creations
      const newFiles = parseFileCreations(response)
      for (const file of newFiles) {
        await onFileCreated(file.filename, file.content)
      }

      const displayResponse = stripFileCreations(response)
      const assistantMsg: Message = { role: 'assistant', content: displayResponse }
      setMessages(prev => [...prev, assistantMsg])

      // Update memory with key context (every 5 messages)
      if (history.length % 5 === 0) {
        const memoryUpdate = await chat(
          [{ role: 'user', content: `Based on our conversation so far, update the project memory. Current memory:\n${memory}\n\nKeep it concise — key decisions, context, and facts only. Return only the updated memory.md content.` }],
          folderName,
          memory,
          []
        )
        onMemoryUpdate(memoryUpdate)
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error reaching AI. Check your API key in .env' }])
    } finally {
      setLoading(false)
    }
  }, [loading, messages, folderName, memory, getContext, onFileCreated, onMemoryUpdate])

  const toggleVoice = useCallback(() => {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      alert('Voice not supported in this browser.')
      return
    }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      send(transcript)
      setListening(false)
    }
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }, [listening, send])

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
            <p>👋 I've read everything in <strong>{folderName}</strong>.</p>
            <p>Ask me anything about your files, or tell me what to build.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <span className="message-role">{msg.role === 'user' ? 'You' : '🧠 FolderMind'}</span>
            <p className="message-content">{msg.content}</p>
          </div>
        ))}
        {loading && (
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
          placeholder="Ask about your files, or tell me what to create..."
          rows={2}
          disabled={loading}
        />
        <button
          className={`btn-voice ${listening ? 'active' : ''}`}
          onClick={toggleVoice}
          title="Voice input"
        >
          {listening ? '🔴' : '🎙️'}
        </button>
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
