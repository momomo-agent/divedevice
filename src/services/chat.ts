/**
 * Chat Bus —— 对话流消息总线（stub，Phase 3 接 agentic-core）
 * 现在先提供 push API，让 Finder 等 app 能往对话流发系统消息。
 */
import { reactive, readonly } from 'vue'

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  meta?: Record<string, unknown>
}

const state = reactive<{ messages: ChatMessage[] }>({ messages: [] })
let _mid = 0

export const chat = {
  messages: readonly(state.messages) as unknown as readonly ChatMessage[],

  push(role: ChatRole, content: string, meta?: Record<string, unknown>): ChatMessage {
    const msg: ChatMessage = {
      id: `m${++_mid}`,
      role,
      content,
      createdAt: Date.now(),
      meta,
    }
    state.messages.push(msg)
    return msg
  },

  clear() {
    state.messages.length = 0
  },
}
