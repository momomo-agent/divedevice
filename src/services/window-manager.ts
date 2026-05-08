/**
 * WindowManager —— 窗口生命周期管理
 * 响应式 state，所有 UI 观察这里。
 */
import { reactive, readonly } from 'vue'
import { appRegistry } from './app-registry'
import { eventBus } from './eventbus'
import { deviceHub } from './device-hub'
import type { WindowFrame, WindowInstance } from '@/types'

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
    return win
  },

  close(id: string) {
    const idx = state.windows.findIndex((w) => w.id === id)
    if (idx < 0) return
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
}
