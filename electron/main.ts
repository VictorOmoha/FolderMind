import { app, BrowserWindow, ipcMain, dialog } from 'electron'

// Fix Windows GPU cache permission issues
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import chokidar from 'chokidar'

let mainWindow: BrowserWindow | null = null
let activeWatcher: ReturnType<typeof chokidar.watch> | null = null

const AGENT_DIR = '.foldermind'

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'FolderMind',
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
}

// ── Seed an agent into a folder ──────────────────────────────────────────────
function seedAgent(folderPath: string, projectName: string) {
  const agentDir = join(folderPath, AGENT_DIR)
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })

  const agentConfig = join(agentDir, 'agent.json')
  if (!existsSync(agentConfig)) {
    writeFileSync(agentConfig, JSON.stringify({
      name: projectName,
      created: new Date().toISOString(),
      model: 'gpt-4o',
      tone: 'direct, practical, helpful',
      tools: ['read_files', 'write_file', 'summarize', 'analyze'],
    }, null, 2))
  }

  const memoryFile = join(agentDir, 'memory.md')
  if (!existsSync(memoryFile)) {
    writeFileSync(memoryFile, `# ${projectName} — Agent Memory\n\nCreated: ${new Date().toLocaleDateString()}\n\n## What I Know\n\n_Nothing yet. Start a conversation to build context._\n`)
  }
}

// ── Read all files in a folder for AI context ────────────────────────────────
function readFolderContext(folderPath: string): { name: string; content: string }[] {
  const files: { name: string; content: string }[] = []
  const ignored = new Set([AGENT_DIR, 'node_modules', '.git', '.DS_Store'])
  const textExts = new Set(['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yaml', '.yml'])

  try {
    const entries = readdirSync(folderPath)
    for (const entry of entries) {
      if (ignored.has(entry)) continue
      const fullPath = join(folderPath, entry)
      const stat = statSync(fullPath)
      if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase()
        if (textExts.has(ext) && stat.size < 500_000) {
          try {
            const content = readFileSync(fullPath, 'utf-8')
            files.push({ name: entry, content })
          } catch { /* skip unreadable */ }
        }
      }
    }
  } catch { /* folder may not exist */ }

  return files
}

// ── Watch active folder ───────────────────────────────────────────────────────
function watchFolder(folderPath: string) {
  if (activeWatcher) activeWatcher.close()
  activeWatcher = chokidar.watch(folderPath, {
    ignored: /(^|[/\\])\.(foldermind|git|DS_Store)/,
    persistent: true,
    ignoreInitial: true,
  })
  activeWatcher.on('all', (event, filePath) => {
    mainWindow?.webContents.send('folder:changed', { event, filePath })
  })
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

// Pick or create a smart folder
ipcMain.handle('folder:create', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose or Create a Smart Folder',
    buttonLabel: 'Make it Smart',
  })
  if (result.canceled || !result.filePaths.length) return null

  const folderPath = result.filePaths[0]
  const name = folderPath.split(/[\\/]/).pop() || 'Project'
  seedAgent(folderPath, name)
  watchFolder(folderPath)

  return {
    path: folderPath,
    name,
    agentConfig: JSON.parse(readFileSync(join(folderPath, AGENT_DIR, 'agent.json'), 'utf-8')),
    memory: readFileSync(join(folderPath, AGENT_DIR, 'memory.md'), 'utf-8'),
  }
})

// Open existing smart folder
ipcMain.handle('folder:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Open Smart Folder',
  })
  if (result.canceled || !result.filePaths.length) return null

  const folderPath = result.filePaths[0]
  const name = folderPath.split(/[\\/]/).pop() || 'Project'

  // Seed if not yet a smart folder
  seedAgent(folderPath, name)
  watchFolder(folderPath)

  return {
    path: folderPath,
    name,
    agentConfig: JSON.parse(readFileSync(join(folderPath, AGENT_DIR, 'agent.json'), 'utf-8')),
    memory: readFileSync(join(folderPath, AGENT_DIR, 'memory.md'), 'utf-8'),
  }
})

// Get folder file context for AI
ipcMain.handle('folder:context', (_e, folderPath: string) => {
  return readFolderContext(folderPath)
})

// Write a file into the active folder (AI can create files)
ipcMain.handle('folder:writeFile', (_e, folderPath: string, fileName: string, content: string) => {
  writeFileSync(join(folderPath, fileName), content, 'utf-8')
  return true
})

// Update memory.md after a session
ipcMain.handle('folder:updateMemory', (_e, folderPath: string, newMemory: string) => {
  writeFileSync(join(folderPath, AGENT_DIR, 'memory.md'), newMemory, 'utf-8')
  return true
})

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
