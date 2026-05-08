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

function buildHistory(): Array<{ role: string; content: string }> {
  return chat.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))
}

function buildTools() {
  const deviceId = deviceHub.currentId.value ?? undefined
  return toolbus.list().map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (input: Record<string, unknown>) => {
      try {
        return await def.execute(input, { deviceId })
      } catch (err) {
        return { error: (err as Error).message }
      }
    },
  }))
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
    // 传历史时排除刚添加的 user 和 assistant 空壳
    const history = buildHistory().slice(0, -1)

    const iter = api.agenticAsk(prompt, {
      provider,
      apiKey,
      baseUrl: baseUrl || undefined,
      proxyUrl: proxyEnabled && proxyUrl ? proxyUrl : undefined,
      model,
      system: `${system}\n\n${desktopPromptBlock()}`,
      tools: buildTools(),
      history: history.slice(0, -1),
      stream: true,
    })

    for await (const event of iter) {
      switch (event.type) {
        case 'text_delta':
          if (typeof event.text === 'string') assistantMsg.content += event.text
          break

        case 'tool_use': {
          const input = event.input ?? {}
          let inputStr: string
          try { inputStr = JSON.stringify(input) } catch { inputStr = String(input) }
          chat.push('tool', `→ ${event.name}(${inputStr})`, {
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
            output: event.output,
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
  }
}
