# FolderMind 🗂️🧠

> Every folder, a co-worker.

FolderMind is a local-first desktop AI workspace that turns a folder into a persistent agent. It can understand the folder, remember context, manage tasks, inspect and edit files, run guarded commands, and help you move work forward over time.

## What works now

### Core workspace agent
- Smart folder creation with `.foldermind/agent.json`
- Folder archetypes:
  - general
  - codebase
  - research
  - content
  - operations
- GPT-4o-powered local desktop agent
- Streaming responses
- direct typed chat in the active workspace
- Plan + activity visibility
- Approval prompts for risky commands
- Approval prompts with diff previews for file changes

### Structured memory
- `.foldermind/memory/project.md`
- `.foldermind/memory/decisions.md`
- `.foldermind/memory/preferences.md`
- `.foldermind/memory/tasks.json`
- backward-compatible `.foldermind/memory.md` snapshot
- structured memory extraction from conversations

### Task system
- add / edit / toggle / delete tasks
- direct task execution
- task run history persisted in `tasks.json`
- automatic task completion on successful task execution
- run transparency with durations, files touched, commands, traces, plan snapshots, and activity logs

### Persistent chat
- per-folder chat history persisted in `.foldermind/memory/chat.json`
- direct chat in the workspace UI
- quick prompt chips for first-run guidance

### Proactive intelligence
- folder briefing on open/refresh
- recent file change summaries
- suggestions based on archetype, file activity, and memory
- decision/task highlights in the briefing

### Git-aware workflow
- repo detection
- branch detection
- staged / changed / untracked file counts
- ahead / behind info when available
- commit message suggestion

## Current architecture

Active app paths:
- `src/main/*` — Electron main process, IPC, agent runtime, folder intelligence
- `src/preload/*` — secure renderer bridge
- `src/renderer/src/*` — React desktop UI

Legacy duplicate files were moved out of the active source tree into `legacy-src/`.

## Setup

```bash
git clone https://github.com/VictorOmoha/FolderMind
cd FolderMind
npm install
# create .env with OPENAI_API_KEY=your_key
npm run dev
```

## Environment

Minimum local env:

```env
OPENAI_API_KEY=your_key_here
```

Optional Firebase envs exist in the codebase but are not yet fully wired into the active desktop flow.

## Stack

- Electron
- electron-vite
- React
- TypeScript
- OpenAI GPT-4o
- chokidar
- Firebase libraries present for future auth/sync work

## Product direction

FolderMind is being built toward:
- persistent folder agents
- safe autonomous execution
- task-centric workflows
- project memory as a moat
- proactive workspace intelligence
- eventually cloud sync and team workflows

## Not finished yet

These are still incomplete or partially wired:
- production-grade auth and billing flow in the active app
- real cloud sync UX
- true Whisper STT integration
- OpenAI TTS voice output
- collaborative/team handoff flows

## Recommended next steps

If continuing from here, the strongest next work would be:
- direct diff viewer for all file edits
- task-to-files-touched history panel
- auth/usage gating integration in the active app
- cloud sync for memory/tasks
- richer git diff summaries and commit execution flow

---

Built by Omoha Solutions
