/**
 * Desktop tools —— 让 agent 能感知 + 操控 "自己"（当前打开的 app/窗口/焦点）
 *
 * 系统级工具，不属于任何 app，开机直接注册到 toolbus。
 * 另外 agent.ts 会在每次发送前把 desktop snapshot 挂到 system prompt 尾部，
 * 模型不用调 tool 就能"看见"当前桌面。
 */
import { appRegistry } from './app-registry'
import { windowManager } from './window-manager'
import { deviceHub } from './device-hub'
import { toolbus } from './toolbus'
import { appControllers } from './app-controllers'
import type { ToolDefinition, WindowInstance } from '@/types'

/** 快照：可序列化，既给 tool 返回，也给 system prompt 注入 */
export interface DesktopSnapshot {
  currentDeviceId: string | null
  currentDeviceName: string | null
  apps: Array<{ id: string; name: string; icon: string; requiresDevice: boolean }>
  windows: Array<{
    windowId: string
    appId: string
    appName: string
    title: string
    deviceId: string | null
    focused: boolean
    zIndex: number
    state: string
    frame: { x: number; y: number; width: number; height: number }
    /** 窗口内部自报的状态，由 controller.getState() 提供 */
    inner?: unknown
    /** 支持哪些 desktop.send(event) */
    sendable?: Array<{ name: string; description: string }>
  }>
  focusedWindowId: string | null
}

export function desktopSnapshot(): DesktopSnapshot {
  const currentDevId = deviceHub.currentId.value ?? null
  const currentDev = currentDevId ? deviceHub.devices.value.find((d) => d.id === currentDevId) : null
  const focusedId = windowManager.focusedId
  const wins = [...windowManager.windows]
    .sort((a, b) => b.zIndex - a.zIndex) // 顶上的在前
    .map((w) => {
      const app = appRegistry.get(w.appId)
      const ctrl = appControllers.get(w.id)
      let inner: unknown
      let sendable: Array<{ name: string; description: string }> | undefined
      try {
        if (ctrl?.getState) inner = ctrl.getState()
      } catch (err) {
        inner = { _error: (err as Error).message }
      }
      try {
        if (ctrl?.describe) sendable = ctrl.describe().events
      } catch { /* ignore */ }
      return {
        windowId: w.id,
        appId: w.appId,
        appName: app?.name ?? w.appId,
        title: w.title,
        deviceId: w.deviceId,
        focused: w.id === focusedId,
        zIndex: w.zIndex,
        state: w.state,
        frame: { ...w.frame },
        inner,
        sendable,
      }
    })
  return {
    currentDeviceId: currentDevId,
    currentDeviceName: currentDev?.name ?? null,
    apps: appRegistry.list().map((a) => ({
      id: a.id, name: a.name, icon: a.icon, requiresDevice: a.requiresDevice,
    })),
    windows: wins,
    focusedWindowId: focusedId,
  }
}

/** 给 system prompt 的紧凑版（省 token）*/
export function desktopPromptBlock(): string {
  const s = desktopSnapshot()
  const lines: string[] = ['<desktop-state>']
  lines.push(`device: ${s.currentDeviceName ?? 'none'}${s.currentDeviceId ? ` (${s.currentDeviceId})` : ''}`)
  lines.push(`apps: ${s.apps.map((a) => a.id).join(', ')}`)
  if (!s.windows.length) {
    lines.push('windows: (none open)')
  } else {
    lines.push('windows (from top):')
    for (const w of s.windows) {
      const f = w.focused ? ' *focused*' : ''
      const dev = w.deviceId ? ` dev=${w.deviceId.slice(-4)}` : ''
      lines.push(`  - ${w.windowId} ${w.appId} "${w.title}"${dev}${f}`)
      if (w.inner && typeof w.inner === 'object') {
        try {
          const json = JSON.stringify(w.inner)
          if (json.length <= 200) lines.push(`      state: ${json}`)
          else lines.push(`      state: ${json.slice(0, 200)}…`)
        } catch { /* ignore */ }
      }
      if (w.sendable && w.sendable.length) {
        lines.push(`      sendable: ${w.sendable.map((e) => e.name).join(', ')}`)
      }
    }
  }
  lines.push('</desktop-state>')
  return lines.join('\n')
}

// ============ Tool 定义 ============

const snapshotTool: ToolDefinition = {
  name: 'desktop.snapshot',
  description: '查看当前桌面状态：哪些窗口开着、哪个聚焦、当前设备。返回 JSON 快照（含 windowId，可用于 focus/close）。',
  parameters: { type: 'object', properties: {} },
  async execute() { return desktopSnapshot() },
}

