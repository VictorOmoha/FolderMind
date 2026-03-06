import { useState, useRef, useEffect, useCallback } from 'react'
import { streamChat, type Message, type FileContext, type ToolCall } from '../lib/agent'

interface Props {
  folderName: string
  folderPath: string
  memory: string
  onMemoryUpdate: (memory: string) => void
  onFileCreated: (name: string, content: string) => void
  getContext: () => Promise<FileContext[]>
}

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

async function speakWithOpenAI(text: string): Promise<void> {
  const snippet = text.length > 250 ? text.slice(0, 247) + '...' : text
  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'tts-1', input: snippet, voice: 'nova', response_format: 'mp3' }),
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => URL.revokeObjectURL(url)
    audio.play()
  } catch { /* silent fail */ }
}

async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', blob, 'recording.webm')
  form.append('model', 'whisper-1')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  })
  const data = await res.json()
  return data.text ?? ''
}

export function ChatPanel({ folderName, folderPath, memory, onMemoryUpdate, onFileCreated, getContext }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [toolStatus, setToolStatus] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const messagesRef = useRef<Message[]>([])

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streaming])

  // ── Tool execution ────────────────────────────────────────────────────────
  const handleToolCall = useCallback(async (tool: ToolCall): Promise<string> => {
    setToolStatus(`⚙️ ${tool.name.replace(/_/g, ' ')}...`)

    try {
      switch (tool.name) {
        case 'create_file': {
          await onFileCreated(tool.args.filename, tool.args.content)
          return `✅ Created file: ${tool.args.filename}`
        }

        case 'run_command': {
          const result = await (window as unknown as { foldermind: { runCommand: (p: string, c: string) => Promise<string> } })
            .foldermind.runCommand(folderPath, tool.args.command)
          return result
        }

        case 'open_in_explorer': {
          await (window as unknown as { foldermind: { openInExplorer: (p: string, t: string) => Promise<void> } })
            .foldermind.openInExplorer(folderPath, tool.args.target)
          return `✅ Opened ${tool.args.target} in Explorer`
        }

        case 'search_web': {
          const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(tool.args.query)}&format=json&no_html=1`)
          const data = await res.json()
          return data.AbstractText || data.RelatedTopics?.[0]?.Text || 'No results found.'
        }

        case 'analyze_data': {
          const files = await getContext()
          const file = files.find(f => f.name === tool.args.filename)
          if (!file) return `File ${tool.args.filename} not found`
          return `Data loaded (${file.content.split('\n').length} rows). Analysis: ${tool.args.question}`
        }

        default:
          return 'Tool not implemented'
      }
    } catch (e) {
      return `Error: ${e}`
    } finally {
      setToolStatus('')
    }
  }, [folderPath, getContext, onFileCreated])

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setStreaming('')

    try {
      const files = await getContext()
      const history = [...messagesRef.current, userMsg]
      let streamedText = ''

      const fullResponse = await streamChat(
        history,
        folderName,
        memory,
        files,
        (token) => {
          streamedText += token
          setStreaming(streamedText)
        },
        handleToolCall,
      )

      setStreaming('')
      setMessages(prev => [...prev, { role: 'assistant', content: fullResponse }])

      if (voiceEnabled) speakWithOpenAI(fullResponse)

      // Memory update every 6 messages
      if (history.length % 6 === 0) {
        streamChat(
          [{ role: 'user', content: `Update project memory concisely. Current:\n${memory}\n\nReturn only the updated memory.md content.` }],
          folderName, memory, [],
          () => {},
          async () => ''
        ).then(onMemoryUpdate)
      }
    } catch (err) {
      setStreaming('')
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${err}` }])
    } finally {
      setLoading(false)
    }
  }, [loading, folderName, memory, getContext, handleToolCall, onMemoryUpdate, voiceEnabled])

  // ── Mic ───────────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      console.log('[FolderMind] Requesting mic...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[FolderMind] Mic granted, tracks:', stream.getAudioTracks().length)

      // Pick best supported format
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg'

      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = e => {
        console.log('[FolderMind] Audio chunk:', e.data.size, 'bytes')
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setTranscribing(true)
        try {
          const blob = new Blob(chunksRef.current, { type: mimeType })
          // Show blob size so we know if audio was captured
          setMessages(prev => [...prev, { role: 'assistant', content: `🎙️ Audio captured: ${blob.size} bytes — transcribing...` }])

          if (blob.size < 1000) {
            setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Audio too small — did you speak? Try holding the button longer.' }])
            setTranscribing(false)
            return
          }

          const transcript = await transcribeAudio(blob)
          // Remove the "transcribing" message and replace with actual transcript
          setMessages(prev => prev.filter(m => !m.content.startsWith('🎙️ Audio captured')))

          if (transcript.trim()) {
            send(transcript)
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: "🎙️ Whisper returned empty — speak clearly and try again." }])
          }
        } catch (e) {
          setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Transcription error: ${e}` }])
        }
        setTranscribing(false)
      }

      recorder.start(250) // collect chunks every 250ms
      mediaRecorderRef.current = recorder
      setRecording(true)
    } catch (e) {
      console.error('[FolderMind] Mic error:', e)
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Mic error: ${e}. Make sure no other app is using the mic.` }])
    }
  }, [send])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    setRecording(false)
  }, [])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>👋 I've read everything in <strong>{folderName}</strong>.</p>
            <p>Ask questions, request files, run commands — I've got you.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <span className="message-role">{msg.role === 'user' ? 'You' : '🧠 FolderMind'}</span>
            <p className="message-content">{msg.content}</p>
          </div>
        ))}
        {streaming && (
          <div className="message assistant">
            <span className="message-role">🧠 FolderMind</span>
            <p className="message-content">{streaming}<span className="cursor">▋</span></p>
          </div>
        )}
        {toolStatus && (
          <div className="tool-status">{toolStatus}</div>
        )}
        {transcribing && (
          <div className="tool-status">🎙️ Transcribing...</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="debug-bar">
        <button style={{fontSize:'11px',background:'#222',border:'1px solid #444',color:'#aaa',padding:'4px 10px',borderRadius:'6px',cursor:'pointer'}}
          onClick={async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (window as any).foldermind.testMic()
            setMessages(prev => [...prev, { role: 'assistant', content: `🔬 Mic test: ${JSON.stringify(result)}` }])
          }}>
          Test Mic
        </button>
      </div>
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything, or say 'create a tracker' / 'run a script'..."
          rows={2}
          disabled={loading}
        />
        <button
          className={`btn-voice ${recording ? 'active' : ''}`}
          onClick={recording ? stopRecording : startRecording}
          title={recording ? 'Stop recording' : 'Speak'}
          disabled={transcribing}
        >
          {recording ? '🔴' : transcribing ? '⏳' : '🎙️'}
        </button>
        <button
          className={`btn-speaker ${voiceEnabled ? 'active' : ''}`}
          onClick={() => setVoiceEnabled(v => !v)}
          title={voiceEnabled ? 'Mute voice' : 'Unmute voice'}
        >
          {voiceEnabled ? '🔊' : '🔇'}
        </button>
        <button className="btn-send" onClick={() => send(input)} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  )
}
