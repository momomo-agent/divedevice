/**
 * Agent runner —— 基于 agentic-core，把 toolbus 的工具喂进去，
 * 流式输出写回 chat service。
 *
 * agentic-core 是 UMD，浏览器里它自己把 API 挂到 globalThis.AgenticCore，
 * 不走 ESM import——直接动态 <script> 引入 + 读 global。
 */
import { toolbus } from './toolbus'
import { chat } from './chat'
import { deviceHub } from './device-hub'
import { agentSettings } from './settings'
import { desktopPromptBlock } from './desktop-tools'
import { reactive } from 'vue'
// 走 URL import —— Vite 会把这个当成静态资源 URL 返回
import agenticCoreUrl from 'agentic-core/agentic-core.js?url'

interface AgenticCoreApi {
  agenticAsk: (prompt: string, config: unknown) => AsyncGenerator<any, void, void>
  [k: string]: unknown
}

let loadedPromise: Promise<AgenticCoreApi> | null = null
function loadAgenticCore(): Promise<AgenticCoreApi> {
  if (loadedPromise) return loadedPromise
  loadedPromise = new Promise<AgenticCoreApi>((resolve, reject) => {
    const existing = (globalThis as any).AgenticCore as AgenticCoreApi | undefined
    if (existing?.agenticAsk) { resolve(existing); return }
    const s = document.createElement('script')
    s.src = agenticCoreUrl
    s.async = true
    s.onload = () => {
      const api = (globalThis as any).AgenticCore as AgenticCoreApi | undefined
      if (api?.agenticAsk) resolve(api)
      else reject(new Error('agentic-core 加载后未挂载到 globalThis'))
    }
    s.onerror = () => reject(new Error('加载 agentic-core 失败'))
    document.head.appendChild(s)
  })
  return loadedPromise
}

export interface AgentState {
  running: boolean
  error: string | null
}

export const agentState = reactive<AgentState>({ running: false, error: null })

function stringifyErr(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.message
  try {
    const s = JSON.stringify(v)
    if (typeof s === 'string' && s !== '{}') return s
  } catch {}
  return String(v)
}

function buildHistory(): Array<{ role: string; content: unknown }> {
  // 带上 tool 轮次信息，避免模型次轮推理時完全看不到工具调用历史而幻觉。
  // 约定：tool.meta.kind 为 'use' 或 'result'，配合 id/name/input/output 还原 Anthropic/OpenAI 通用的工具消息形状。
  const out: Array<{ role: string; content: unknown }> = []
  for (const m of chat.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      if (!m.content) continue // 空文本就丢，避免影响 history
      out.push({ role: m.role, content: m.content })
    } else if (m.role === 'tool' && m.meta) {
      const kind = m.meta.kind
      if (kind === 'use') {
        out.push({
          role: 'assistant',
          content: [{ type: 'tool_use', id: m.meta.id, name: m.meta.name, input: m.meta.input ?? {} }],
        } as never)
      } else if (kind === 'result') {
        out.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.meta.id, content: typeof m.meta.output === 'string' ? m.meta.output : JSON.stringify(m.meta.output ?? null) }],
        } as never)
      }
    }
  }
  return out
}

function buildTools() {
  const deviceId = deviceHub.currentId.value ?? undefined
  return toolbus.list().map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (input: Record<string, unknown>) => {
      try {
        const r = await def.execute(input, { deviceId })
        console.debug('[tool-wrapper]', def.name, 'returned:', r)
        // undefined 和 void return 对下游反序列化不友好，正规化为一个结构体
        if (r === undefined) return { ok: true }
        return r
      } catch (err) {
        console.debug('[tool-wrapper]', def.name, 'error:', err)
        return { error: (err as Error).message }
      }
    },
  }))
}

/**
 * 统一入口：空闲时直接走 agentAsk；running 时排进 pending 队列，
 * agentAsk 的 finally 会自动 dequeue 继续跑。
 */
