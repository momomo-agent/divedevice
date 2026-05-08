<script setup lang="ts">
/**
 * Inspector —— Android 设备调试观察台
 * 多 tab：Overview / Activities / Processes / Layers / Graphics / Battery / Network / Props
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useDevice, useWindow } from '@/composables'
import Overview from './panels/Overview.vue'
import Activities from './panels/Activities.vue'
import Processes from './panels/Processes.vue'
import Layers from './panels/Layers.vue'
import Graphics from './panels/Graphics.vue'
import Battery from './panels/Battery.vue'
import Network from './panels/Network.vue'
import Props from './panels/Props.vue'

const { window: win } = useWindow()
const device = useDevice()

type TabId = 'overview' | 'activities' | 'processes' | 'layers' | 'graphics' | 'battery' | 'network' | 'props'

const tabs: Array<{ id: TabId; label: string; icon: string; comp: any }> = [
  { id: 'overview',   label: 'Overview',   icon: '📊', comp: Overview },
  { id: 'activities', label: 'Activities', icon: '🗂',  comp: Activities },
  { id: 'processes',  label: 'Processes',  icon: '⚙',  comp: Processes },
  { id: 'layers',     label: 'Layers',     icon: '🪟', comp: Layers },
  { id: 'graphics',   label: 'Graphics',   icon: '🎨', comp: Graphics },
  { id: 'battery',    label: 'Battery',    icon: '🔋', comp: Battery },
  { id: 'network',    label: 'Network',    icon: '📡', comp: Network },
  { id: 'props',      label: 'Props',      icon: '🔑', comp: Props },
]

const active = ref<TabId>('overview')
const current = computed(() => tabs.find((t) => t.id === active.value)!)

// ---- Auto-refresh state shared via provide? 简单粗暴：用 key 触发子组件重挂 ----
const refreshKey = ref(0)
const auto = ref(false)
let timer: number | null = null

function startAuto() {
  stopAuto()
  auto.value = true
  timer = window.setInterval(() => { refreshKey.value++ }, 2000) as unknown as number
}
function stopAuto() {
  auto.value = false
  if (timer) { clearInterval(timer); timer = null }
}
function refresh() { refreshKey.value++ }

onBeforeUnmount(stopAuto)
watch(() => win.value.deviceId, () => { refresh() })
</script>

<template>
  <div class="inspector">
    <header class="tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab"
        :class="{ active: t.id === active }"
        @click="active = t.id"
      >
        <span class="ic">{{ t.icon }}</span>
        <span class="lb">{{ t.label }}</span>
      </button>
      <div class="spacer" />
      <button class="icon-btn" @click="refresh" title="刷新">⟳</button>
      <button
        class="icon-btn"
        :class="{ active: auto }"
        @click="auto ? stopAuto() : startAuto()"
        :title="auto ? '停止自动刷新' : '每 2 秒自动刷新'"
      >{{ auto ? '⏸' : '▶' }}</button>
    </header>
    <div class="body">
      <component
        :is="current.comp"
        :key="`${current.id}-${refreshKey}-${win.deviceId ?? ''}`"
        :device="device"
      />
    </div>
  </div>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; height: 100%; background: var(--surface-1); color: var(--fg-1); font-family: system-ui, -apple-system, sans-serif; }

.tabs {
  display: flex; gap: 2px; align-items: center;
  padding: 6px 8px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.tab {
  display: inline-flex; align-items: center; gap: 5px;
  border: none; background: transparent;
  padding: 5px 10px;
  color: var(--fg-3);
  font-size: 12px;
  border-radius: 5px;
  cursor: pointer;
}
.tab:hover { background: rgba(255,255,255,0.04); color: var(--fg-1); }
.tab.active { background: var(--surface-3); color: var(--fg-1); }
.tab .ic { font-size: 12px; }

.spacer { flex: 1; }
.icon-btn {
  width: 26px; height: 26px; border: none;
  background: transparent; color: var(--fg-2);
  border-radius: 5px; cursor: pointer; font-size: 12px;
}
.icon-btn:hover { background: rgba(255,255,255,0.08); color: var(--fg-1); }
.icon-btn.active { background: rgba(99,163,255,0.3); color: #9ecbff; }

.body { flex: 1; min-height: 0; overflow: hidden; }
</style>
