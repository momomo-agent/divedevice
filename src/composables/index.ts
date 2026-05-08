/**
 * 给 app Window 组件用的 composables。
 * App 只能通过这些 use* 拿到依赖，隔离实现。
 */
import { computed, inject } from 'vue'
import type { ComputedRef } from 'vue'
import { deviceHub } from '@/services/device-hub'
import { windowManager } from '@/services/window-manager'
import { toolbus } from '@/services/toolbus'
import { eventBus } from '@/services/eventbus'
import { chat } from '@/services/chat'
import type { DeviceAPI } from '@/device'
import type { WindowInstance } from '@/types'

export const WINDOW_CONTEXT_KEY = Symbol('divedevice:window')

/** 由 WindowFrame 组件 provide */
export interface WindowContext {
  window: ComputedRef<WindowInstance>
}

export function useWindow(): WindowContext {
  const ctx = inject<WindowContext | null>(WINDOW_CONTEXT_KEY, null)
  if (!ctx) throw new Error('useWindow() must be called inside a window component')
  return ctx
}

/** 当前窗口绑定设备的 L2 API（响应式） */
export function useDevice(): ComputedRef<DeviceAPI | undefined> {
  const { window } = useWindow()
  return computed(() => deviceHub.api(window.value.deviceId))
}

export function useWindowManager() {
  return windowManager
}

export function useToolbus() {
  return toolbus
}

export function useEventbus() {
  return eventBus
}

export function useChat() {
  return chat
}

export function useDeviceHub() {
  return deviceHub
}
