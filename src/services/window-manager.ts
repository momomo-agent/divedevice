/**
 * WindowManager —— 窗口生命周期管理
 * 响应式 state，所有 UI 观察这里。
 */
import { reactive, readonly } from 'vue'
import { appRegistry } from './app-registry'
import { eventBus } from './eventbus'
import { deviceHub } from './device-hub'
import type { WindowFrame, WindowInstance } from '@/types'

// ---- Frame 持久化 ----
// 直接用 IndexedDB（通过 agentic-store）存每个 appId 的上次 frame。
// 不用 usePersistedState（那是 composable，需要 setup context）。
interface FrameStore {
  save(appId: string, frame: WindowFrame): void
  load(appId: string): Promise<WindowFrame | null>
}

const frameStore: FrameStore = (() => {
  let ai: { save: (k: string, v: unknown) => Promise<void>; load: (k: string) => Promise<unknown> } | null = null
  const pending = new Map<string, number>() // debounce timers

  function getAi() {
    if (ai) return ai
    const G = (globalThis as unknown as { Agentic?: { Agentic: new (o?: Record<string, unknown>) => typeof ai } }).Agentic
    if (!G) return null
    ai = new G.Agentic({ store: { name: 'windowFrames' } }) as typeof ai
    return ai
  }

  return {
    save(appId: string, frame: WindowFrame) {
      const prev = pending.get(appId)
      if (prev) clearTimeout(prev)
      pending.set(appId, window.setTimeout(async () => {
        pending.delete(appId)
        try { await getAi()?.save(appId, { ...frame }) } catch { /* 忽略 */ }
      }, 120) as unknown as number)
    },
    async load(appId: string): Promise<WindowFrame | null> {
      try {
        const v = await getAi()?.load(appId)
        if (v && typeof v === 'object' && 'x' in (v as object)) return v as WindowFrame
      } catch { /* 忽略 */ }
      return null
    },
  }
})()

interface State {
  windows: WindowInstance[]
  focusedId: string | null
  nextZ: number
}

const state = reactive<State>({
  windows: [],
  focusedId: null,
  nextZ: 10,
})

let _wid = 0
const nextWindowId = () => `w${++_wid}`

function defaultFrame(appDefaults: { width: number; height: number }): WindowFrame {
  // 简单错开布局
  const count = state.windows.length
  const offset = (count % 8) * 28
  return {
    x: 120 + offset,
    y: 80 + offset,
    width: appDefaults.width,
    height: appDefaults.height,
  }
}

export interface OpenWindowOptions {
  appId: string
  deviceId?: string | null
  title?: string
  props?: Record<string, unknown>
  frame?: Partial<WindowFrame>
}

export const windowManager = {
  windows: readonly(state.windows) as unknown as readonly WindowInstance[],

  get focusedId() {
    return state.focusedId
  },

  open(opts: OpenWindowOptions): WindowInstance {
    const app = appRegistry.get(opts.appId)
    if (!app) throw new Error(`Unknown app: ${opts.appId}`)

    const deviceId = app.requiresDevice
      ? (opts.deviceId ?? deviceHub.currentId.value ?? null)
      : null

    const baseFrame = defaultFrame(app.windowDefaults)
    const frame: WindowFrame = { ...baseFrame, ...(opts.frame ?? {}) }

    const id = nextWindowId()
    const win: WindowInstance = {
      id,
      appId: app.id,
      deviceId,
      title: opts.title ?? app.name,
      frame,
      state: 'normal',
      zIndex: ++state.nextZ,
      props: opts.props,
      createdAt: Date.now(),
    }

    state.windows.push(win)
    state.focusedId = id
    eventBus.emit('window.opened', { window: win })

    // 异步恢复上次 frame（不阻塞打开，IndexedDB 读取 <5ms）
    if (!opts.frame) {
      frameStore.load(app.id).then((saved) => {
        if (saved && state.windows.includes(win)) {
          // clamp 到当前 viewport
          const vw = globalThis.innerWidth ?? 1280
          const vh = globalThis.innerHeight ?? 800
          const minW = app.windowDefaults.minWidth ?? 320
          const minH = app.windowDefaults.minHeight ?? 200
          saved.width = Math.max(minW, Math.min(saved.width, vw - 60))
          saved.height = Math.max(minH, Math.min(saved.height, vh - 60))
          saved.x = Math.max(0, Math.min(saved.x, vw - saved.width))
          saved.y = Math.max(0, Math.min(saved.y, vh - saved.height))
          Object.assign(win.frame, saved)
        }
      })
    }

    return win
  },

  close(id: string) {
    const idx = state.windows.findIndex((w) => w.id === id)
    if (idx < 0) return
    const win = state.windows[idx]
    // 关窗前立即存 frame
    frameStore.save(win.appId, { ...win.frame })
    state.windows.splice(idx, 1)
    if (state.focusedId === id) {
      state.focusedId = state.windows.length
        ? state.windows[state.windows.length - 1].id
        : null
    }
    eventBus.emit('window.closed', { windowId: id })
  },

  focus(id: string) {
    const w = state.windows.find((x) => x.id === id)
    if (!w) return
    w.zIndex = ++state.nextZ
    state.focusedId = id
    eventBus.emit('window.focused', { windowId: id })
  },

  setFrame(id: string, patch: Partial<WindowFrame>) {
    const w = state.windows.find((x) => x.id === id)
    if (!w) return
    Object.assign(w.frame, patch)
    // debounce 存回
    frameStore.save(w.appId, { ...w.frame })
  },

  setTitle(id: string, title: string) {
    const w = state.windows.find((x) => x.id === id)
    if (!w) return
    w.title = title
  },

  setDevice(id: string, deviceId: string | null) {
    const w = state.windows.find((x) => x.id === id)
    if (!w) return
    w.deviceId = deviceId
  },

  /** 查找符合 appId + deviceId 的已有窗口（最新聚焦的优先）。*/
  findByApp(appId: string, deviceId?: string | null): WindowInstance | undefined {
    const matches = state.windows.filter((w) => w.appId === appId
      && (deviceId === undefined || w.deviceId === deviceId))
    if (!matches.length) return undefined
    // 返回 zIndex 最高（最近聚焦/当前在上）
    return matches.reduce((a, b) => a.zIndex >= b.zIndex ? a : b)
  },
}
