import { QUICK_PROMPTS } from './chatPanelUtils'

export function ChatEmptyState({ folderName, hasApiKey, onPrompt }: { folderName: string; hasApiKey: boolean; onPrompt: (prompt: string) => void }) {
  return (
    <div className="chat-empty">
      <p>👋 I'm active in <strong>{folderName}</strong>.</p>
      <p>I can inspect files, edit code, run guarded commands, and maintain memory.</p>
      {!hasApiKey && <p className="onboarding-note">Add your OpenAI API key in Settings to enable task execution and agent actions.</p>}
      {hasApiKey && <p className="onboarding-note">Try asking: “summarize this folder”, “inspect the project structure”, or “review recent changes”.</p>}
      {hasApiKey && (
        <div className="quick-prompts">
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt} className="quick-prompt-chip" onClick={() => onPrompt(prompt)}>{prompt}</button>
          ))}
        </div>
      )}
    </div>
  )
}
