import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { getOpenAI } from './agent'

export interface VectorEmbedding {
  id: string
  filepath: string
  chunkIndex: number
  text: string
  embedding: number[]
}

export interface VectorIndex {
  version: 1
  files: Record<string, VectorEmbedding[]>
}

const getIndexPath = (folderPath: string) => join(folderPath, '.foldermind', 'embeddings.json')

export function loadVectorIndex(folderPath: string): VectorIndex {
  const indexPath = getIndexPath(folderPath)
  if (existsSync(indexPath)) {
    try {
      return JSON.parse(readFileSync(indexPath, 'utf-8'))
    } catch {
      // ignore
    }
  }
  return { version: 1, files: {} }
}

export function saveVectorIndex(folderPath: string, index: VectorIndex) {
  const indexPath = getIndexPath(folderPath)
  const dir = join(folderPath, '.foldermind')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(indexPath, JSON.stringify(index), 'utf-8')
}

// Simple chunking by paragraph or fixed size (better suited for code/docs)
export function chunkText(text: string, maxChunkSize = 800, overlap = 150): string[] {
  const chunks: string[] = []
  let startIndex = 0
  while (startIndex < text.length) {
    let endIndex = startIndex + maxChunkSize
    if (endIndex >= text.length) {
      chunks.push(text.slice(startIndex))
      break
    }
    // Try to find a good breakpoint (newline)
    const nextNewline = text.indexOf('\n', endIndex)
    const prevNewline = text.lastIndexOf('\n', endIndex)
    
    if (prevNewline > startIndex + maxChunkSize / 2) {
       endIndex = prevNewline + 1
    } else if (nextNewline !== -1 && nextNewline < endIndex + maxChunkSize / 4) {
       endIndex = nextNewline + 1
    }
    
    chunks.push(text.slice(startIndex, endIndex))
    startIndex = endIndex - overlap > startIndex ? endIndex - overlap : endIndex
  }
  return chunks
}

export async function generateEmbeddings(texts: string[]) {
  const ai = getOpenAI()
  const res = await ai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  })
  return res.data.map((d: any) => d.embedding)
}

function isCodeLikeFile(filePath: string) {
  return /\.(ts|tsx|js|jsx|json|md|css|scss|html|yml|yaml|ps1|sh)$/i.test(filePath)
}

export async function updateIndexForFiles(folderPath: string, relFilepaths: string[]) {
  const index = loadVectorIndex(folderPath)
  let updated = false
  
  for (const filepath of relFilepaths) {
    const fullPath = join(folderPath, filepath)
    
    if (!existsSync(fullPath)) {
      if (index.files[filepath]) {
        delete index.files[filepath]
        updated = true
      }
      continue
    }
    
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) continue
      if (!isCodeLikeFile(fullPath)) continue
      
      const content = readFileSync(fullPath, 'utf-8')
      const chunks = chunkText(content)
      
      if (chunks.length === 0) {
          if (index.files[filepath]) {
            delete index.files[filepath]
            updated = true
          }
          continue
      }
      
      // Batch generate embeddings (max 100 at a time)
      const embeddings: number[][] = []
      for (let i = 0; i < chunks.length; i += 100) {
         const batch = chunks.slice(i, i + 100)
         const batchEmbeddings = await generateEmbeddings(batch)
         embeddings.push(...batchEmbeddings)
      }
      
      const fileEmbeddings: VectorEmbedding[] = chunks.map((text, i) => ({
        id: `${filepath}-${i}`,
        filepath,
        chunkIndex: i,
        text,
        embedding: embeddings[i]
      }))
      
      index.files[filepath] = fileEmbeddings
      updated = true
    } catch (err) {
      console.error(`Failed to index ${filepath}:`, err)
      // ignore
    }
  }
  
  if (updated) {
    saveVectorIndex(folderPath, index)
  }
}
