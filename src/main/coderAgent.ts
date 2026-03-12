import { OpenAI } from 'openai'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { getOpenAI } from './agent'

export async function runCoderAgent(
  userMessage: string,
  history: any[],
  context: any,
  helpers: any,
  plannerContext: string
): Promise<{ finalResponse: string, toolCallsCount: number }> {
  const ai = getOpenAI()
  const { folderPath, profile, onToken, onToolCall, onToolResult, onActivity, onApprovalRequest, onTrace } = context
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

  const messages: any[] = [
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
        onActivity?.({ kind: 'tool', message: `Coder running ${name}`, ts: Date.now() })
        
        let result = ''
        try {
          if (name === 'readFile') {
             onTrace?.({ tool: name, detail: `Read file ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
             result = readFileSync(safeJoin(folderPath, args.filepath), 'utf-8').slice(0, 20000)
          } else if (name === 'writeFile') {
            onTrace?.({ tool: name, detail: `Prepared write to ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            const target = safeJoin(folderPath, args.filepath)
            const parent = dirname(target)
            const before = existsSync(target) ? readFileSync(target, 'utf-8') : ''
            const after = String(args.content || '')
            const approved = await requestFileChangeApproval(folderPath, args.filepath, before, after, onApprovalRequest, onActivity)
            if (!approved) {
              result = `File change blocked: ${args.filepath}`
            } else {
              if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
              writeFileSync(target, after, 'utf-8')
              const writeDiff = buildSimpleDiff(before, after, String(args.filepath))
              onTrace?.({ tool: 'writeFile:committed', detail: `Wrote ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath), diff: writeDiff })
              result = `Success: wrote ${args.filepath}`
            }
          } else if (name === 'applyPatch') {
            onTrace?.({ tool: name, detail: `Prepared patch for ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath) })
            const target = safeJoin(folderPath, args.filepath)
            const originalContent = readFileSync(target, 'utf-8')
            const updated = applyPatchToContent(originalContent, String(args.findText || ''), String(args.replaceText || ''))
            const approved = await requestFileChangeApproval(folderPath, args.filepath, originalContent, updated, onApprovalRequest, onActivity)
            if (!approved) {
              result = `File patch blocked: ${args.filepath}`
            } else {
              writeFileSync(target, updated, 'utf-8')
              const patchDiff = buildSimpleDiff(originalContent, updated, String(args.filepath))
              onTrace?.({ tool: 'applyPatch:committed', detail: `Patched ${String(args.filepath)}`, ts: Date.now(), file: String(args.filepath), diff: patchDiff })
              result = `Success: patched ${args.filepath}`
            }
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
