import { OpenAI } from 'openai'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getOpenAI } from './agent'

const execAsync = promisify(exec)

export async function runExecutorAgent(
  userMessage: string,
  history: any[],
  context: any,
  helpers: any,
  plannerContext: string
): Promise<{ finalResponse: string, toolCallsCount: number }> {
  const ai = getOpenAI()
  const { folderPath, onToken, onToolCall, onToolResult, onActivity, onApprovalRequest, onTrace } = context
  const { needsApproval, truncate, COMMAND_LIMIT } = helpers

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'runCommand',
        description: 'Run a shell command in the folder. Potentially dangerous commands may require approval.',
        parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }
      }
    },
    {
      type: 'function',
      function: {
        name: 'verifyInBrowser',
        description: 'Open a local or remote URL in a headless browser to retrieve HTML or execute a script to verify UI.',
        parameters: { 
          type: 'object', 
          properties: { 
            url: { type: 'string', description: 'The absolute URL to navigate to (e.g. http://localhost:3000)' },
            script: { type: 'string', description: 'Optional JS script to evaluate on the page. Must be valid self-contained JS string. If missing, it returns the body text.' }
          }, 
          required: ['url'] 
        }
      }
    }
  ]

  const systemPrompt = `You are FolderMind's Executor Agent.
Folder Path: ${folderPath}
Your SOLE job is to run terminal commands to verify code, install dependencies, or execute scripts based on the Architect's blueprint.
You CANNOT read or write files directly.
Only run commands that are strictly necessary.

Architect's Blueprint and Context:
${plannerContext}`

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
        onActivity?.({ kind: 'tool', message: `Executor running ${name}`, ts: Date.now() })
        
        let result = ''
        try {
          if (name === 'runCommand') {
            const command = String(args.command || '').trim()
            onTrace?.({ tool: name, detail: `Prepared command: ${command}`, ts: Date.now(), command })
            if (!command) throw new Error('Command is required')

            if (needsApproval(command)) {
              onActivity?.({ kind: 'approval', message: `Approval requested for command: ${command}`, ts: Date.now() })
              const approved = await onApprovalRequest?.({
                id: `approval-${Date.now()}`,
                type: 'command',
                title: 'Command approval required',
                description: 'The agent wants to run a potentially dangerous command.',
                command,
              })
              if (!approved) {
                result = 'Command blocked: user did not approve execution.'
              } else {
                const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
                const { stdout, stderr } = await execAsync(command, { cwd: folderPath, shell, timeout: 30000 })
                result = truncate((stdout + '\n' + stderr).trim() || 'Command executed successfully.', COMMAND_LIMIT)
              }
            } else {
              const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash'
              const { stdout, stderr } = await execAsync(command, { cwd: folderPath, shell, timeout: 30000 })
              result = truncate((stdout + '\n' + stderr).trim() || 'Command executed successfully.', COMMAND_LIMIT)
            }
          }
          else if (name === 'verifyInBrowser') {
            const { runBrowserSession } = require('./browserTools')
            onTrace?.({ tool: name, detail: `Loading ${String(args.url || '')}`, ts: Date.now() })
            result = await runBrowserSession(String(args.url || ''), String(args.script || ''))
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
