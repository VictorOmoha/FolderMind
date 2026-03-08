import type { TaskItem, TaskRun, TaskRunActivityEntry, TaskRunPlanSnapshot } from '../../../src/vite-env'
import type { RefObject } from 'react'

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  toolArgs?: unknown
  toolResult?: string
}

export interface PlanStep {
  id: string
  text: string
  status: 'pending' | 'active' | 'done'
}

export interface PlanState {
  goal: string
  steps: PlanStep[]
}

export interface ActivityEntry {
  kind: string
  message: string
  ts: number
}

export interface ApprovalRequest {
  id: string
  type: string
  title: string
  description: string
  command?: string
  filepath?: string
  diff?: string
}

export interface TaskSidebarProps {
  tasks: TaskItem[]
  selectedTaskId: string | null
  setSelectedTaskId: (taskId: string) => void
  editingTaskId: string | null
  editingTaskText: string
  setEditingTaskText: (text: string) => void
  startEditingTask: (task: TaskItem) => void
  commitTaskEdit: (task: TaskItem) => Promise<void>
  cancelTaskEdit: () => void
  submitTask: () => void
  taskInput: string
  setTaskInput: (text: string) => void
  onToggleTask: (task: TaskItem) => void
  onDeleteTask: (taskId: string) => void
  onRunTask: (task: TaskItem) => Promise<void>
  hasApiKey: boolean
}

export interface ChatMessageListProps {
  messages: Message[]
  streamingContent: string
  currentTool: { name: string, args: unknown } | null
  loading: boolean
  bottomRef: RefObject<HTMLDivElement>
}

export interface TaskRunSectionsProps {
  run: TaskRun
}

export interface PlanSnapshotListProps {
  snapshots: TaskRunPlanSnapshot[]
}

export interface ActivityLogListProps {
  entries: TaskRunActivityEntry[]
}
