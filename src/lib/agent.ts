// Agent — talks to OpenAI with folder context baked in

export interface FileContext {
  name: string
  content: string
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY

export async function chat(
  messages: Message[],
  folderName: string,
  memory: string,
  files: FileContext[]
): Promise<string> {
  const fileSection = files.length > 0
    ? files.map(f => `### ${f.name}\n\`\`\`\n${f.content.slice(0, 8000)}\n\`\`\``).join('\n\n')
    : '_No files in this folder yet._'

  const systemPrompt = `You are an AI co-worker inside a project folder called "${folderName}".
You have full context of every file in this folder. You can:
- Answer questions about the files
- Summarize, analyze, and extract insights
- Create new files (respond with FILE_CREATE: filename.ext followed by the content)
- Build trackers, dashboards, and reports as CSV or HTML files
- Remember key decisions across sessions

## Your Memory of This Project
${memory}

## Current Files in Folder
${fileSection}

---
Be direct, practical, and concise. If you create a file, start your response with:
FILE_CREATE: <filename>
<file content>
END_FILE
Then continue your explanation below.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.7,
    }),
  })

  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? 'No response.'
}

// Parse FILE_CREATE blocks out of AI response
export function parseFileCreations(response: string): { filename: string; content: string }[] {
  const files: { filename: string; content: string }[] = []
  const regex = /FILE_CREATE:\s*(\S+)\n([\s\S]*?)END_FILE/g
  let match
  while ((match = regex.exec(response)) !== null) {
    files.push({ filename: match[1], content: match[2].trim() })
  }
  return files
}

export function stripFileCreations(response: string): string {
  return response.replace(/FILE_CREATE:\s*\S+\n[\s\S]*?END_FILE\n?/g, '').trim()
}
