/**
 * Agent 设置存储（localStorage）
 */
import { reactive, watch } from 'vue'

export interface AgentSettings {
  provider: 'anthropic' | 'openai'
  apiKey: string
  baseUrl: string
  proxyUrl: string
  model: string
  system: string
}

const KEY = 'divedevice.agent.settings'

const defaults: AgentSettings = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  proxyUrl: '',
  model: 'claude-sonnet-4-5-20250929',
  system:
    '你是 DiveDevice 内置的 Agent，运行在 Web OS 壳中，可以操控通过 WebADB 连接的 Android 设备。用户当前已选中一个设备，所有设备类工具会自动作用于它。用中文回答。',
}

function load(): AgentSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return { ...defaults }
  }
}

export const agentSettings = reactive<AgentSettings>(load())

watch(
  () => ({ ...agentSettings }),
  (v) => {
    try { localStorage.setItem(KEY, JSON.stringify(v)) } catch {}
  },
  { deep: true },
)
