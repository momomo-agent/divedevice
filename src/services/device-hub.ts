/**
 * Device Hub —— transport 层连接 ↔ L2 Device API 的桥梁。
 * 对 UI 暴露响应式的 deviceList + currentDeviceId。
 */
import { ref, computed } from 'vue'
import { transportManager } from '@/transport'
import { getOrCreateDevice, removeDevice, type DeviceAPI } from '@/device'
import type { DeviceInfo } from '@/types'
import { eventBus } from './eventbus'

const _devices = ref<DeviceInfo[]>([])
const _currentId = ref<string | null>(null)

transportManager.onChange((conns) => {
  const infos = conns.map((c) => c.info)
  const prevIds = new Set(_devices.value.map((d) => d.id))
  const nextIds = new Set(infos.map((i) => i.id))

  // 新连接 → 创建 L2 API + 事件
  for (const c of conns) {
    if (!prevIds.has(c.info.id)) {
      getOrCreateDevice(c)
      eventBus.emit('device.connected', { device: c.info })
    }
  }
  // 断开 → 移除 L2 API + 事件
  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      removeDevice(id)
      eventBus.emit('device.disconnected', { deviceId: id })
      if (_currentId.value === id) _currentId.value = null
    }
  }

  _devices.value = infos
  if (!_currentId.value && infos.length) _currentId.value = infos[0].id
})

export const deviceHub = {
  devices: computed(() => _devices.value),
  currentId: computed(() => _currentId.value),

  setCurrent(id: string | null) {
    _currentId.value = id
  },

  /** 取指定（或当前）设备的 L2 API */
  api(id?: string | null): DeviceAPI | undefined {
    const target = id ?? _currentId.value
    if (!target) return undefined
    const conn = transportManager.get(target)
    return conn ? getOrCreateDevice(conn) : undefined
  },

  async requestUsb() {
    return transportManager.requestUsbDevice()
  },

  /** 启动时自动恢复授权过的设备 */
  async bootstrap() {
    try {
      await transportManager.autoReconnectAuthorized()
    } catch (err) {
      console.warn('[deviceHub] bootstrap', err)
    }
  },

  async disconnect(id: string) {
    await transportManager.disconnect(id)
  },
}