export function sendOrQueue(prompt: string): 'sent' | 'queued' | 'empty' {
  const text = prompt.trim()
  if (!text) return 'empty'
  if (agentState.running) {
    chat.enqueue(text)
    return 'queued'
  }
  agentAsk(text).catch(() => {})
  return 'sent'
}

export async function agentAsk(prompt: string): Promise<void> {
  if (agentState.running) return
  agentState.error = null
  agentState.running = true

  const { provider, apiKey, baseUrl, proxyUrl, proxyEnabled, model, system } = agentSettings
  if (!apiKey) {
    chat.push('system', '未配置 API Key。点击对话框右上角齿轮配置。')
    agentState.running = false
    return
  }

  chat.push('user', prompt)
  const assistantMsg = chat.push('assistant', '')

  try {
    const api = await loadAgenticCore()
    // agentic-core 会自己把 prompt 拼进 messages，我们 history 不要重复包含当前 user。
    // buildHistory() 返回的是 chat.messages 全体，已经含刚推的 user，去掉 user 和空 assistant 尾巴。
    let history = buildHistory()
    // 去掉刚推的空 assistant 和 user prompt（agentic-core 会加回去）
    while (history.length && history[history.length - 1].content === '') history.pop()
    if (history.length && history[history.length - 1].content === prompt) history.pop()

    const iter = api.agenticAsk(prompt, {
      provider,
      apiKey,
      baseUrl: baseUrl || undefined,
      proxyUrl: proxyEnabled && proxyUrl ? proxyUrl : undefined,
      model,
      system: `${system}\n\n${desktopPromptBlock()}`,
      tools: buildTools(),
      history,
      stream: true,
    })

    for await (const event of iter) {
      // DEBUG: 抓所有原始事件字段
      try {
        console.debug('[agent/event]', event.type, Object.keys(event), JSON.stringify(event).slice(0, 400))
      } catch { console.debug('[agent/event]', event.type) }

      switch (event.type) {
        case 'text_delta':
          if (typeof event.text === 'string') assistantMsg.content += event.text
          break

        case 'tool_use': {
          const input = event.input ?? {}
          let inputStr: string
          try { inputStr = JSON.stringify(input) } catch { inputStr = String(input) }
          chat.push('tool', `→ ${event.name}(${inputStr})`, {
            kind: 'use',
            id: event.id,
            name: event.name,
            input: event.input,
          })
          break
        }

        case 'tool_result': {
          console.debug('[agent] tool_result event:', event)
          // agentic-core 上报的字段是 output；也兄容 result/content
          const payload = event.output ?? event.result ?? event.content
          let text: string
          if (payload === undefined) text = '(no output)'
          else if (payload === null) text = 'null'
          else if (typeof payload === 'string') text = payload
          else {
            try { text = JSON.stringify(payload) } catch { text = String(payload) }
            if (typeof text !== 'string') text = String(payload)
          }
          chat.push('tool', `← ${text.length > 400 ? text.slice(0, 400) + '…' : text}`, {
            kind: 'result',
            id: event.id,
            name: event.name,
            output: payload,
          })
          break
        }

        case 'tool_error': {
          chat.push('tool', `✖ ${event.name}: ${stringifyErr(event.error) || 'unknown error'}`, {
            name: event.name,
            error: event.error,
          })
          break
        }

        case 'warning':
          chat.push('system', `⚠️ ${stringifyErr(event.message ?? event.error) || ''}`)
          break

        case 'error':
          chat.push('system', `错误：${stringifyErr(event.error ?? event.message) || 'unknown'}`)
          break

        // 其他事件（tool_ready / tool_delta / status / timing / config / done / response）默默吃掉
        default:
          break
      }
    }
  } catch (err) {
    agentState.error = (err as Error).message
    chat.push('system', `出错：${agentState.error}`)
  } finally {
    agentState.running = false
    // 排队的下一条自动接着跑
    const next = chat.dequeue()
    if (next) {
      // 不 await 避免递归栈不断叠；setTimeout 0 让出循环
      setTimeout(() => { agentAsk(next.text).catch(() => {}) }, 0)
    }
  }
}
