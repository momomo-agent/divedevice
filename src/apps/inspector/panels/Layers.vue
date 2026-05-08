<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DeviceAPI, LayerInfo } from '@/device'
import Donut from '../components/Donut.vue'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const layers = ref<LayerInfo | null>(null)
const query = ref('')
const onlyVisible = ref(false)
const viewMode = ref<'stack' | 'list'>('stack')

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    layers.value = await props.device.system.layers()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  if (!layers.value) return []
  let list = layers.value.layers
  if (onlyVisible.value) list = list.filter((l) => l.visible)
  const q = query.value.toLowerCase().trim()
  if (q) list = list.filter((l) => l.name.toLowerCase().includes(q))
  return list
})

const visiblePercent = computed(() => {
  if (!layers.value || !layers.value.total) return 0
  return layers.value.visible / layers.value.total * 100
})

// 为 z-stack 分组：按 display / package 前缀简化名
function simplifyName(n: string): string {
  // SurfaceView - com.xxx.xxx#0 → SurfaceView com.xxx.xxx
  return n.replace(/#\d+$/, '').replace(/ - /g, ' · ').slice(0, 64)
}
function hueFor(n: string): number {
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0
  return h % 360
}
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else-if="layers">
      <!-- Hero:  visible ratio -->
      <div class="hero">
        <Donut
          :percent="visiblePercent"
          :label="String(layers.visible)"
          :sublabel="`/ ${layers.total}`"
          color="#9ecbff"
          :size="110"
          :thickness="10"
        />
        <div class="hero-info">
          <h3 style="margin: 0 0 4px;">SurfaceFlinger</h3>
          <div class="muted">共 {{ layers.total }} 层 · {{ layers.visible }} 可见 ({{ Math.round(visiblePercent) }}%)</div>
          <div class="pill-row" style="margin-top: 8px;">
            <span class="pill good">{{ layers.visible }} visible</span>
            <span class="pill neutral">{{ layers.total - layers.visible }} hidden</span>
          </div>
        </div>
      </div>

      <div class="toolbar">
        <input v-model="query" class="search" placeholder="搜索 layer 名" style="flex: 1; margin-bottom: 0;" />
        <label class="chk">
          <input type="checkbox" v-model="onlyVisible" /> 仅 Visible
        </label>
        <button class="btn" :class="{ active: viewMode === 'stack' }" @click="viewMode = 'stack'">📚 Z-stack</button>
        <button class="btn" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">☰ List</button>
      </div>

      <template v-if="viewMode === 'stack'">
        <h3 class="hdr"><span>Z 方向堆栈</span><span class="count">— 自上而下（最上层在顶部）</span></h3>
        <div class="stack">
          <div
            v-for="(l, i) in filtered.slice(0, 120)"
            :key="i"
            class="layer"
            :class="{ hidden: !l.visible }"
            :style="{ background: `linear-gradient(90deg, hsl(${hueFor(l.name)} 45% ${l.visible ? 40 : 22}% / 0.6), hsl(${hueFor(l.name)} 45% ${l.visible ? 55 : 28}% / 0.3))` }"
          >
            <span class="idx">{{ i }}</span>
            <span class="name" :title="l.name">{{ simplifyName(l.name) }}</span>
            <span class="dot" :class="{ on: l.visible }" />
          </div>
        </div>
        <div v-if="filtered.length > 120" class="hint">仅渲染前 120 层，用搜索过滤查看更多。</div>
      </template>

      <template v-else>
        <table>
          <thead>
            <tr><th style="width: 40px;">#</th><th>Layer</th><th style="width: 70px;">Visible</th></tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in filtered.slice(0, 500)" :key="l.name + i">
              <td style="color: var(--fg-3)">{{ i }}</td>
              <td :title="l.name">{{ l.name }}</td>
              <td>
                <span v-if="l.visible" class="pill good">●</span>
                <span v-else class="pill neutral">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="filtered.length > 500" class="hint">仅显示前 500 项</div>
      </template>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.hero {
  display: flex; align-items: center; gap: 20px;
  padding: 14px 16px;
  background: var(--surface-2);
  border-radius: 10px;
  margin-bottom: 12px;
}
.hero-info { flex: 1; }
.muted { color: var(--fg-3); font-size: 11.5px; }
.pill-row { display: flex; gap: 6px; }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.chk {
  font-size: 11.5px; color: var(--fg-3);
  display: inline-flex; gap: 4px; align-items: center;
  user-select: none; cursor: pointer;
  padding: 4px 8px; background: var(--surface-3); border-radius: 4px;
}
.chk input { margin: 0; }

.stack { display: flex; flex-direction: column; gap: 2px; }
.layer {
  display: grid;
  grid-template-columns: 30px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 5px 10px;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--fg-1);
  min-height: 22px;
}
.layer.hidden { opacity: 0.5; }
.layer .idx { color: rgba(255,255,255,0.55); font-variant-numeric: tabular-nums; text-align: right; }
.layer .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer .dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.2); }
.layer .dot.on { background: #7ee6a6; box-shadow: 0 0 0 2px rgba(126,230,166,0.2); }
</style>
