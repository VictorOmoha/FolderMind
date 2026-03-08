import { useState, useRef, useEffect, useCallback } from 'react'
import type { TaskItem, ChatMessage } from '../../../src/vite-env'
import type { Message, PlanState, ActivityEntry, ApprovalRequest } from './chatPanelTypes'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatMessageList } from './ChatMessageList'
import { TaskSidebar } from './TaskSidebar'
import { ApprovalCard } from './ApprovalCard'
import { VoicePanel } from './VoicePanel'

interface Props {
  folderPath: string
  folderName: string
  memory: string
  tasks: TaskItem[]
  hasApiKey: boolean
  canSendAI?: boolean
  onMemoryUpdate: (memory: string) => void
  onRunTask: (task: TaskItem) => Promise<string | null>
  onAddTask: (text: string) => void
  onToggleTask: (task: TaskItem) => void
  onDeleteTask: (taskId: string) => void
  onAfterAICall?: () => void
  onUsageLimitHit?: () => void
}

export function ChatPanel({ folderPath, folderName, memory, tasks, hasApiKey, canSendAI = true, onMemoryUpdate, onRunTask, onAddTask, onToggleTask, onDeleteTask, onAfterAICall, onUsageLimitHit }: Props) {
  const [listening, setListening] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskText, setEditingTaskText] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [currentTool, setCurrentTool] = useState<{ name: string, args: unknown } | null>(null)
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(true)
  const [voiceAutoMode, setVoiceAutoMode] = useState(true)
  const [lastTranscript, setLastTranscript] = useState('')
  const recognitionRef = useRef<any>(null)
  const voiceAutoRestartRef = useRef(false)
  const voicePendingRestartRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, currentTool, activity])

  useEffect(() => {
    setMessages([])
    setHistoryLoaded(false)
    setSelectedTaskId(null)
    if (!folderPath) return
    window.foldermind.getChatHistory(folderPath)
      .then((history: ChatMessage[]) => {
        setMessages(history.map((msg) => ({ role: msg.role, content: msg.content })))
      })
      .finally(() => setHistoryLoaded(true))
  }, [folderPath])

  useEffect(() => {
    const unsubToken = window.foldermind.onToken((token) => setStreamingContent(prev => prev + token))
    const unsubToolCall = window.foldermind.onToolCall((data) => {
      setStreamingContent(prev => {
        if (prev) setMessages(m => [...m, { role: 'assistant', content: prev }])
        return ''
      })
      setCurrentTool(data)
    })
    const unsubToolResult = window.foldermind.onToolResult((data) => {
      setMessages(prev => [...prev, { role: 'tool', content: '', toolName: data.name, toolResult: data.result }])
      setCurrentTool(null)
    })
    const unsubMemory = window.foldermind.onMemoryUpdated((newMem) => onMemoryUpdate(newMem))
    const unsubPlan = window.foldermind.onPlan((data) => setPlan(data))
    const unsubActivity = window.foldermind.onActivity((data) => setActivity(prev => [...prev.slice(-24), data]))
    const unsubApproval = window.foldermind.onApprovalRequested((data) => setApprovalRequest(data))

    return () => { unsubToken(); unsubToolCall(); unsubToolResult(); unsubMemory(); unsubPlan(); unsubActivity(); unsubApproval() }
  }, [onMemoryUpdate])

  const stopVoiceLoop = useCallback(() => {
    voiceAutoRestartRef.current = false
    if (voicePendingRestartRef.current) {
      clearTimeout(voicePendingRestartRef.current)
      voicePendingRestartRef.current = null
    }
    if (recognitionRef.current && typeof recognitionRef.current.stop === 'function') {
      try { recognitionRef.current.stop() } catch {}
    }
    setListening(false)
    setVoiceBusy(false)
  }, [])

  const startVoiceCapture = useCallback(async () => {
    setVoiceError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone access is not available in this environment.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []
      setListening(true)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onerror = () => {
        setVoiceError('Microphone recording failed.')
        setListening(false)
        stream.getTracks().forEach(track => track.stop())
      }
      recorder.onstop = async () => {
        setListening(false)
        stream.getTracks().forEach(track => track.stop())
        if (chunks.length === 0) {
          setVoiceError('No audio was captured. Try again and speak clearly.')
          return
        }
        try {
          setVoiceBusy(true)
          const blob = new Blob(chunks, { type: mimeType })
          const arrayBuffer = await blob.arrayBuffer()
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
          const base64 = btoa(binary)
          const { jobId } = await window.foldermind.transcribeVoice(base64)
          for (let attempt = 0; attempt < 60; attempt++) {
            const result = await window.foldermind.getVoiceResult(jobId)
            if (result.status === 'completed') {
              const transcript = (result.text || '').trim()
              setInput(transcript)
              setLastTranscript(transcript)
              setVoiceBusy(false)
              if (transcript) {
                await handleSend(transcript)
              }
              return
            }
            if (result.status === 'failed') {
              setVoiceError(result.error || 'Voice transcription failed.')
              setVoiceBusy(false)
              return
            }
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          setVoiceError('Voice transcription timed out.')
        } catch (error: any) {
          setVoiceError(error?.message || 'Unable to transcribe microphone input.')
        } finally {
          setVoiceBusy(false)
          if (voiceAutoRestartRef.current) {
            voicePendingRestartRef.current = setTimeout(() => { void startVoiceCapture() }, 700)
          }
        }
      }
      recognitionRef.current = recorder
      recorder.start()
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 7000)
    } catch (error: any) {
      setListening(false)
      setVoiceError(error?.message || 'Unable to start microphone input.')
    }
  }, [])

  const toggleVoice = useCallback(async () => {
    setVoiceError(null)
    if (listening || voiceBusy) {
      stopVoiceLoop()
      return
    }
    voiceAutoRestartRef.current = voiceAutoMode
    await startVoiceCapture()
  }, [listening, voiceBusy, voiceAutoMode, startVoiceCapture, stopVoiceLoop])

  // Space-to-talk: press Space when no input is focused
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
      e.preventDefault()
      void toggleVoice()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggleVoice])

  const handleApproval = async (approved: boolean) => {
    if (!approvalRequest) return
    await window.foldermind.approve(approvalRequest.id, approved)
    setApprovalRequest(null)
  }

  const submitTask = () => {
    if (!taskInput.trim()) return
    onAddTask(taskInput.trim())
    setTaskInput('')
  }

  const startEditingTask = (task: TaskItem) => {
    setEditingTaskId(task.id)
    setEditingTaskText(task.text)
  }

  const cancelTaskEdit = () => {
    setEditingTaskId(null)
    setEditingTaskText('')
  }

  const commitTaskEdit = async (task: TaskItem) => {
    const nextText = editingTaskText.trim()
    if (!nextText) return
    await window.foldermind.updateTask(folderPath, task.id, { text: nextText })
    cancelTaskEdit()
    onMemoryUpdate(memory)
  }

  const resetRunPanels = () => {
    setStreamingContent('')
    setCurrentTool(null)
    setActivity([])
    setPlan(null)
  }

  const handleClearChat = async () => {
    await window.foldermind.clearChatHistory(folderPath)
    setMessages([])
    resetRunPanels()
  }

  const handleRunTask = async (task: TaskItem) => {
    if (loading || !hasApiKey) return
    if (!canSendAI) { onUsageLimitHit?.(); return }
    setSelectedTaskId(task.id)
    setMessages(prev => [...prev, { role: 'user', content: `Run task: ${task.text}` }])
    setLoading(true)
    resetRunPanels()
    try {
      const response = await onRunTask(task)
      if (response) {
        setMessages(prev => [...prev, { role: 'assistant', content: response }])
        onAfterAICall?.()
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Error while running task.' }])
    } finally {
      setLoading(false)
      setStreamingContent('')
    }
  }

  const speakText = useCallback(async (text: string) => {
    if (!voiceRepliesEnabled || !text.trim()) return
    try {
      const { jobId } = await window.foldermind.speakText(text)
      for (let attempt = 0; attempt < 60; attempt++) {
        const result = await window.foldermind.getSpeechResult(jobId)
        if (result.status === 'completed' && result.audioBase64) {
          const audio = new Audio(`data:${result.mimeType || 'audio/mpeg'};base64,${result.audioBase64}`)
          setVoiceSpeaking(true)
          audio.onended = () => setVoiceSpeaking(false)
          audio.onerror = () => setVoiceSpeaking(false)
          await audio.play()
          return
        }
        if (result.status === 'failed') {
          setVoiceError(result.error || 'Voice reply failed.')
          return
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      setVoiceError('Voice reply timed out.')
    } catch (error: any) {
      setVoiceError(error?.message || 'Unable to play voice reply.')
    }
  }, [voiceRepliesEnabled])

  const handleSend = async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? input).trim()
    if (!prompt || loading || !hasApiKey) return
    if (!canSendAI) { onUsageLimitHit?.(); return }

    const history = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role === 'tool' ? 'assistant' : msg.role, content: msg.content }))

    setMessages(prev => [...prev, { role: 'user', content: prompt }])
    setInput('')
    setLoading(true)
    resetRunPanels()

    try {
      const response = await window.foldermind.chat(folderPath, prompt, history, memory)
      setStreamingContent('')
      setCurrentTool(null)
      if (response) {
        setMessages(prev => [...prev, { role: 'assistant', content: response }])
        onAfterAICall?.()
        speakText(response)
      }
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${error?.message || 'Error while sending message.'}` }])
    } finally {
      setLoading(false)
      setStreamingContent('')
    }
  }

  const showEmptyState = messages.length === 0 && historyLoaded

  return (
    <div className="chat-shell">
      <div className="chat-panel">
        {showEmptyState
          ? <ChatEmptyState folderName={folderName} hasApiKey={hasApiKey} onPrompt={setInput} />
          : <ChatMessageList messages={messages} streamingContent={streamingContent} currentTool={currentTool} loading={loading} bottomRef={bottomRef} />}

        {!canSendAI && (
          <div className="usage-limit-banner">
            🚫 You've used all your AI calls this month.{' '}
            <button className="usage-limit-upgrade-btn" onClick={onUsageLimitHit}>Upgrade to Pro →</button>
          </div>
        )}

        <div className="chat-input-row">
          <textarea
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
            placeholder={hasApiKey ? 'Ask FolderMind anything… or press Space to talk' : 'Add your OpenAI API key in Settings to start chatting…'}
            rows={3}
            disabled={!hasApiKey || loading}
          />
          <button className="btn-send" onClick={() => void handleSend()} disabled={loading || !input.trim() || !hasApiKey || !canSendAI}>Send</button>
          <button className="btn-secondary" onClick={() => void handleClearChat()} disabled={loading || messages.length === 0}>Clear</button>
        </div>
      </div>

      <aside className="agent-sidebar">
        <TaskSidebar
          folderPath={folderPath}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          setSelectedTaskId={setSelectedTaskId}
          editingTaskId={editingTaskId}
          editingTaskText={editingTaskText}
          setEditingTaskText={setEditingTaskText}
          startEditingTask={startEditingTask}
          commitTaskEdit={commitTaskEdit}
          cancelTaskEdit={cancelTaskEdit}
          submitTask={submitTask}
          taskInput={taskInput}
          setTaskInput={setTaskInput}
          onToggleTask={onToggleTask}
          onDeleteTask={onDeleteTask}
          onRunTask={handleRunTask}
          hasApiKey={hasApiKey}
        />

        <VoicePanel
          listening={listening}
          transcribing={voiceBusy}
          speaking={voiceSpeaking}
          voiceRepliesEnabled={voiceRepliesEnabled}
          voiceAutoMode={voiceAutoMode}
          lastTranscript={lastTranscript}
          error={voiceError}
          hasApiKey={hasApiKey}
          onToggle={() => void toggleVoice()}
          onToggleReplies={() => setVoiceRepliesEnabled(prev => !prev)}
          onToggleAutoMode={() => setVoiceAutoMode(prev => !prev)}
        />

        <section className="agent-card">
          <h3>Plan</h3>
          {!plan ? <p className="muted">No active plan yet.</p> : <><p className="plan-goal">{plan.goal}</p><div className="plan-steps">{plan.steps.map(step => <div key={step.id} className={`plan-step ${step.status}`}><span className="plan-dot" /><span>{step.text}</span></div>)}</div></>}
        </section>

        <section className="agent-card">
          <h3>Activity</h3>
          {activity.length === 0 ? <p className="muted">No activity yet.</p> : <div className="activity-list">{activity.slice().reverse().map((entry, idx) => <div key={`${entry.ts}-${idx}`} className="activity-item"><span className={`activity-kind ${entry.kind}`}>{entry.kind}</span><span className="activity-message">{entry.message}</span></div>)}</div>}
        </section>

        <section className="agent-card"><h3>Memory</h3><pre className="memory-preview">{memory}</pre></section>

        {approvalRequest && <ApprovalCard approvalRequest={approvalRequest} onBlock={() => void handleApproval(false)} onApprove={() => void handleApproval(true)} />}
      </aside>
    </div>
  )
}
