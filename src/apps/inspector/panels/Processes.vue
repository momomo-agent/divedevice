<script setup lang="ts">
import { ref, computed, onMounted, watch, inject, type Ref } from 'vue'
import type { DeviceAPI, ProcessInfo } from '@/device'
import Treemap from '../components/Treemap.vue'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const procs = ref<ProcessInfo[]>([])
const query = ref('')
const sortBy = ref<'rss' | 'vsz' | 'pid' | 'name'>('rss')
const selected = ref<string | null>(null)
const viewMode = ref<'treemap' | 'list'>('treemap')

async function load() {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    procs.value = await props.device.system.processes()
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

const visible = computed(() => {
  const q = query.value.toLowerCase().trim()
  let list = procs.value
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q))
  list = [...list]
  if (sortBy.value === 'rss') list.sort((a, b) => b.rss - a.rss)
  else if (sortBy.value === 'vsz') list.sort((a, b) => b.vsz - a.vsz)
  else if (sortBy.value === 'pid') list.sort((a, b) => a.pid - b.pid)
  else if (sortBy.value === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
  return list
})

const maxRss = computed(() => visible.value.reduce((m, p) => Math.max(m, p.rss), 1))
const totalRss = computed(() => visible.value.reduce((s, p) => s + p.rss, 0))

// user 统计
const userStats = computed(() => {
  const map = new Map<string, { count: number; rss: number }>()
  for (const p of visible.value) {
    const u = p.user || '?'
    const cur = map.get(u) ?? { count: 0, rss: 0 }
    cur.count++; cur.rss += p.rss
    map.set(u, cur)
  }
  return [...map.entries()].map(([u, v]) => ({ user: u, ...v })).sort((a, b) => b.rss - a.rss)
})

const treemapItems = computed(() =>
  visible.value.slice(0, 40).map((p) => ({
    name: p.name,
    value: p.rss,
    tip: `${p.name}\nPID ${p.pid} · ${p.user}\nRSS ${fmtKb(p.rss)} · VSZ ${fmtKb(p.vsz)}`,
  })),
)

function fmtKb(kb: number) {
  if (kb > 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb > 1024) return (kb / 1024).toFixed(1) + ' MB'
  return kb + ' KB'
}
function onTileClick(name: string) { selected.value = name; query.value = name }
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <!-- 顶部摘要 -->
      <div class="stats-grid">
        <div class="card">
          <div class="lbl">Total Procs</div>
          <div class="num big">{{ procs.length }}</div>
          <div class="muted">{{ visible.length }} 匹配</div>
        </div>
        <div class="card">
          <div class="lbl">Total RSS</div>
          <div class="num big">{{ fmtKb(totalRss) }}</div>
          <div class="muted">所有可见进程</div>
        </div>
        <div class="card">
          <div class="lbl">用户分布</div>
          <div class="user-chips">
            <span v-for="u in userStats.slice(0, 6)" :key="u.user" class="chip">
              {{ u.user }} <b>{{ u.count }}</b>
              <span class="sub">{{ fmtKb(u.rss) }}</span>
            </span>
          </div>
        </div>
      </div>

      <div class="toolbar">
        <input v-model="query" class="search" placeholder="搜索进程名 / PID" style="flex: 1; margin-bottom: 0;" />
        <button class="btn" :class="{ active: viewMode === 'treemap' }" @click="viewMode = 'treemap'">🔲 Treemap</button>
        <button class="btn" :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">☰ List</button>
      </div>

      <template v-if="viewMode === 'treemap'">
        <h3 class="hdr"><span>内存占用 Treemap</span><span class="count">— TOP 40 by RSS，点击搜索</span></h3>
        <Treemap
          :items="treemapItems"
          :width="600"
          :height="300"
          @click="onTileClick"
        />
      </template>

      <template v-else>
        <table>
          <thead>
            <tr>
              <th style="cursor: pointer" @click="sortBy = 'pid'">PID {{ sortBy === 'pid' ? '▾' : '' }}</th>
              <th>USER</th>
              <th style="cursor: pointer" @click="sortBy = 'name'">NAME {{ sortBy === 'name' ? '▾' : '' }}</th>
              <th style="cursor: pointer; text-align: right" @click="sortBy = 'rss'">RSS {{ sortBy === 'rss' ? '▾' : '' }}</th>
              <th style="cursor: pointer; text-align: right" @click="sortBy = 'vsz'">VSZ {{ sortBy === 'vsz' ? '▾' : '' }}</th>
              <th style="width: 130px;">MEM</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in visible.slice(0, 400)" :key="p.pid" :class="{ active: selected === p.name }" @click="selected = p.name">
              <td>{{ p.pid }}</td>
              <td><span class="pill neutral">{{ p.user }}</span></td>
              <td :title="p.name">{{ p.name }}</td>
              <td style="text-align: right">{{ fmtKb(p.rss) }}</td>
              <td style="text-align: right; color: var(--fg-3)">{{ fmtKb(p.vsz) }}</td>
              <td><div class="bar"><div class="fill" :style="{ width: (p.rss / maxRss * 100) + '%' }" /></div></td>
            </tr>
          </tbody>
        </table>
        <div v-if="visible.length > 400" class="hint">仅显示前 400 项</div>
      </template>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.stats-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.card .lbl { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.3px; text-transform: uppercase; margin-bottom: 4px; }
.card .num.big { margin-bottom: 4px; }
.muted { color: var(--fg-3); font-size: 11px; }
.user-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  display: inline-flex; gap: 4px; align-items: baseline;
  font-size: 10.5px; padding: 3px 7px;
  border-radius: 10px;
  background: var(--surface-3);
  color: var(--fg-2);
  font-family: ui-monospace, monospace;
}
.chip b { color: var(--fg-1); font-variant-numeric: tabular-nums; }
.chip .sub { color: var(--fg-3); font-size: 9.5px; margin-left: 2px; }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
</style>
