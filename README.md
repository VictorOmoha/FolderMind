# FolderMind 🗂️🧠

> Every folder, a co-worker.

FolderMind is a desktop AI assistant that turns any folder into a smart agent. Drop files in, ask questions, give commands — your AI reads everything and gets to work.

## Features

- **Smart Folders** — creates `.foldermind/` agent config + memory on any folder
- **GPT-4o chat** — reads all files in your folder as context
- **Streaming responses** — token-by-token output, no waiting
- **Function calling** — agent can create files, run PowerShell commands, open Explorer, search the web, analyze CSV data
- **Voice input** — Whisper STT (real mic, not browser API)
- **Voice output** — OpenAI Nova TTS
- **Memory** — agent remembers key context across sessions
- **File watcher** — context updates live as you add/change files

## Setup

```bash
git clone https://github.com/VictorOmoha/FolderMind
cd FolderMind
npm install
cp .env.example .env
# Add your OpenAI API key to .env
npm run dev
```

## Stack

- **Electron** + **electron-vite**
- **React** + **TypeScript** + **Vite**
- **OpenAI GPT-4o** (chat + function calling)
- **OpenAI Whisper** (voice input)
- **OpenAI TTS Nova** (voice output)
- **chokidar** (file watching)
- **Firebase** (coming — cloud sync + auth)
- **Stripe** (coming — SaaS tiers)

## Roadmap

- [ ] Firebase Auth (Google sign-in)
- [ ] Firestore cloud sync
- [ ] Stripe Free/Pro/Business tiers
- [ ] Windows `.exe` installer
- [ ] Mac `.dmg` build
- [ ] Landing page

---

Built by [Omoha Solutions](https://omohaSolutions.com)
