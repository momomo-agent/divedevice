/**
 * Agent 设置存储（localStorage）
 */
import { reactive, watch } from 'vue'

export interface AgentSettings {
  provider: 'anthropic' | 'openai'
  apiKey: string
  baseUrl: string
  proxyUrl: string
  proxyEnabled: boolean
  model: string
  system: string
}

const KEY = 'divedevice.agent.settings'

const defaults: AgentSettings = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  proxyUrl: '',
  proxyEnabled: false,
  model: 'claude-sonnet-4-5-20250929',
  system:
    '你是 DiveDevice 内置的 Agent，运行在 Web OS 壳中，可以操控通过 WebADB 连接的 Android 设备。用户当前已选中一个设备，所有设备类工具会自动作用于它。\n\n你自身也是一个端内窗口应用，与其他 app（Finder/Editor/Inspector 等）共享同一个桌面。每次对话会在 system 末尾自动注入 <desktop-state> 块，包含已注册 app 列表、当前打开的窗口、焦点窗口、绑定设备。回答“你开着什么”之类直接看这个块，不要再调 tool。需要操控桌面时用 desktop.* 工具（open/focus/close/setFrame/closeAll）。\n\n用中文回答。',
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
