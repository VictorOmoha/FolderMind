// Agent — GPT-4o with streaming + function calling

export interface FileContext { name: string; content: string }
export interface Message { role: 'user' | 'assistant' | 'system'; content: string }

const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

// ── Tools the agent can execute ───────────────────────────────────────────────
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create or overwrite a file in the project folder',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'File name with extension (e.g. report.csv, summary.md)' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the project folder (Windows PowerShell)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          reason: { type: 'string', description: 'Why this command is needed' },
        },
        required: ['command', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_in_explorer',
      description: 'Open a file or folder in Windows Explorer',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'File or folder name to open (relative to project folder)' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for current information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_data',
      description: 'Analyze CSV or tabular data and return insights + generate a visual HTML report',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'CSV file to analyze' },
          question: { type: 'string', description: 'What to analyze or find' },
        },
        required: ['filename', 'question'],
      },
    },
  },
]

export type ToolCall = {
  id: string
  name: string
  args: Record<string, string>
}

// ── Build system prompt ───────────────────────────────────────────────────────
export function buildSystemPrompt(folderName: string, memory: string, files: FileContext[]): string {
  const fileSection = files.length > 0
    ? files.map(f => `### ${f.name}\n\`\`\`\n${f.content.slice(0, 6000)}\n\`\`\``).join('\n\n')
    : '_No files yet._'

  return `You are FolderMind — an AI co-worker for the project "${folderName}".
You have full context of every file and can take real actions via tools.

## Your Memory
${memory}

## Current Files
${fileSection}

## How You Work
- Answer questions directly and concisely
- Use tools to take action (create files, run commands, open things, search web)
- When creating files, always tell the user what you made
- When running commands, explain what you're doing first
- Be direct. No fluff.`
}

// ── Streaming chat with tool calling ─────────────────────────────────────────
export async function streamChat(
  messages: Message[],
  folderName: string,
  memory: string,
  files: FileContext[],
  onToken: (token: string) => void,
  onToolCall: (tool: ToolCall) => Promise<string>,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(folderName, memory, files)

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      stream: true,
      tools: TOOLS,
      tool_choice: 'auto',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`OpenAI error: ${err}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let toolCallBuffer: { id: string; name: string; args: string } | null = null
  let finishReason = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') { finishReason = 'stop'; continue }
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        const reason = parsed.choices?.[0]?.finish_reason

        if (reason) finishReason = reason

        // Regular text token
        if (delta?.content) {
          fullText += delta.content
          onToken(delta.content)
        }

        // Tool call accumulation
        if (delta?.tool_calls?.[0]) {
          const tc = delta.tool_calls[0]
          if (tc.function?.name) {
            toolCallBuffer = { id: tc.id ?? '', name: tc.function.name, args: '' }
          }
          if (tc.function?.arguments && toolCallBuffer) {
            toolCallBuffer.args += tc.function.arguments
          }
        }
      } catch { /* skip malformed chunks */ }
    }
  }

  // Execute tool call if present
  if (finishReason === 'tool_calls' && toolCallBuffer) {
    let args: Record<string, string> = {}
    try { args = JSON.parse(toolCallBuffer.args) } catch { /* bad args */ }

    const toolResult = await onToolCall({
      id: toolCallBuffer.id,
      name: toolCallBuffer.name,
      args,
    })

    // Send tool result back and stream the final response
    const followUp = await streamChat(
      [
        ...messages,
        { role: 'assistant', content: fullText || `Using tool: ${toolCallBuffer.name}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { role: 'tool', content: toolResult } as any,
      ],
      folderName, memory, files, onToken, onToolCall
    )
    return followUp
  }

  return fullText
}
