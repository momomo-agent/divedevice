<script setup lang="ts">
/**
 * 全局设备状态栏 —— 桌面右上角固定悬浮。
 * 始终可见（无论窗口/对话面板状态）。
 * 展示当前选中的设备 + 列表下拉（复用 DeviceMenu）。
 */
import { ref, computed, onBeforeUnmount } from 'vue'
import { deviceHub } from '@/services'
import DeviceMenu from './DeviceMenu.vue'

const props = defineProps<{ rightInset?: number }>()
const rightPx = computed(() => `${(props.rightInset ?? 0) + 12}px`)

const open = ref(false)
const current = computed(() =>
  deviceHub.devices.value.find((d) => d.id === deviceHub.currentId.value) ?? null,
)
const deviceCount = computed(() => deviceHub.devices.value.length)

function onSelect(id: string | null) {
  deviceHub.setCurrent(id)
  open.value = false
}

function onDoc(e: MouseEvent) {
  const el = document.querySelector('.device-statusbar')
  if (el && !el.contains(e.target as Node)) open.value = false
}
document.addEventListener('mousedown', onDoc)
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))
</script>

<template>
  <div class="device-statusbar" :style="{ right: rightPx }">
    <button class="chip" :class="{ on: !!current }" @click="open = !open">
      <span class="dot" :class="{ live: !!current }" />
      <span class="name" v-if="current">{{ current.name }}</span>
      <span class="name muted" v-else-if="deviceCount">选择设备</span>
      <span class="name muted" v-else>未连接设备</span>
      <span v-if="deviceCount > 1" class="badge">{{ deviceCount }}</span>
      <span class="chevron">▾</span>
    </button>
    <DeviceMenu
      v-if="open"
      :current-id="deviceHub.currentId.value"
      @select="onSelect"
      @close="open = false"
    />
  </div>
</template>

<style scoped>
.device-statusbar {
  position: fixed;
  top: 12px;
  z-index: 1500;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1;
  color: var(--fg-2);
  background: rgba(28, 31, 38, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.chip:hover { background: rgba(40, 45, 55, 0.88); border-color: rgba(255, 255, 255, 0.14); }
.chip.on { color: var(--fg-1); }
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(160, 160, 160, 0.6);
  flex-shrink: 0;
}
.dot.live {
  background: #5eead4;
  box-shadow: 0 0 8px rgba(94, 234, 212, 0.55);
}
.name { white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.name.muted { color: var(--fg-3); }
.badge {
  background: rgba(99, 163, 255, 0.28);
  color: var(--fg-1);
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  min-width: 16px;
  text-align: center;
}
.chevron { color: var(--fg-3); font-size: 10px; }

/* DeviceMenu 在 chip 下方，右对齐 */
.device-statusbar :deep(.menu) {
  top: calc(100% + 6px);
  right: 0;
  left: auto;
}
</style>
