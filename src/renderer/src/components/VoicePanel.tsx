import styles from './VoicePanel.module.css'

interface Props {
  listening: boolean
  transcribing: boolean
  speaking: boolean
  voiceRepliesEnabled: boolean
  voiceAutoMode: boolean
  lastTranscript: string
  error: string | null
  hasApiKey: boolean
  onToggle: () => void
  onToggleReplies: () => void
  onToggleAutoMode: () => void
}

type VoiceState = 'idle' | 'listening' | 'transcribing' | 'speaking'

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Tap mic · or press Space',
  listening: 'Listening…',
  transcribing: 'Transcribing…',
  speaking: 'Speaking…',
}

const STATE_ICON: Record<VoiceState, string> = {
  idle: '🎙️',
  listening: '⏹',
  transcribing: '⏳',
  speaking: '🔊',
}

export function VoicePanel({
  listening,
  transcribing,
  speaking,
  voiceRepliesEnabled,
  voiceAutoMode,
  lastTranscript,
  error,
  hasApiKey,
  onToggle,
  onToggleReplies,
  onToggleAutoMode,
}: Props) {
  const state: VoiceState = listening
    ? 'listening'
    : transcribing
    ? 'transcribing'
    : speaking
    ? 'speaking'
    : 'idle'

  return (
    <section className={`agent-card ${styles.panel}`}>
      <h3>Voice</h3>

      {/* ── Mic button ── */}
      <div className={styles.micWrap}>
        <button
          className={`${styles.micBtn} ${styles[state] || ''}`}
          onClick={onToggle}
          disabled={!hasApiKey || transcribing}
          aria-label={state === 'listening' ? 'Stop recording' : 'Start recording'}
          title={!hasApiKey ? 'Add your OpenAI API key to enable voice' : undefined}
        >
          <span className={styles.micIcon}>{STATE_ICON[state]}</span>
          {state === 'listening' && <span className={styles.micRing} />}
        </button>
        <span className={`${styles.stateLabel} ${styles[state] || ''}`}>{STATE_LABEL[state]}</span>
      </div>

      {/* ── Toggles ── */}
      <div className={styles.toggles}>
        <button
          className={`${styles.togglePill} ${voiceRepliesEnabled ? styles.on : ''}`}
          onClick={onToggleReplies}
          disabled={transcribing}
        >
          {voiceRepliesEnabled ? '🔊 Replies' : '🔇 Replies'}
        </button>
        <button
          className={`${styles.togglePill} ${voiceAutoMode ? styles.on : ''}`}
          onClick={onToggleAutoMode}
          disabled={listening || transcribing}
        >
          {voiceAutoMode ? '↺ Auto' : '○ Manual'}
        </button>
      </div>

      {/* ── Last transcript ── */}
      {lastTranscript && (
        <div className={styles.transcript}>
          <span className={styles.transcriptLabel}>Heard</span>
          <span className={styles.transcriptText}>"{lastTranscript}"</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && <div className={styles.error}>{error}</div>}

      {/* ── No API key hint ── */}
      {!hasApiKey && (
        <p className="muted" style={{ fontSize: '11px', marginTop: 4 }}>
          Add your OpenAI API key in Settings to enable voice.
        </p>
      )}
    </section>
  )
}
