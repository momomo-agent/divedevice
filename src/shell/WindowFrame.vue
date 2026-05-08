<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { appRegistry, deviceHub, windowManager } from '@/services'
import { WINDOW_CONTEXT_KEY } from '@/composables'
import type { WindowInstance } from '@/types'
import DeviceMenu from './DeviceMenu.vue'

const props = defineProps<{ window: WindowInstance }>()

// 窗口上下文注入（app 通过 useWindow() 拿到）
const windowRef = computed(() => props.window)
provide(WINDOW_CONTEXT_KEY, { window: windowRef })

const manifest = computed(() => appRegistry.get(props.window.appId))

const deviceLabel = computed(() => {
  if (!manifest.value?.requiresDevice) return null
  const id = props.window.deviceId
  if (!id) return '未连接设备'
  const d = deviceHub.devices.value.find((x) => x.id === id)
  return d?.name ?? id
})

const showDeviceMenu = ref(false)

function onHeaderMouseDown(ev: MouseEvent) {
  if ((ev.target as HTMLElement).closest('.device-chip')) return
  windowManager.focus(props.window.id)
  const startX = ev.clientX
  const startY = ev.clientY
  const origX = props.window.frame.x
  const origY = props.window.frame.y
  const onMove = (e: MouseEvent) => {
    windowManager.setFrame(props.window.id, {
      x: origX + (e.clientX - startX),
      y: origY + (e.clientY - startY),
    })
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onResizeStart(ev: MouseEvent) {
  ev.stopPropagation()
  const startX = ev.clientX
  const startY = ev.clientY
  const origW = props.window.frame.width
  const origH = props.window.frame.height
  const minW = manifest.value?.windowDefaults.minWidth ?? 320
  const minH = manifest.value?.windowDefaults.minHeight ?? 200
  const onMove = (e: MouseEvent) => {
    windowManager.setFrame(props.window.id, {
      width: Math.max(minW, origW + (e.clientX - startX)),
      height: Math.max(minH, origH + (e.clientY - startY)),
    })
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onSelectDevice(id: string | null) {
  windowManager.setDevice(props.window.id, id)
  showDeviceMenu.value = false
}
</script>

<template>
  <div
    class="window"
    :style="{
      left: `${window.frame.x}px`,
      top: `${window.frame.y}px`,
      width: `${window.frame.width}px`,
      height: `${window.frame.height}px`,
      zIndex: window.zIndex,
    }"
    @mousedown="windowManager.focus(window.id)"
  >
    <header class="titlebar" @mousedown="onHeaderMouseDown">
      <div class="traffic">
        <button class="dot close" @click.stop="windowManager.close(window.id)" />
      </div>
      <div class="title">
        <span class="icon">{{ manifest?.icon }}</span>
        <span class="name">{{ window.title }}</span>
        <div v-if="deviceLabel" class="device-chip" @click.stop="showDeviceMenu = !showDeviceMenu">
          <span>{{ deviceLabel }}</span>
          <span class="chevron">▾</span>
          <DeviceMenu
            v-if="showDeviceMenu"
            :current-id="window.deviceId"
            @select="onSelectDevice"
            @close="showDeviceMenu = false"
          />
        </div>
      </div>
      <div class="spacer" />
    </header>
    <main class="body">
      <component :is="manifest?.component" v-bind="window.props" />
    </main>
    <div class="resize-handle" @mousedown="onResizeStart" />
  </div>
</template>

<style scoped>
.window {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--surface-1);
  border-radius: 10px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.titlebar {
  height: 34px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  background: var(--surface-2);
  cursor: default;
  user-select: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.traffic {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  padding: 0;
}
.dot.close { background: #ff5f57; }
.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--fg-1);
  font-weight: 500;
}
.title .icon { font-size: 14px; }
.device-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  font-size: 11px;
  color: var(--fg-2);
  cursor: pointer;
  margin-left: 4px;
}
.device-chip:hover { background: rgba(255, 255, 255, 0.14); }
.chevron { font-size: 9px; opacity: 0.7; }
.spacer { flex: 1; }
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--surface-1);
  color: var(--fg-1);
}
.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}
</style>
