import { useState, useRef, useEffect } from 'react'
import type { AgentJob, TaskItem, ChatMessage } from '../../../../src/vite-env'
import type { Message } from './chatPanelTypes'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatMessageList } from './ChatMessageList'
import { TaskSidebar } from './TaskSidebar'
import { ApprovalCard } from './ApprovalCard'
import { VoicePanel } from './VoicePanel'
import { ArrowUpIcon } from './Icons'
import { useVoice } from '../hooks/useVoice'
import { useChatIPC } from '../hooks/useChatIPC'
import styles from './ChatPanel.module.css'

interface Props {
  folderPath: string
  folderName: string
  memory: string
  tasks: TaskItem[]
  jobs: AgentJob[]
  selectedTaskId: string | null
  aiReady: boolean
  /** Voice transcription currently requires a personal OpenAI key (BYO mode). */
  voiceReady?: boolean
  archetype?: string
  canSendAI?: boolean
  onRunTask: (task: TaskItem) => Promise<string | null>
  onAddTask: (text: string) => void
  onToggleTask: (task: TaskItem) => void
  onDeleteTask: (taskId: string) => void
  onSelectTask: (taskId: string) => void
  onSelectJob: (jobId: string) => void
  onAfterAICall?: () => void
  onUsageLimitHit?: () => void
}

export function ChatPanel({ folderPath, folderName, memory, tasks, jobs, selectedTaskId, aiReady, voiceReady = false, archetype, canSendAI = true, onRunTask, onAddTask, onToggleTask, onDeleteTask, onSelectTask, onSelectJob, onAfterAICall, onUsageLimitHit }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [taskInput, setTaskInput] = useState('')
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTaskText, setEditingTaskText] = useState('')
  const [loading, setLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(true)
  const [voiceAutoMode, setVoiceAutoMode] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const {
    streamingContent,
    setStreamingContent,
    currentTool,
    setCurrentTool,
    plan,
    activity,
    approvalRequest,
    setApprovalRequest,
    pendingMessages,
    setPendingMessages,
    resetRunPanels
  } = useChatIPC()

  const {
    listening,
    voiceBusy,
    voiceSpeaking,
    voiceError,
    lastTranscript,
    toggleVoice,
    speakText
  } = useVoice({
    voiceAutoMode,
    voiceRepliesEnabled,
    onTranscript: (transcript) => {
      setInput(transcript)
      if (transcript) handleSend(transcript)
    }
  })

  // Whenever pending messages come from the IPC hook (like tool results), append them to our local state
  useEffect(() => {
    if (pendingMessages.length > 0) {
      setMessages(prev => [...prev, ...pendingMessages])
      setPendingMessages([])
    }
  }, [pendingMessages, setPendingMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, currentTool, activity])

  useEffect(() => {
    setMessages([])
    setHistoryLoaded(false)
    if (!folderPath) return
    window.foldermind.getChatHistory(folderPath)
      .then((history: ChatMessage[]) => {
        setMessages(history.map((msg) => ({ role: msg.role, content: msg.content })))
      })
      .finally(() => setHistoryLoaded(true))
  }, [folderPath])

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
  }

  const handleClearChat = async () => {
    await window.foldermind.clearChatHistory(folderPath)
    setMessages([])
    resetRunPanels()
  }

  const handleRunTask = async (task: TaskItem) => {
    if (loading || !aiReady) return
    if (!canSendAI) { onUsageLimitHit?.(); return }
    onSelectTask(task.id)
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

  const handleSend = async (overridePrompt?: string) => {
    const prompt = (overridePrompt ?? input).trim()
    if (!prompt || loading || !aiReady) return
    if (!canSendAI) { onUsageLimitHit?.(); return }

    const history = messages
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({ role: msg.role === 'tool' ? 'assistant' : (msg.role as 'user' | 'assistant'), content: msg.content }))

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
    <div className={styles.shell}>
      <div className={styles.panel}>
        {showEmptyState
          ? <ChatEmptyState folderName={folderName} aiReady={aiReady} archetype={archetype} onPrompt={setInput} />
          : <ChatMessageList messages={messages} streamingContent={streamingContent} currentTool={currentTool} loading={loading} bottomRef={bottomRef} />}

        {!canSendAI && (
          <div className={styles.usageLimitBanner}>
            You've used all your AI calls this month.{' '}
            <button className={styles.usageLimitUpgradeBtn} onClick={onUsageLimitHit}>Upgrade to Pro →</button>
          </div>
        )}

        <div className={styles.composerWrap}>
          <div className={styles.composer}>
            <textarea
              className={styles.input}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() } }}
              placeholder={aiReady ? (voiceReady ? 'Ask FolderMind anything… or press Space to talk' : 'Ask FolderMind anything…') : 'Connect AI in Settings to start chatting…'}
              rows={2}
              disabled={!aiReady || loading}
            />
            <div className={styles.composerRow}>
              <div>
                {messages.length > 0 && (
                  <button className="btn-ghost" onClick={() => void handleClearChat()} disabled={loading}>Clear chat</button>
                )}
              </div>
              <div className={styles.composerActions}>
                <span className={styles.composerHint}>Enter to send · Shift+Enter for a new line</span>
                <button
                  className={styles.btnSend}
                  onClick={() => void handleSend()}
                  disabled={loading || !input.trim() || !aiReady || !canSendAI}
                  aria-label="Send message"
                  title="Send"
                ><ArrowUpIcon size={15} /></button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className={styles.sidebar}>
        <TaskSidebar
          folderPath={folderPath}
          tasks={tasks}
          jobs={jobs}
          selectedTaskId={selectedTaskId}
          setSelectedTaskId={onSelectTask}
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
          onSelectJob={onSelectJob}
          aiReady={aiReady}
        />

        <VoicePanel
          listening={listening}
          transcribing={voiceBusy}
          speaking={voiceSpeaking}
          voiceRepliesEnabled={voiceRepliesEnabled}
          voiceAutoMode={voiceAutoMode}
          lastTranscript={lastTranscript}
          error={voiceError}
          voiceReady={voiceReady}
          onToggle={() => void toggleVoice()}
          onToggleReplies={() => setVoiceRepliesEnabled(prev => !prev)}
          onToggleAutoMode={() => setVoiceAutoMode(prev => !prev)}
        />

        <section className={styles.card}>
          <h3>Plan</h3>
          {!plan ? <p className="muted">No active plan yet.</p> : <><p className={styles.planGoal}>{plan.goal}</p><div className={styles.planSteps}>{plan.steps.map(step => <div key={step.id} className={`${styles.planStep} ${styles[step.status] || ''}`}><span className={styles.planDot} /><span>{step.text}</span></div>)}</div></>}
        </section>

        <section className={styles.card}>
          <h3>Activity</h3>
          {activity.length === 0 ? <p className="muted">No activity yet.</p> : <div className={styles.activityList}>{activity.slice().reverse().map((entry, idx) => <div key={`${entry.ts}-${idx}`} className={styles.activityItem}><span className={`${styles.activityKind} ${styles[entry.kind] || ''}`}>{entry.kind}</span><span className={styles.activityMessage}>{entry.message}</span></div>)}</div>}
        </section>

        <section className={styles.card}><h3>Memory</h3><pre className={styles.memoryPreview}>{memory}</pre></section>

        {approvalRequest && <ApprovalCard approvalRequest={approvalRequest} onBlock={() => void handleApproval(false)} onApprove={() => void handleApproval(true)} />}
      </aside>
    </div>
  )
}
