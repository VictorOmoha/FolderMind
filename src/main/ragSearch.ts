import { loadVectorIndex, generateEmbeddings } from './ragIndexer'

function cosineSimilarity(vecA: number[], vecB: number[]) {
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}

export async function semanticSearch(folderPath: string, query: string, topK = 5) {
  try {
    const index = loadVectorIndex(folderPath)
    const documents = Object.values(index.files).flat()
    if (documents.length === 0) {
      return 'Index is empty. Background indexing might not be complete or no files match text formats.'
    }
    
    const [queryEmbedding] = await generateEmbeddings([query])
    
    const scores = documents.map(doc => ({
      doc,
      score: cosineSimilarity(queryEmbedding, doc.embedding)
    }))
    
    scores.sort((a, b) => b.score - a.score)
    
    const topResults = scores.slice(0, Math.min(topK, 15))
    return topResults.map(r => `FILE: ${r.doc.filepath}\nSCORE: ${r.score.toFixed(3)}\nCONTENT:\n${r.doc.text}`).join('\n\n---\n\n')
  } catch (err: any) {
    return `Semantic search failed: ${err.message}`
  }
}