const listAppsTool: ToolDefinition = {
  name: 'desktop.listApps',
  description: '列出所有已注册的 app（dock 里的）。返回数组 [{id,name,icon,requiresDevice}]。',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return appRegistry.list().map((a) => ({
      id: a.id, name: a.name, icon: a.icon, requiresDevice: a.requiresDevice,
    }))
  },
}

const listWindowsTool: ToolDefinition = {
  name: 'desktop.listWindows',
  description: '列出当前打开的窗口（按 zIndex 顶上在前）。',
  parameters: { type: 'object', properties: {} },
  async execute() { return desktopSnapshot().windows },
}

const openTool: ToolDefinition = {
  name: 'desktop.open',
  description: '打开一个 app 窗口。若 app.requiresDevice=true 且已有相同设备的窗口，则直接 focus 不新开（返回该窗口）。可传 props 传初始化参数（如 Editor 的 openPath）。',
  parameters: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: 'AppManifest.id，如 finder/editor/inspector' },
      reuse: { type: 'string', description: '默认 smart：有相同 app+device 窗口就 focus；传 always-new 每次新开' },
      title: { type: 'string', description: '窗口标题（可选）' },
      props: { type: 'object', description: '传给 Window 组件的初始 props' },
    },
    required: ['appId'],
  },
  async execute(args) {
    const appId = String(args.appId)
    const app = appRegistry.get(appId)
    if (!app) throw new Error(`Unknown appId: ${appId}. 可用: ${appRegistry.list().map((a) => a.id).join(', ')}`)
    const reuse = (args.reuse ? String(args.reuse) : 'smart') as 'smart' | 'always-new'
    const devId = app.requiresDevice ? (deviceHub.currentId.value ?? null) : null
    if (reuse === 'smart') {
      const existing = windowManager.findByApp(appId, devId ?? undefined)
      if (existing) {
        windowManager.focus(existing.id)
        return { reused: true, windowId: existing.id, title: existing.title }
      }
    }
    const win = windowManager.open({
      appId,
      deviceId: devId,
      title: args.title ? String(args.title) : undefined,
      props: (args.props && typeof args.props === 'object') ? args.props as Record<string, unknown> : undefined,
    })
    return { reused: false, windowId: win.id, title: win.title }
  },
}

const focusTool: ToolDefinition = {
  name: 'desktop.focus',
  description: '把指定窗口置顶并聚焦。',
  parameters: {
    type: 'object',
    properties: { windowId: { type: 'string' } },
    required: ['windowId'],
  },
  async execute(args) {
    const id = String(args.windowId)
    const ws = [...windowManager.windows] as WindowInstance[]
    if (!ws.some((w) => w.id === id)) throw new Error(`No such window: ${id}`)
    windowManager.focus(id)
    return { ok: true, focusedWindowId: id }
  },
}

const closeTool: ToolDefinition = {
  name: 'desktop.close',
  description: '关闭指定窗口。',
  parameters: {
    type: 'object',
    properties: { windowId: { type: 'string' } },
    required: ['windowId'],
  },
  async execute(args) {
    const id = String(args.windowId)
    const before = [...windowManager.windows] as WindowInstance[]
    if (!before.some((w) => w.id === id)) throw new Error(`No such window: ${id}`)
    windowManager.close(id)
    return { ok: true, closed: id }
  },
}

const setFrameTool: ToolDefinition = {
  name: 'desktop.setFrame',
  description: '修改窗口位置/尺寸。不传的字段保留。',
  parameters: {
    type: 'object',
    properties: {
      windowId: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
      width: { type: 'number' },
      height: { type: 'number' },
    },
    required: ['windowId'],
  },
  async execute(args) {
    const id = String(args.windowId)
    const ws = [...windowManager.windows] as WindowInstance[]
    if (!ws.some((w) => w.id === id)) throw new Error(`No such window: ${id}`)
    const patch: Record<string, number> = {}
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = args[k]
      if (typeof v === 'number' && Number.isFinite(v)) patch[k] = v
    }
    windowManager.setFrame(id, patch as never)
    return { ok: true, windowId: id, patched: patch }
  },
}

const closeAllTool: ToolDefinition = {
  name: 'desktop.closeAll',
  description: '关闭所有窗口（慎用）。可选 appId 只关该 app 的窗口。',
  parameters: {
    type: 'object',
    properties: {
      appId: { type: 'string', description: '可选：只关这个 app 的窗口' },
    },
  },
  async execute(args) {
    const appId = args.appId ? String(args.appId) : null
    const ws = [...windowManager.windows] as WindowInstance[]
    const targets = appId ? ws.filter((w) => w.appId === appId) : ws
    for (const w of targets) windowManager.close(w.id)
    return { ok: true, closedCount: targets.length }
  },
}

