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

function buildHistory(): Array<{ role: string; content: unknown; _images?: unknown[] }> {
  // 带上 tool 轮次信息，避免模型次轮推理時完全看不到工具调用历史而幻觉。
  // 约定：tool.meta.kind 为 'use' 或 'result'，配合 id/name/input/output 还原 Anthropic/OpenAI 通用的工具消息形状。
  // 先一遍：找到最后一条带 _images 的 tool result 索引，只保留它的图，避免 token 爆炸
  let lastImageToolIdx = -1
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const mm = chat.messages[i]
    if (mm.role === 'tool' && mm.meta && mm.meta.kind === 'result') {
      const out = (mm.meta as any).output
      if (out && typeof out === 'object' && Array.isArray(out._images) && out._images.length) {
        lastImageToolIdx = i
        break
      }
    }
  }

  const out: Array<{ role: string; content: unknown; _images?: unknown[] }> = []
  for (let i = 0; i < chat.messages.length; i++) {
    const m = chat.messages[i]
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
        const rawOutput = m.meta.output
        let images: unknown[] | undefined
        let textOutput: unknown = rawOutput
        if (rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
          const rec = rawOutput as Record<string, unknown>
          if (Array.isArray(rec._images) && rec._images.length) {
            // 只最后一条 tool result 带图下轮，之前的图放弃（暂按约定只有截图，看最新一张就够）
            if (i === lastImageToolIdx) {
              images = rec._images as unknown[]
              const { _images: _omit, ...rest } = rec
              textOutput = rest
            } else {
              const { _images: _omit, ...rest } = rec
              textOutput = { ...rest, _imagesOmitted: (rec._images as unknown[]).length }
            }
          }
        }
        const textPart = typeof textOutput === 'string' ? textOutput : JSON.stringify(textOutput ?? null)
        const entry: { role: string; content: unknown; _images?: unknown[] } = {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.meta.id, content: textPart }],
        }
        if (images && images.length) entry._images = images
        out.push(entry as never)
      }
    }
  }
  return out
}

// 知名的二进制/超长输出字段，对模型来说没意义（在下一轮只会净浪费 token，导致幻觉 / 死循环）
const LARGE_BINARY_KEYS = new Set([
  'pngBase64', 'jpegBase64', 'jpgBase64', 'imageBase64', 'dataUrl',
  'base64', 'png', 'jpg', 'jpeg',
  'bytes', 'buffer', 'raw',
])

// 白名单：这些键是 agent-core/anthropic tool_result 多模态约定，不要当 binary 砍掉
const PASSTHROUGH_KEYS = new Set(['_images'])

function sanitizeToolResult(toolName: string, r: unknown): unknown {
  if (r == null || typeof r !== 'object' || Array.isArray(r)) return r
  const obj = r as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (PASSTHROUGH_KEYS.has(k)) {
      out[k] = v
      continue
    }
    if (typeof v === 'string' && LARGE_BINARY_KEYS.has(k) && v.length > 1024) {
      out[k] = `<${k} ${v.length} bytes elided, use a UI-facing tool to view>`
      // 模型拿不到图，求它不要重复调；打个显示标记
      out._hint = `图片已截图到用户界面（${toolName}）。请不要重复调用。要看结果、请告诉用户“截图已到 Screenshot app”等。`
    } else if (typeof v === 'string' && v.length > 4096) {
      out[k] = v.slice(0, 4096) + `… <truncated, ${v.length - 4096} more chars>`
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeToolResult(toolName, v)
    } else {
      out[k] = v
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
        console.debug('[tool-wrapper]', def.name, 'raw:', r)
        if (r === undefined) return { ok: true }
        const safe = sanitizeToolResult(def.name, r)
        console.debug('[tool-wrapper]', def.name, 'sanitized:', safe)
        return safe
      } catch (err) {
        console.debug('[tool-wrapper]', def.name, 'error:', err)
        return { error: (err as Error).message }
      }
    },
  }))
}

export interface AgentImage {
  data: string           // base64 (no data: prefix)
  media_type: string     // 'image/png' / 'image/jpeg' etc.
  preview?: string       // data: URL 做缩略图（可选）
}

/**
 * 统一入口：空闲时直接走 agentAsk；running 时排进 pending 队列，
 * agentAsk 的 finally 会自动 dequeue 继续跑。
 */
export function sendOrQueue(prompt: string, images?: AgentImage[]): 'sent' | 'queued' | 'empty' {
  const text = prompt.trim()
  if (!text && !(images && images.length)) return 'empty'
  if (agentState.running) {
    chat.enqueue(text, images)
    return 'queued'
  }
  agentAsk(text, images).catch(() => {})
  return 'sent'
}

export async function agentAsk(prompt: string, images?: AgentImage[]): Promise<void> {
  if (agentState.running) return
  agentState.error = null
  agentState.running = true

  const { provider, apiKey, baseUrl, proxyUrl, proxyEnabled, model, system } = agentSettings
  if (!apiKey) {
    chat.push('system', '未配置 API Key。点击对话框右上角齿轮配置。')
    agentState.running = false
    return
  }

  chat.push('user', prompt, images && images.length ? { images: images.map(i => ({ preview: i.preview, media_type: i.media_type })) } : undefined)
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
      images: images && images.length ? images.map(i => ({ data: i.data, media_type: i.media_type, detail: 'auto' })) : undefined,
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
      setTimeout(() => { agentAsk(next.text, next.images).catch(() => {}) }, 0)
    }
  }
}
