import { OpenAI } from 'openai'
import { readdirSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { getOpenAI, archetypeGuidance } from './agent'
import { packWorkspaceContext } from './contextPacker'
import { semanticSearch } from './ragSearch'

export async function runPlannerAgent(
  userMessage: string,
  history: any[],
  context: any,
  helpers: any
): Promise<{ finalResponse: string, toolCallsCount: number }> {
  const ai = getOpenAI()
  const { folderPath, profile, onToken, onToolCall, onToolResult, onActivity, onTrace } = context
  const { truncate, safeJoin, searchInTree, IGNORED_DIRS, READ_LIMIT } = helpers

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'listDirectory',
        description: 'List contents of a directory to see what files exist.',
        parameters: { type: 'object', properties: { subpath: { type: 'string' } }, required: ['subpath'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'readFile',
        description: 'Read the contents of a specific file.',
        parameters: { type: 'object', properties: { filepath: { type: 'string' } }, required: ['filepath'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'readFileRange',
        description: 'Read a specific line range from a text file.',
        parameters: { type: 'object', properties: { filepath: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } }, required: ['filepath', 'startLine', 'endLine'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'searchInFiles',
        description: 'Search for a text query across files in the folder.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, subpath: { type: 'string' } }, required: ['query'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'semanticSearch',
        description: 'Search for concepts, ideas, or functionality across the workspace using vector embeddings. Use this instead of searchInFiles when you do not know the exact keywords.',
        parameters: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number' } }, required: ['query'] }
      }
    }
  ]


  const packedContext = packWorkspaceContext(folderPath)

  const profileSection = profile ? `\nAgent Profile:\n- Name: ${profile.name || 'FolderMind Planner'}\n- Archetype: ${profile.archetype || 'general'}` : ''
  const systemPrompt = `You are FolderMind's Planner Agent (Architect).
Folder Path: ${folderPath}${profileSection}
Your SOLE job is to investigate the workspace and gather context needed to fulfill the user's request.
You ONLY have read-only tools. You cannot write code or run commands.
Once you have retrieved all necessary context, output your final response summarizing what needs to be changed or executed by the Coder or Executor.
Do NOT guess file contents. Use your tools.

${archetypeGuidance(profile?.archetype)}

--- Pre-packed Workspace Context ---
Below is the pre-packed text content of the workspace files. Use this to avoid needing to manually readFile if the information is already here.
${packedContext}
------------------------------------`

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ]

  let depth = 0
  let totalToolCalls = 0
  let currentFinalResponse = ''

  while (depth < 5) {
    depth++
    const stream = await ai.chat.completions.create({ model: 'gpt-4o', messages, tools, tool_choice: 'auto', stream: true, temperature: 0.2 })
    let currentResponse = ''
    const toolCalls: any[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) { currentResponse += delta.content; onToken(delta.content) }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id, type: tc.type, function: { name: tc.function?.name || '', arguments: '' } }
          if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments
        }
      }
    }

    if (currentResponse) messages.push({ role: 'assistant', content: currentResponse })
    if (currentResponse) currentFinalResponse += currentResponse

    if (toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: currentResponse || null, tool_calls: toolCalls })
      for (const call of toolCalls) {
        totalToolCalls++
        const name = call.function.name
        let args: any; try { args = JSON.parse(call.function.arguments) } catch { args = {} }
        onToolCall(name, args)
        onActivity?.({ kind: 'tool', message: `Planner running ${name}`, ts: Date.now() })
        
        let result = ''
        try {
          if (name === 'listDirectory') {
            onTrace?.({ tool: name, detail: `Listed directory ${String(args.subpath || '.')}`, ts: Date.now() })
            const targetPath = safeJoin(folderPath, args.subpath === '.' ? '' : args.subpath)
            const items = readdirSync(targetPath)
            result = items.filter(i => !IGNORED_DIRS.has(i)).map(i => {
              try { return statSync(join(targetPath, i)).isDirectory() ? `[DIR] ${i}` : `[FILE] ${i}` } catch { return `[UNKNOWN] ${i}` }
            }).join('\n') || 'Empty directory.'
          } else if (name === 'readFile') {
             onTrace?.({ tool: name, detail: `Read file ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
             result = truncate(readFileSync(safeJoin(folderPath, args.filepath), 'utf-8'), READ_LIMIT)
          } else if (name === 'readFileRange') {
             onTrace?.({ tool: name, detail: `Read file range ${String(args.filepath)}:${args.startLine}-${args.endLine}`, ts: Date.now(), file: String(args.filepath) })
             const lines = readFileSync(safeJoin(folderPath, args.filepath), 'utf-8').split(/\r?\n/)
             const start = Math.max(1, Number(args.startLine || 1))
             const end = Math.max(start, Number(args.endLine || start))
             result = lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n') || 'No content in requesting range.'
          } else if (name === 'searchInFiles') {
             onTrace?.({ tool: name, detail: `Searched for "${String(args.query || '')}"`, ts: Date.now() })
             result = searchInTree(folderPath, String(args.query || ''), String(args.subpath || '.'))
          } else if (name === 'semanticSearch') {

             onTrace?.({ tool: name, detail: `Semantic search for "${String(args.query || '')}"`, ts: Date.now() })
             result = await semanticSearch(folderPath, String(args.query || ''), Number(args.topK || 5))
          }
        } catch (err: any) { result = `Error: ${err.message}` }
        
        onToolResult(name, result)
        onActivity?.({ kind: 'result', message: `${name}: ${result.slice(0, 200)}`, ts: Date.now() })
        messages.push({ role: 'tool', tool_call_id: call.id, content: result })
      }
    } else {
      break
    }
  }

  return { finalResponse: currentFinalResponse, toolCallsCount: totalToolCalls }
}
