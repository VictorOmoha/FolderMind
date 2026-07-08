import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

const DEFAULT_IGNORE = new Set([
  '.git', 'node_modules', 'dist', 'out', 'release', 'build', '.foldermind', 'coverage',
  '.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  // Do not pack secrets/credentials into a prompt sent to a third-party API
  '.env', '.env.local', '.env.development', '.env.production', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc'
])

// Filenames/extensions that commonly hold secrets — excluded from packed context.
const SECRET_PATTERNS = [/(^|\/)\.env(\.|$)/i, /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /(^|\/)id_(rsa|ed25519|dsa|ecdsa)/i, /credentials?\.json$/i]

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.mp4', '.webm', '.mp3', '.wav',
  '.ttf', '.woff', '.woff2', '.eot', '.exe', '.dll', '.so', '.dylib'
])

const MAX_TOTAL_CHARS = 100000 // roughly ~25k-30k tokens margin

export function packWorkspaceContext(folderPath: string): string {
  let packedContent = ''
  let totalChars = 0
  let isTruncated = false

  function walk(currentDir: string, relPath: string) {
    if (isTruncated) return
    let items: string[] = []
    try {
      items = readdirSync(currentDir)
    } catch {
      return
    }

    for (const item of items) {
      if (DEFAULT_IGNORE.has(item)) continue
      
      const fullPath = join(currentDir, item)
      const currentRelPath = relPath ? `${relPath}/${item}` : item
      
      let stat: import('fs').Stats
      try {
        stat = statSync(fullPath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        walk(fullPath, currentRelPath)
      } else {
        const ext = currentRelPath.includes('.') ? currentRelPath.substring(currentRelPath.lastIndexOf('.')) : ''
        if (BINARY_EXTS.has(ext.toLowerCase())) continue
        if (SECRET_PATTERNS.some((pattern) => pattern.test(currentRelPath))) continue

        // Check if file is small enough to consider reading
        if (stat.size > 250000) continue // Skip files > 250KB

        try {
          const content = readFileSync(fullPath, 'utf8')

          // Skip binary blobs (NUL byte) or minified files (very few newlines relative to length)
          if (content.indexOf('\0') !== -1 || content.split('\n').length < content.length / 500) {
            continue
          }

          const fileHeader = `\n\n--- ${currentRelPath} ---\n`
          const contentToAdd = fileHeader + content
          
          if (totalChars + contentToAdd.length > MAX_TOTAL_CHARS) {
            isTruncated = true
            packedContent += `\\n\\n...[WORKSPACE CONTEXT TRUNCATED - REPO TOO LARGE]...`
            return
          }

          packedContent += contentToAdd
          totalChars += contentToAdd.length
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  walk(folderPath, '')
  
  if (!packedContent) {
    return 'No scannable text files found.'
  }

  return packedContent
}
