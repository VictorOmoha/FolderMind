import { OpenAI } from 'openai'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getOpenAI } from './agent'

interface AgentMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface ToolCallTraceEntry {
  tool: string
  detail: string
  ts: number
  file?: string
  command?: string
  diff?: string
}

interface CoderContext {
  folderPath: string
  onToken: (token: string) => void
  onToolCall: (name: string, args: unknown) => void
  onToolResult: (name: string, result: string) => void
  onActivity?: (entry: { kind: 'thought' | 'tool' | 'result' | 'approval' | 'system'; message: string; ts: number }) => void
  onApprovalRequest?: (request: {
    id: string
    type: 'command' | 'file_change'
    title: string
    description: string
    command?: string
    filepath?: string
    diff?: string
  }) => Promise<boolean>
  onTrace?: (entry: ToolCallTraceEntry) => void
}

interface CoderHelpers {
  safeJoin: (folderPath: string, target: string) => string
  buildSimpleDiff: (before: string, after: string, filepath: string) => string
  applyPatchToContent: (original: string, findText: string, replaceText: string) => string
  requestFileChangeApproval: (
    folderPath: string,
    filepath: string,
    beforeContent: string,
    afterContent: string,
    onApprovalRequest?: (request: {
      id: string
      type: 'command' | 'file_change'
      title: string
      description: string
      command?: string
      filepath?: string
      diff?: string
    }) => Promise<boolean>,
    onActivity?: (entry: { kind: 'thought' | 'tool' | 'result' | 'approval' | 'system'; message: string; ts: number }) => void,
  ) => Promise<boolean>
}

interface AccumulatedToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function runCoderAgent(
  userMessage: string,
  history: AgentMessage[],
  context: CoderContext,
  helpers: CoderHelpers,
  plannerContext: string
): Promise<{ finalResponse: string, toolCallsCount: number }> {
  const ai = getOpenAI()
  const { folderPath, onToken, onToolCall, onToolResult, onActivity, onApprovalRequest, onTrace } = context
  const { safeJoin, buildSimpleDiff, applyPatchToContent, requestFileChangeApproval } = helpers

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'readFile',
        description: 'Read the contents of a specific file to check exact syntax before patching.',
        parameters: { type: 'object', properties: { filepath: { type: 'string' } }, required: ['filepath'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'writeFile',
        description: 'Write or overwrite a file with new content. This may require approval.',
        parameters: { type: 'object', properties: { filepath: { type: 'string' }, content: { type: 'string' } }, required: ['filepath', 'content'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'applyPatch',
        description: 'Modify a file by replacing exact text with new text. This may require approval.',
        parameters: { type: 'object', properties: { filepath: { type: 'string' }, findText: { type: 'string' }, replaceText: { type: 'string' } }, required: ['filepath', 'findText', 'replaceText'] }
      }
    }
  ]

  const systemPrompt = `You are FolderMind's Coder Agent.
Folder Path: ${folderPath}
Your SOLE job is to write code and modify files based on the Architect's blueprint.
You CANNOT run shell commands.
Prefer applyPatch for targeted edits. Use writeFile only for new files or full rewrites.
When editing, make the smallest safe change needed.

Architect's Blueprint and Findings:
${plannerContext}`

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ]

  let depth = 0
  let totalToolCalls = 0
  let currentFinalResponse = ''

  while (depth < 7) {
    depth++
    const stream = await ai.chat.completions.create({ model: 'gpt-4o', messages, tools, tool_choice: 'auto', stream: true, temperature: 0.2 })
    let currentResponse = ''
    const toolCalls: AccumulatedToolCall[] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) { currentResponse += delta.content; onToken(delta.content) }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id ?? `toolcall-${tc.index}`, type: 'function', function: { name: tc.function?.name || '', arguments: '' } }
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
        let args: Record<string, unknown>
        try { args = JSON.parse(call.function.arguments) as Record<string, unknown> } catch { args = {} }
        onToolCall(name, args)
        onActivity?.({ kind: 'tool', message: `Coder running ${name}`, ts: Date.now() })
        
        let result = ''
        try {
          if (name === 'readFile') {
             onTrace?.({ tool: name, detail: `Read file ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
             result = readFileSync(safeJoin(folderPath, String(args.filepath ?? '')), 'utf-8').slice(0, 20000)
          } else if (name === 'writeFile') {
            onTrace?.({ tool: name, detail: `Prepared write to ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            const filepath = String(args.filepath ?? '')
            const target = safeJoin(folderPath, filepath)
            const parent = dirname(target)
            const before = existsSync(target) ? readFileSync(target, 'utf-8') : ''
            const after = String(args.content || '')
            const approved = await requestFileChangeApproval(folderPath, filepath, before, after, onApprovalRequest, onActivity)
            if (!approved) {
              result = `File change blocked: ${filepath}`
            } else {
              if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
              writeFileSync(target, after, 'utf-8')
              const writeDiff = buildSimpleDiff(before, after, String(args.filepath))
              onTrace?.({ tool: 'writeFile:committed', detail: `Wrote ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath), diff: writeDiff })
              result = `Success: wrote ${filepath}`
            }
          } else if (name === 'applyPatch') {
            onTrace?.({ tool: name, detail: `Prepared patch for ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            const filepath = String(args.filepath ?? '')
            const target = safeJoin(folderPath, filepath)
            const originalContent = readFileSync(target, 'utf-8')
            const updated = applyPatchToContent(originalContent, String(args.findText || ''), String(args.replaceText || ''))
            const approved = await requestFileChangeApproval(folderPath, filepath, originalContent, updated, onApprovalRequest, onActivity)
            if (!approved) {
              result = `File patch blocked: ${filepath}`
            } else {
              writeFileSync(target, updated, 'utf-8')
              const patchDiff = buildSimpleDiff(originalContent, updated, filepath)
              onTrace?.({ tool: 'applyPatch:committed', detail: `Patched ${filepath}`, ts: Date.now(), file: filepath, diff: patchDiff })
              result = `Success: patched ${filepath}`
            }
          }
        } catch (err: unknown) { result = `Error: ${getErrorMessage(err)}` }
        
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
