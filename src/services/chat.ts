/**
 * Chat Bus —— 对话流消息总线 + pending 队列
 * agent 在运行时，新消息排队，跑完自动刷下一条。
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

export interface PendingItem {
  id: string
  text: string
  createdAt: number
}

const state = reactive<{ messages: ChatMessage[]; pending: PendingItem[] }>({
  messages: [],
  pending: [],
})
let _mid = 0
let _pid = 0

export const chat = {
  messages: readonly(state.messages) as unknown as readonly ChatMessage[],
  pending: readonly(state.pending) as unknown as readonly PendingItem[],

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

  // ---- Pending queue ----

  /** 入队，返回 pending item */
  enqueue(text: string): PendingItem {
    const item: PendingItem = { id: `p${++_pid}`, text, createdAt: Date.now() }
    state.pending.push(item)
    return item
  },

  /** 弹出队头（agent drain 时用）*/
  dequeue(): PendingItem | null {
    return state.pending.shift() ?? null
  },

  /** 删除指定 pending */
  removePending(id: string): boolean {
    const i = state.pending.findIndex((p) => p.id === id)
    if (i < 0) return false
    state.pending.splice(i, 1)
    return true
  },

  /** 上移一位 */
  movePendingUp(id: string): boolean {
    const i = state.pending.findIndex((p) => p.id === id)
    if (i <= 0) return false
    const [it] = state.pending.splice(i, 1)
    state.pending.splice(i - 1, 0, it)
    return true
  },

  /** 下移一位 */
  movePendingDown(id: string): boolean {
    const i = state.pending.findIndex((p) => p.id === id)
    if (i < 0 || i >= state.pending.length - 1) return false
    const [it] = state.pending.splice(i, 1)
    state.pending.splice(i + 1, 0, it)
    return true
  },

  /** 修改 pending 文本（直接编辑标题使用）*/
  updatePending(id: string, text: string): boolean {
    const it = state.pending.find((p) => p.id === id)
    if (!it) return false
    it.text = text
    return true
  },

  /** 清空队列 */
  clearPending() { state.pending.length = 0 },
}