const sendTool: ToolDefinition = {
  name: 'desktop.send',
  description: '向一个打开的 app 窗口发送应用内事件，让它切 tab / 跳路径 / 切 panel / 搜索 … 。每个 app 支持的事件表在 desktop.snapshot 的 windows[].sendable 里，或调 desktop.describeApp 单看。定位窗口的两种方式：传 windowId（精准），或传 appId（自动取最上面的那个同类窗口，没就发给所有）。',
  parameters: {
    type: 'object',
    properties: {
      windowId: { type: 'string', description: '优先用：精准找某个窗口' },
      appId: { type: 'string', description: '没希 windowId 时用：按 appId 自动定位。如果有多个同类窗口，默认取 zIndex 最高' },
      event: { type: 'string', description: 'app 内事件名（由 app describe() 声明）' },
      payload: { type: 'object', description: '该事件的参数（每个事件自己约定）' },
      broadcast: { type: 'string', description: 'app 下有多窗口时 「all」：全发；「top」：只发最上面（默认）' },
    },
    required: ['event'],
  },
  async execute(args) {
    const event = String(args.event)
    const payload = (args.payload && typeof args.payload === 'object') ? args.payload as Record<string, unknown> : undefined
    const broadcast = (args.broadcast ? String(args.broadcast) : 'top') as 'top' | 'all'

    // 选窗口
    let targets: string[] = []
    if (args.windowId) {
      const id = String(args.windowId)
      if (!appControllers.get(id)) throw new Error(`No controller for windowId=${id} (window may not be mounted or app doesn't register a controller)`)
      targets = [id]
    } else if (args.appId) {
      const appId = String(args.appId)
      const candidates = appControllers.listByApp(appId)
      if (!candidates.length) throw new Error(`No open window for appId=${appId}. Open it first via desktop.open, then desktop.send.`)
      if (broadcast === 'all') {
        targets = candidates.map((c) => c.windowId)
      } else {
        const top = [...windowManager.windows]
          .filter((w) => w.appId === appId)
          .sort((a, b) => b.zIndex - a.zIndex)[0]
        targets = top ? [top.id] : [candidates[0].windowId]
      }
    } else {
      throw new Error('desktop.send requires either windowId or appId')
    }

    const results: Array<{ windowId: string; ok: boolean; result?: unknown; error?: string }> = []
    for (const wid of targets) {
      const ctrl = appControllers.get(wid)
      if (!ctrl) { results.push({ windowId: wid, ok: false, error: 'controller missing' }); continue }
      if (!ctrl.send) { results.push({ windowId: wid, ok: false, error: `app ${ctrl.appId} does not accept desktop.send` }); continue }
      try {
        const r = await ctrl.send(event, payload)
        results.push({ windowId: wid, ok: true, result: r })
      } catch (err) {
        results.push({ windowId: wid, ok: false, error: (err as Error).message ?? String(err) })
      }
    }
    return { ok: results.every((r) => r.ok), sent: results.length, results }
  },
}

const describeAppTool: ToolDefinition = {
  name: 'desktop.describeApp',
  description: '查看一个 app 的打开窗口当前状态 + 可接收的 desktop.send 事件。可传 windowId 或 appId。',
  parameters: {
    type: 'object',
    properties: {
      windowId: { type: 'string' },
      appId: { type: 'string' },
    },
  },
  async execute(args) {
    let ctrls = [] as ReturnType<typeof appControllers.all>
    if (args.windowId) {
      const c = appControllers.get(String(args.windowId))
      if (c) ctrls = [c]
    } else if (args.appId) {
      ctrls = appControllers.listByApp(String(args.appId))
    } else {
      ctrls = appControllers.all()
    }
    return ctrls.map((c) => ({
      windowId: c.windowId,
      appId: c.appId,
      state: (() => { try { return c.getState?.() } catch (e) { return { _error: (e as Error).message } } })(),
      events: (() => { try { return c.describe?.().events ?? [] } catch { return [] } })(),
    }))
  },
}

export function registerDesktopTools() {
  for (const t of [
    snapshotTool, listAppsTool, listWindowsTool,
    openTool, focusTool, closeTool, setFrameTool, closeAllTool,
    sendTool, describeAppTool,
  ]) {
    toolbus.register(t, 'desktop')
  }
}
