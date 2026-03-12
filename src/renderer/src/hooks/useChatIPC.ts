import { useState, useEffect } from 'react'
import type { PlanState, ActivityEntry, ApprovalRequest, Message } from '../components/chatPanelTypes'

export function useChatIPC() {
  const [streamingContent, setStreamingContent] = useState('')
  const [currentTool, setCurrentTool] = useState<{ name: string, args: unknown } | null>(null)
  const [plan, setPlan] = useState<PlanState | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null)
  const [pendingMessages, setPendingMessages] = useState<Message[]>([])

  const resetRunPanels = () => {
    setStreamingContent('')
    setCurrentTool(null)
    setActivity([])
    setPlan(null)
    setPendingMessages([])
  }

  useEffect(() => {
    const unsubToken = window.foldermind.onToken((token) => setStreamingContent(prev => prev + token))
    
    const unsubToolCall = window.foldermind.onToolCall((data) => {
      setStreamingContent(prev => {
        if (prev) {
          setPendingMessages(m => [...m, { role: 'assistant', content: prev }])
        }
        return ''
      })
      setCurrentTool(data)
    })
    
    const unsubToolResult = window.foldermind.onToolResult((data) => {
      setPendingMessages(prev => [...prev, { role: 'tool', content: '', toolName: data.name, toolResult: data.result }])
      setCurrentTool(null)
    })
    
    const unsubPlan = window.foldermind.onPlan((data) => setPlan(data))
    const unsubActivity = window.foldermind.onActivity((data) => setActivity(prev => [...prev.slice(-24), data]))
    const unsubApproval = window.foldermind.onApprovalRequested((data) => setApprovalRequest(data))

    return () => {
      unsubToken()
      unsubToolCall()
      unsubToolResult()
      unsubPlan()
      unsubActivity()
      unsubApproval()
    }
  }, [])

  return {
    streamingContent,
    setStreamingContent,
    currentTool,
    setCurrentTool,
    plan,
    setPlan,
    activity,
    setActivity,
    approvalRequest,
    setApprovalRequest,
    pendingMessages,
    setPendingMessages,
    resetRunPanels
  }
}
