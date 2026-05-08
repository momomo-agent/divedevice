<script setup lang="ts">
import { ref, computed, onMounted, watch, inject, type Ref } from 'vue'
import type { DeviceAPI } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const map = ref<Record<string, string>>({})
const query = ref('')
const activeGroup = ref<string>('')
const viewMode = ref<'grouped' | 'table'>('grouped')

async function load() {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    map.value = await props.device.system.getProps()
    error.value = null
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
const tick = inject<Ref<number>>('inspector:refreshTick')
if (tick) watch(tick, load)

interface Group { key: string; name: string; icon: string; entries: Array<[string, string]> }

const groups = computed<Group[]>(() => {
  const q = query.value.toLowerCase().trim()
  const g: Record<string, Array<[string, string]>> = {}
  for (const [k, v] of Object.entries(map.value)) {
    if (q && !k.toLowerCase().includes(q) && !v.toLowerCase().includes(q)) continue
    let cat = ''
    if (k.startsWith('ro.product.')) cat = 'product'
    else if (k.startsWith('ro.build.')) cat = 'build'
    else if (k.startsWith('ro.boot.')) cat = 'boot'
    else if (k.startsWith('ro.hardware') || k.startsWith('ro.soc')) cat = 'hardware'
    else if (k.startsWith('ro.kernel') || k.startsWith('sys.')) cat = 'kernel'
    else if (k.startsWith('ro.')) cat = 'ro'
    else if (k.startsWith('persist.')) cat = 'persist'
    else if (k.startsWith('debug.')) cat = 'debug'
    else if (k.startsWith('net.')) cat = 'net'
    else if (k.startsWith('dalvik.') || k.startsWith('pm.')) cat = 'runtime'
    else if (k.startsWith('media.')) cat = 'media'
    else if (k.startsWith('gsm.') || k.startsWith('ril.') || k.startsWith('telephony.')) cat = 'telephony'
    else if (k.startsWith('init.') || k.startsWith('service.')) cat = 'init'
    else cat = 'other'
    if (!g[cat]) g[cat] = []
    g[cat].push([k, v])
  }
  const labels: Record<string, { name: string; icon: string }> = {
    product: { name: 'Product',      icon: '📦' },
    build:   { name: 'Build',        icon: '🛠' },
    boot:    { name: 'Boot',         icon: '🚀' },
    hardware:{ name: 'Hardware/SoC', icon: '🧱' },
    kernel:  { name: 'Kernel/Sys',   icon: '🐧' },
    persist: { name: 'Persist',      icon: '💾' },
    debug:   { name: 'Debug',        icon: '🐛' },
    net:     { name: 'Net',          icon: '🌐' },
    runtime: { name: 'Runtime',      icon: '⚙' },
    media:   { name: 'Media',        icon: '🎵' },
    telephony:{ name: 'Telephony',   icon: '📱' },
    init:    { name: 'Init/Service', icon: '🔧' },
    ro:      { name: 'RO (Other)',   icon: '🔐' },
    other:   { name: 'Other',        icon: '📎' },
  }
  const order = ['product', 'build', 'hardware', 'boot', 'kernel', 'runtime', 'media', 'telephony', 'net', 'debug', 'persist', 'init', 'ro', 'other']
  return order
    .filter((k) => g[k]?.length)
    .map((k) => {
      const entries = g[k].sort(([a], [b]) => a.localeCompare(b))
      return { key: k, ...labels[k], entries }
    })
})

const filteredEntries = computed(() => {
  if (!activeGroup.value) return groups.value.flatMap((g) => g.entries)
  return groups.value.find((g) => g.key === activeGroup.value)?.entries ?? []
})

function copy(v: string) { navigator.clipboard?.writeText(v).catch(() => {}) }
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <div class="toolbar">
        <input v-model="query" class="search" placeholder="搜索 key / value（如 ro.build / model）" style="flex: 1; margin-bottom: 0;" />
        <button class="btn" :class="{ active: viewMode === 'grouped' }" @click="viewMode = 'grouped'">🗂 分组</button>
        <button class="btn" :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">☰ Table</button>
      </div>
      <div class="muted">共 {{ Object.keys(map).length }} 条属性 · {{ groups.flatMap(g => g.entries).length }} 条匹配</div>

      <!-- 分组视图 -->
      <template v-if="viewMode === 'grouped'">
        <div class="chips">
          <button class="chip" :class="{ active: !activeGroup }" @click="activeGroup = ''">全部</button>
          <button
            v-for="g in groups"
            :key="g.key"
            class="chip"
            :class="{ active: activeGroup === g.key }"
            @click="activeGroup = activeGroup === g.key ? '' : g.key"
          >{{ g.icon }} {{ g.name }} <b>{{ g.entries.length }}</b></button>
        </div>

        <div class="groups">
          <section v-for="g in (activeGroup ? groups.filter(x => x.key === activeGroup) : groups)" :key="g.key">
            <h3 class="hdr">
              <span>{{ g.icon }} {{ g.name }}</span>
              <span class="count">{{ g.entries.length }} 项</span>
            </h3>
            <div class="grid">
              <div v-for="[k, v] in g.entries" :key="k" class="kv-card" @dblclick="copy(v)" :title="`双击复制: ${v}`">
                <div class="k">{{ k }}</div>
                <div class="v">{{ v || '—' }}</div>
              </div>
            </div>
          </section>
        </div>
      </template>

      <!-- 表格视图 -->
      <template v-else>
        <table>
          <thead><tr><th style="width: 40%;">key</th><th>value</th></tr></thead>
          <tbody>
            <tr v-for="[k, v] in filteredEntries.slice(0, 600)" :key="k" @dblclick="copy(v)" :title="`双击复制: ${v}`">
              <td style="color: var(--fg-2)">{{ k }}</td>
              <td>{{ v || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="filteredEntries.length > 600" class="hint">仅显示前 600 项，继续搜索缩小范围</div>
      </template>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
.muted { color: var(--fg-3); font-size: 11px; margin-bottom: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px;
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  color: var(--fg-2);
  font-size: 11px;
  cursor: pointer;
}
.chip b { color: var(--fg-3); font-weight: 500; margin-left: 3px; font-variant-numeric: tabular-nums; }
.chip:hover { background: var(--surface-3); }
.chip.active { background: rgba(99,163,255,0.22); color: #9ecbff; border-color: rgba(99,163,255,0.4); }
.chip.active b { color: #c9dbf7; }

.groups { display: flex; flex-direction: column; gap: 10px; }
.grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 4px;
}
.kv-card {
  background: var(--surface-2);
  border-radius: 5px;
  padding: 6px 10px;
  cursor: pointer;
  min-width: 0;
}
.kv-card:hover { background: var(--surface-3); }
.k {
  color: var(--fg-3);
  font-size: 10px;
  font-family: ui-monospace, monospace;
  letter-spacing: 0.2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v {
  color: var(--fg-1);
  font-size: 11.5px;
  font-family: ui-monospace, monospace;
  word-break: break-all;
  margin-top: 2px;
  line-height: 1.35;
}
</style>
