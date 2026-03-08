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

function getState(p: Props): VoiceState {
  if (p.listening) return 'listening'
  if (p.transcribing) return 'speaking' === p.speaking as any ? 'speaking' : 'transcribing'
  if (p.speaking) return 'speaking'
  return 'idle'
}

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
    <section className="agent-card voice-panel">
      <h3>Voice</h3>

      {/* ── Mic button ── */}
      <div className="voice-mic-wrap">
        <button
          className={`voice-mic-btn ${state}`}
          onClick={onToggle}
          disabled={!hasApiKey || transcribing}
          aria-label={state === 'listening' ? 'Stop recording' : 'Start recording'}
          title={!hasApiKey ? 'Add your OpenAI API key to enable voice' : undefined}
        >
          <span className="voice-mic-icon">{STATE_ICON[state]}</span>
          {state === 'listening' && <span className="voice-mic-ring" />}
        </button>
        <span className={`voice-state-label ${state}`}>{STATE_LABEL[state]}</span>
      </div>

      {/* ── Toggles ── */}
      <div className="voice-toggles">
        <button
          className={`voice-toggle-pill ${voiceRepliesEnabled ? 'on' : 'off'}`}
          onClick={onToggleReplies}
          disabled={transcribing}
        >
          {voiceRepliesEnabled ? '🔊 Replies' : '🔇 Replies'}
        </button>
        <button
          className={`voice-toggle-pill ${voiceAutoMode ? 'on' : 'off'}`}
          onClick={onToggleAutoMode}
          disabled={listening || transcribing}
        >
          {voiceAutoMode ? '↺ Auto' : '○ Manual'}
        </button>
      </div>

      {/* ── Last transcript ── */}
      {lastTranscript && (
        <div className="voice-transcript">
          <span className="voice-transcript-label">Heard</span>
          <span className="voice-transcript-text">"{lastTranscript}"</span>
        </div>
      )}

      {/* ── Error ── */}
      {error && <div className="voice-error">{error}</div>}

      {/* ── No API key hint ── */}
      {!hasApiKey && (
        <p className="muted" style={{ fontSize: '11px', marginTop: 4 }}>
          Add your OpenAI API key in Settings to enable voice.
        </p>
      )}
    </section>
  )
}
