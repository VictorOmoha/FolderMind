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

Optional Firebase envs exist in the codebase for auth/sync.

## AI access model (hybrid)

FolderMind resolves LLM access centrally ([src/main/llmClient.ts](src/main/llmClient.ts)). Tools (file writes, commands) always run locally; only inference is ever remote.

- **BYO mode** — the user has a personal OpenAI key (Settings or `OPENAI_API_KEY`). Calls go straight to OpenAI. Free, unlimited, key stays on their machine.
- **Hosted mode** — no personal key but signed in. Calls route through the `chatGateway` Cloud Function, which verifies the Firebase token, enforces the plan's monthly quota, calls OpenAI with the **server** key, and meters usage. This is what makes billing enforceable.

### Deploying the hosted gateway

```bash
cd functions
cp .env.example .env        # set the SERVER OpenAI key + Stripe keys
npm install && npm run build
firebase deploy --only functions
```

Then set `FOLDERMIND_GATEWAY_URL` in the desktop app's `.env` to the deployed
`chatGateway` URL (shown after deploy). Leave it empty to run BYO-only.

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
- real cloud sync UX
- true Whisper STT integration
- OpenAI TTS voice output
- collaborative/team handoff flows

### ⚠️ Billing / paid tiers are NOT enforceable yet

The Free/Pro/Business plan UI exists, but there is **no working billing or metering** behind it:

- Usage counters live in the renderer and are client-writable — the limits are advisory UI only.
- AI calls use **the user's own OpenAI key** (main process), so there is no server-side cost to meter or gate.
- The Stripe checkout Cloud Function is now authenticated and sets the correct plan tier, but its only caller is a plain `<a href>` GET link in `landing/index.html`, which never matched the POST endpoint — so the purchase flow is not wired end to end.

Making the paywall real requires proxying AI calls through an authenticated Cloud Function (so the server holds the key and can meter usage) and wiring an authenticated checkout call from a signed-in web context. Until then, treat the plan tiers as non-functional. `firestore.rules` has been hardened so a client can no longer self-assign a paid tier.

## Recommended next steps

If continuing from here, the strongest next work would be:
- direct diff viewer for all file edits
- task-to-files-touched history panel
- auth/usage gating integration in the active app
- cloud sync for memory/tasks
- richer git diff summaries and commit execution flow

---

Built by Omoha Solutions
