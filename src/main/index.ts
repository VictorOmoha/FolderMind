import { app, BrowserWindow, ipcMain, dialog, shell, session } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

app.commandLine.appendSwitch('no-sandbox')

const execAsync = promisify(exec)
import chokidar from 'chokidar'

let mainWindow: BrowserWindow | null = null
let activeWatcher: ReturnType<typeof chokidar.watch> | null = null

const AGENT_DIR = '.foldermind'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'FolderMind',
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Seed agent files ──────────────────────────────────────────────────────────
function seedAgent(folderPath: string, projectName: string): void {
  const agentDir = join(folderPath, AGENT_DIR)
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })

  const agentConfig = join(agentDir, 'agent.json')
  if (!existsSync(agentConfig)) {
    writeFileSync(agentConfig, JSON.stringify({
      name: projectName,
      created: new Date().toISOString(),
      model: 'gpt-4o',
      tone: 'direct, practical, helpful',
    }, null, 2))
  }

  const memoryFile = join(agentDir, 'memory.md')
  if (!existsSync(memoryFile)) {
    writeFileSync(memoryFile, `# ${projectName} — Agent Memory\n\nCreated: ${new Date().toLocaleDateString()}\n\n## What I Know\n\n_Nothing yet. Start a conversation._\n`)
  }
}

// ── Read files for AI context ─────────────────────────────────────────────────
function readFolderContext(folderPath: string): { name: string; content: string }[] {
  const files: { name: string; content: string }[] = []
  const ignored = new Set([AGENT_DIR, 'node_modules', '.git'])
  const textExts = new Set(['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yaml', '.yml'])
  try {
    for (const entry of readdirSync(folderPath)) {
      if (ignored.has(entry)) continue
      const fullPath = join(folderPath, entry)
      const stat = statSync(fullPath)
      if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.')).toLowerCase()
        if (textExts.has(ext) && stat.size < 500_000) {
          try { files.push({ name: entry, content: readFileSync(fullPath, 'utf-8') }) } catch { /* skip */ }
        }
      }
    }
  } catch { /* skip */ }
  return files
}

function watchFolder(folderPath: string): void {
  if (activeWatcher) activeWatcher.close()
  activeWatcher = chokidar.watch(folderPath, {
    ignored: /(^|[/\\])\.(foldermind|git)/,
    persistent: true,
    ignoreInitial: true,
  })
  activeWatcher.on('all', (_event, filePath) => {
    mainWindow?.webContents.send('folder:changed', { event: _event, filePath })
  })
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle('folder:create', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
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
    path: folderPath, name,
    agentConfig: JSON.parse(readFileSync(join(folderPath, AGENT_DIR, 'agent.json'), 'utf-8')),
    memory: readFileSync(join(folderPath, AGENT_DIR, 'memory.md'), 'utf-8'),
  }
})

ipcMain.handle('folder:open', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Smart Folder',
  })
  if (result.canceled || !result.filePaths.length) return null
  const folderPath = result.filePaths[0]
  const name = folderPath.split(/[\\/]/).pop() || 'Project'
  seedAgent(folderPath, name)
  watchFolder(folderPath)
  return {
    path: folderPath, name,
    agentConfig: JSON.parse(readFileSync(join(folderPath, AGENT_DIR, 'agent.json'), 'utf-8')),
    memory: readFileSync(join(folderPath, AGENT_DIR, 'memory.md'), 'utf-8'),
  }
})

ipcMain.handle('folder:context', (_e, folderPath: string) => readFolderContext(folderPath))
ipcMain.handle('folder:writeFile', (_e, folderPath: string, fileName: string, content: string) => {
  writeFileSync(join(folderPath, fileName), content, 'utf-8')
  return true
})
ipcMain.handle('folder:updateMemory', (_e, folderPath: string, newMemory: string) => {
  writeFileSync(join(folderPath, AGENT_DIR, 'memory.md'), newMemory, 'utf-8')
  return true
})

ipcMain.handle('debug:testMic', async (_e) => {
  try {
    const sources = await (BrowserWindow.getAllWindows()[0]?.webContents as unknown as { executeJavaScript: (s: string) => Promise<unknown> })
      .executeJavaScript(`
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(s => ({ ok: true, tracks: s.getAudioTracks().length }))
          .catch(e => ({ ok: false, error: e.message }))
      `)
    return sources
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

ipcMain.handle('folder:runCommand', async (_e, folderPath: string, command: string) => {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: folderPath, shell: 'powershell.exe', timeout: 30000 })
    return stdout || stderr || '✅ Command completed.'
  } catch (err: unknown) {
    return `Error: ${(err as Error).message}`
  }
})

ipcMain.handle('folder:openInExplorer', (_e, folderPath: string, target: string) => {
  const fullPath = target ? join(folderPath, target) : folderPath
  shell.openPath(fullPath)
})

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Auto-grant all media permissions (mic, camera, audio)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true) // grant everything in dev; scope this in production
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  activeWatcher?.close()
  if (process.platform !== 'darwin') app.quit()
})

process.on('uncaughtException', (err) => {
  console.error('[FolderMind] Uncaught exception:', err)
})
