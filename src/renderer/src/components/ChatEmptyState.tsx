import { quickPromptsFor } from './chatPanelUtils'

export function ChatEmptyState({ folderName, hasApiKey, archetype, onPrompt }: { folderName: string; hasApiKey: boolean; archetype?: string; onPrompt: (prompt: string) => void }) {
  const isCodebase = archetype === 'codebase'
  return (
    <div className="chat-empty">
      <p>👋 I'm active in <strong>{folderName}</strong>.</p>
      <p>{isCodebase
        ? 'I can read the codebase, explain how it works, make surgical edits, and run guarded commands to verify them.'
        : 'I can inspect files, edit code, run guarded commands, and maintain memory.'}</p>
      {!hasApiKey && <p className="onboarding-note">Add your OpenAI API key in Settings to enable task execution and agent actions.</p>}
      {hasApiKey && (
        <div className="quick-prompts">
          {quickPromptsFor(archetype).map((prompt) => (
            <button key={prompt} className="quick-prompt-chip" onClick={() => onPrompt(prompt)}>{prompt}</button>
          ))}
        </div>
      )}
    </div>
  )
}
