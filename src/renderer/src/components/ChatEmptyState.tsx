import { FolderIcon } from './Icons'
import { quickPromptsFor } from './chatPanelUtils'

export function ChatEmptyState({ folderName, aiReady, archetype, onPrompt }: { folderName: string; aiReady: boolean; archetype?: string; onPrompt: (prompt: string) => void }) {
  const isCodebase = archetype === 'codebase'
  return (
    <div className="chat-empty">
      <div className="chat-empty-inner">
        <span className="chat-empty-badge"><FolderIcon size={13} /> {folderName}</span>
        <h2>What should we work on?</h2>
        <p>{isCodebase
          ? 'I can read the codebase, explain how it works, make surgical edits, and run guarded commands to verify them.'
          : 'I can inspect files, edit code, run guarded commands, and maintain memory.'}</p>
        {!aiReady && <p className="onboarding-note">AI isn't connected yet — add your OpenAI key in Settings, or sign in where hosted AI is enabled and it connects automatically.</p>}
        {aiReady && (
          <div className="quick-prompts">
            {quickPromptsFor(archetype).map((prompt) => (
              <button key={prompt} className="quick-prompt-chip" onClick={() => onPrompt(prompt)}>{prompt}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
