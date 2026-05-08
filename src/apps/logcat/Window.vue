<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick, computed, watch, shallowRef } from 'vue'
import { useDevice, useWindow, useAppController } from '@/composables'
import type { SpawnedProcess, ProcessInfo } from '@/device'

const { window: win } = useWindow()
const device = useDevice()

type Buffer = 'main' | 'system' | 'crash' | 'events' | 'radio' | 'all'
type Preset = null | 'foreground' | 'errors' | 'crashes' | 'anr' | 'choreographer'

interface LogLine {
  id: number
  text: string
  level: string    // V/D/I/W/E/F
  tag: string      // "" if 解析失败
  pid: number      // 0 if 解析失败
}

const lines = ref<LogLine[]>([])
const filter = ref('')
const autoScroll = ref(true)
const levels = ref({ V: true, D: true, I: true, W: true, E: true, F: true })
const paused = ref(false)
const status = ref('未启动')
const listRef = ref<HTMLDivElement | null>(null)
const MAX_LINES = 3000

// Sidebar 状态
const sidebarOpen = ref(true)
const buffer = ref<Buffer>('main')
const preset = ref<Preset>(null)
const selectedTag = ref<string | null>(null)
const selectedPid = ref<number | null>(null)
const foregroundPkg = ref<string | null>(null)
const pidToPkg = shallowRef<Map<number, string>>(new Map())

// 统计：tag → count, pid → count （基于当前 buffer 的累计 lines）
const tagStats = computed<Array<[string, number]>>(() => {
  const m = new Map<string, number>()
  for (const l of lines.value) {
    if (!l.tag) continue
    m.set(l.tag, (m.get(l.tag) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
})
const pidStats = computed<Array<[number, number, string]>>(() => {
  const m = new Map<number, number>()
  for (const l of lines.value) {
    if (!l.pid) continue
    m.set(l.pid, (m.get(l.pid) ?? 0) + 1)
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([pid, cnt]) => [pid, cnt, pidToPkg.value.get(pid) ?? ''] as [number, number, string])
})

let proc: SpawnedProcess | null = null
let buf = ''
let id = 0

/**
 * 解析 logcat threadtime/time/brief 行，提取 level / tag / pid。
 * threadtime: "05-08 14:23:15.123  1234  5678 I ActivityManager: ..."
 * time:       "05-08 14:23:15.123 I/ActivityManager(1234): ..."
 * brief:      "I/ActivityManager(1234): ..."
 */
function parseLine(text: string): { level: string; tag: string; pid: number } {
  // threadtime（默认）
  let m = text.match(/^\d+-\d+ +\d+:\d+:\d+\.\d+ +(\d+) +\d+ +([VDIWEF]) +([^:]+?):/)
  if (m) return { pid: Number(m[1]), level: m[2], tag: m[3].trim() }
  // time
  m = text.match(/^\d+-\d+ +\d+:\d+:\d+\.\d+ +([VDIWEF])\/([^(]+)\( *(\d+)\):/)
  if (m) return { level: m[1], tag: m[2].trim(), pid: Number(m[3]) }
  // brief
  m = text.match(/^([VDIWEF])\/([^(]+)\( *(\d+)\):/)
  if (m) return { level: m[1], tag: m[2].trim(), pid: Number(m[3]) }
  return { level: 'I', tag: '', pid: 0 }
}

function append(text: string) {
  if (paused.value) return
  const { level, tag, pid } = parseLine(text)
  lines.value.push({ id: ++id, text, level, tag, pid })
  if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
}

async function start() {
  if (!device.value) { status.value = '未连接设备'; return }
  await stop()
  status.value = `订阅 logcat [${buffer.value}]…`
  try {
    proc = await device.value.log.spawn({ buffer: buffer.value === 'main' ? undefined : buffer.value })
    status.value = `实时 · ${buffer.value}`
    ;(async () => {
      const reader = proc!.stdout.getReader()
      const dec = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n')
        buf = parts.pop() ?? ''
        for (const p of parts) if (p) append(p)
        if (autoScroll.value) await nextTick(() => {
          listRef.value?.scrollTo({ top: listRef.value.scrollHeight })
        })
      }
    })().catch((err) => console.error('[logcat]', err))
  } catch (err) {
    status.value = (err as Error).message
  }
}

async function stop() {
  if (proc) {
    try { await proc.kill() } catch {}
    proc = null
  }
}

function clear() { lines.value = [] }

async function switchBuffer(b: Buffer) {
  if (b === buffer.value) return
  buffer.value = b
  lines.value = []
  buf = ''
  await start()
}

// 预设过滤
async function refreshForegroundPkg() {
  if (!device.value) return
  try {
    const t = await device.value.system.topActivity().catch(() => null)
    foregroundPkg.value = t?.packageName ?? null
  } catch {}
}
async function refreshPidMap() {
  if (!device.value) return
  try {
    const ps: ProcessInfo[] = await device.value.system.processes().catch(() => [])
    const m = new Map<number, string>()
    for (const p of ps) m.set(p.pid, p.name)
    pidToPkg.value = m
  } catch {}
}

function applyPreset(p: Preset) {
  preset.value = p
  selectedTag.value = null
  selectedPid.value = null
  filter.value = ''
  if (p === 'foreground') {
    // 用前台包名匹配 process name；在 filtered 里兜住
  } else if (p === 'errors') {
    levels.value = { V: false, D: false, I: false, W: false, E: true, F: true }
  } else if (p === 'crashes') {
    filter.value = 'AndroidRuntime'
  } else if (p === 'anr') {
    filter.value = 'ANR in'
  } else if (p === 'choreographer') {
    selectedTag.value = 'Choreographer'
  } else {
    // 重置
    levels.value = { V: true, D: true, I: true, W: true, E: true, F: true }
  }
}

function toggleTag(tag: string) {
  selectedTag.value = selectedTag.value === tag ? null : tag
}
function togglePid(pid: number) {
  selectedPid.value = selectedPid.value === pid ? null : pid
}

const filtered = computed(() => {
  const f = filter.value.toLowerCase()
  const fg = foregroundPkg.value
  return lines.value.filter((l) => {
    if (!levels.value[l.level as keyof typeof levels.value]) return false
    if (f && !l.text.toLowerCase().includes(f)) return false
    if (selectedTag.value && l.tag !== selectedTag.value) return false
    if (selectedPid.value && l.pid !== selectedPid.value) return false
    if (preset.value === 'foreground' && fg) {
      const name = pidToPkg.value.get(l.pid) ?? ''
      if (!name.startsWith(fg)) return false
    }
    return true
  })
})

function colorOf(level: string): string {
  switch (level) {
    case 'V': return '#808a9a'
    case 'D': return '#63a3ff'
    case 'I': return '#5eead4'
    case 'W': return '#fbbf24'
    case 'E': return '#f87171'
    case 'F': return '#dc2626'
    default: return '#9ca3af'
  }
}
function isLineSelected(l: LogLine): boolean {
  if (selectedTag.value && l.tag === selectedTag.value) return true
  if (selectedPid.value && l.pid === selectedPid.value) return true
  return false
}

onMounted(async () => {
  await refreshPidMap()
  await refreshForegroundPkg()
  await start()
})
onBeforeUnmount(stop)
watch(() => win.value.deviceId, async () => {
  lines.value = []
  await refreshPidMap()
  await refreshForegroundPkg()
  await start()
})
// 每 10 秒刷一次 pid→pkg 映射（新启动的 app 能解析出来）
let pidRefreshTimer: number | null = null
onMounted(() => {
  pidRefreshTimer = window.setInterval(refreshPidMap, 10000) as unknown as number
})
onBeforeUnmount(() => { if (pidRefreshTimer) clearInterval(pidRefreshTimer) })

useAppController({
  getState: () => ({
    paused: paused.value,
    filter: filter.value,
    levels: { ...levels.value },
    autoScroll: autoScroll.value,
    lineCount: lines.value.length,
    filteredCount: filtered.value.length,
    buffer: buffer.value,
    preset: preset.value,
    selectedTag: selectedTag.value,
    selectedPid: selectedPid.value,
    sidebarOpen: sidebarOpen.value,
  }),
  describe: () => ({
    events: [
      { name: 'setFilter', description: 'Set substring filter. payload: {query: string}' },
      { name: 'setLevels', description: 'Enable/disable levels. payload: {levels: {V?,D?,I?,W?,E?,F?: boolean}}' },
      { name: 'pause', description: 'Pause tailing' },
      { name: 'resume', description: 'Resume tailing' },
      { name: 'clear', description: 'Clear local buffer' },
      { name: 'autoScroll', description: 'Toggle auto scroll. payload: {enabled: boolean}' },
      { name: 'setBuffer', description: 'Switch logcat buffer. payload: {buffer: "main"|"system"|"crash"|"events"|"radio"|"all"}' },
      { name: 'preset', description: 'Apply preset filter. payload: {preset: null|"foreground"|"errors"|"crashes"|"anr"|"choreographer"}' },
      { name: 'selectTag', description: 'Filter to a tag (toggle). payload: {tag: string|null}' },
      { name: 'selectPid', description: 'Filter to a pid (toggle). payload: {pid: number|null}' },
      { name: 'toggleSidebar', description: 'payload: {open?: boolean}' },
    ],
  }),
  send(event, payload) {
    const p = (payload ?? {}) as Record<string, unknown>
    switch (event) {
      case 'setFilter': filter.value = String(p.query ?? ''); return { ok: true, filter: filter.value }
      case 'setLevels': {
        const incoming = (p.levels ?? {}) as Record<string, unknown>
        for (const k of Object.keys(levels.value) as Array<keyof typeof levels.value>) {
          if (k in incoming) levels.value[k] = !!incoming[k]
        }
        return { ok: true, levels: { ...levels.value } }
      }
      case 'pause': paused.value = true; return { ok: true }
      case 'resume': paused.value = false; return { ok: true }
      case 'clear': clear(); return { ok: true }
      case 'autoScroll': autoScroll.value = !!p.enabled; return { ok: true, autoScroll: autoScroll.value }
      case 'setBuffer': {
        const b = String(p.buffer ?? 'main') as Buffer
        if (!['main', 'system', 'crash', 'events', 'radio', 'all'].includes(b)) {
          throw new Error(`invalid buffer: ${b}`)
        }
        switchBuffer(b)
        return { ok: true, buffer: buffer.value }
      }
      case 'preset': {
        applyPreset((p.preset as Preset) ?? null)
        return { ok: true, preset: preset.value }
      }
      case 'selectTag': {
        selectedTag.value = p.tag === null || p.tag === undefined ? null : String(p.tag)
        return { ok: true, selectedTag: selectedTag.value }
      }
      case 'selectPid': {
        selectedPid.value = p.pid === null || p.pid === undefined ? null : Number(p.pid)
        return { ok: true, selectedPid: selectedPid.value }
      }
      case 'toggleSidebar':
        sidebarOpen.value = 'open' in p ? !!p.open : !sidebarOpen.value
        return { ok: true, sidebarOpen: sidebarOpen.value }
      default: throw new Error(`Unknown logcat event: ${event}`)
    }
  },
})
</script>

<template>
  <div class="logcat">
    <aside v-if="sidebarOpen" class="sidebar">
      <div class="side-head">
        <span class="side-title">Logcat</span>
        <button class="collapse" title="收起侧栏" @click="sidebarOpen = false">←</button>
      </div>
      <section class="sec">
        <h4>Buffer</h4>
        <div class="buffer-row">
          <button
            v-for="b in (['main','system','crash','events','radio','all'] as Buffer[])"
            :key="b"
            class="chip"
            :class="{ active: buffer === b }"
            @click="switchBuffer(b)"
          >{{ b }}</button>
        </div>
      </section>

      <section class="sec">
        <h4>预设过滤</h4>
        <button class="preset" :class="{ active: preset === 'foreground' }" @click="applyPreset(preset === 'foreground' ? null : 'foreground')">
          <span class="emo">⚡</span>
          <span class="lb">当前前台 app</span>
          <span class="meta">{{ foregroundPkg?.split('.').pop() ?? '—' }}</span>
        </button>
        <button class="preset" :class="{ active: preset === 'errors' }" @click="applyPreset(preset === 'errors' ? null : 'errors')">
          <span class="emo">🔥</span><span class="lb">Errors</span><span class="meta">E + F</span>
        </button>
        <button class="preset" :class="{ active: preset === 'crashes' }" @click="applyPreset(preset === 'crashes' ? null : 'crashes')">
          <span class="emo">💥</span><span class="lb">Crashes</span><span class="meta">AndroidRuntime</span>
        </button>
        <button class="preset" :class="{ active: preset === 'anr' }" @click="applyPreset(preset === 'anr' ? null : 'anr')">
          <span class="emo">🐌</span><span class="lb">ANR</span><span class="meta">ANR in</span>
        </button>
        <button class="preset" :class="{ active: preset === 'choreographer' }" @click="applyPreset(preset === 'choreographer' ? null : 'choreographer')">
          <span class="emo">🎬</span><span class="lb">Choreographer</span><span class="meta">frame skip</span>
        </button>
      </section>

      <section class="sec">
        <h4>Tags <span class="muted">{{ tagStats.length }}</span></h4>
        <div class="scroll">
          <button
            v-for="[tag, n] in tagStats"
            :key="tag"
            class="tag-chip"
            :class="{ active: selectedTag === tag }"
            @click="toggleTag(tag)"
            :title="tag"
          >
            <span class="lb">{{ tag }}</span>
            <span class="cnt">{{ n }}</span>
          </button>
          <div v-if="tagStats.length === 0" class="empty">暂无</div>
        </div>
      </section>

      <section class="sec">
        <h4>PIDs <span class="muted">{{ pidStats.length }}</span></h4>
        <div class="scroll">
          <button
            v-for="[pid, n, pkg] in pidStats"
            :key="pid"
            class="pid-row"
            :class="{ active: selectedPid === pid }"
            @click="togglePid(pid)"
            :title="`${pid} ${pkg}`"
          >
            <span class="pid">{{ pid }}</span>
            <span class="pkg">{{ pkg ? pkg.split('.').slice(-2).join('.') : '—' }}</span>
            <span class="cnt">{{ n }}</span>
          </button>
          <div v-if="pidStats.length === 0" class="empty">暂无</div>
        </div>
      </section>
    </aside>

    <div class="main">
      <div class="toolbar">
        <button v-if="!sidebarOpen" class="side-toggle" @click="sidebarOpen = true" title="展开侧栏">→</button>
        <button v-if="!paused" @click="paused = true" title="暂停">⏸</button>
        <button v-else @click="paused = false" title="恢复">▶</button>
        <button @click="clear" title="清空">🗑</button>
        <input v-model="filter" class="filter" placeholder="过滤（子串）" />
        <label v-for="(_v, k) in levels" :key="k" class="lvl">
          <input type="checkbox" v-model="levels[k]" />
          <span :style="{ color: colorOf(k) }">{{ k }}</span>
        </label>
        <label class="auto"><input type="checkbox" v-model="autoScroll" /> auto</label>
        <span class="status">{{ status }} · {{ filtered.length }}/{{ lines.length }}</span>
      </div>
      <div ref="listRef" class="list">
        <div
          v-for="l in filtered"
          :key="l.id"
          class="line"
          :class="{ hl: isLineSelected(l) }"
          :style="{ borderLeftColor: colorOf(l.level) }"
        >
          {{ l.text }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.logcat { display: flex; flex-direction: row; height: 100%; background: #0a0c11; }

/* ===== Sidebar ===== */
.sidebar {
  width: 220px;
  flex: 0 0 220px;
  overflow-y: auto;
  padding: 8px;
  background: var(--surface-2);
  border-right: 1px solid rgba(255,255,255,0.05);
  display: flex; flex-direction: column; gap: 10px;
  font-size: 11px;
}
.side-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 2px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.side-title {
  font-size: 10px; font-weight: 600;
  color: var(--fg-2);
  text-transform: uppercase; letter-spacing: 0.8px;
}
.collapse {
  width: 22px; height: 22px;
  background: transparent; border: none; border-radius: 4px;
  color: var(--fg-3); cursor: pointer; font-size: 12px;
}
.collapse:hover { background: rgba(255,255,255,0.06); color: var(--fg-1); }
.side-toggle {
  background: transparent; border: none; border-radius: 4px;
  color: var(--fg-2); cursor: pointer; font-size: 12px;
  padding: 3px 6px;
}
.side-toggle:hover { background: rgba(255,255,255,0.06); color: var(--fg-1); }
.sec h4 {
  margin: 0 0 4px; padding: 0 2px;
  font-size: 10px; font-weight: 600;
  color: var(--fg-3);
  text-transform: uppercase; letter-spacing: 0.6px;
  display: flex; align-items: center; justify-content: space-between;
}
.sec h4 .muted { color: var(--fg-3); font-weight: 400; opacity: 0.6; }

.buffer-row { display: flex; flex-wrap: wrap; gap: 3px; }
.chip {
  background: var(--surface-3); border: 1px solid transparent; border-radius: 4px;
  padding: 2px 7px; color: var(--fg-2); font-size: 10.5px; cursor: pointer;
}
.chip:hover { color: var(--fg-1); }
.chip.active { background: #1e3a8a; border-color: #60a5fa; color: #fff; }

.preset {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  background: transparent; border: 1px solid transparent; border-radius: 5px;
  padding: 4px 6px;
  color: var(--fg-2); text-align: left; cursor: pointer;
  font-size: 11px;
}
.preset + .preset { margin-top: 2px; }
.preset:hover { background: rgba(255,255,255,0.04); }
.preset.active { background: rgba(96,165,250,0.12); border-color: rgba(96,165,250,0.4); color: #fff; }
.preset .emo { width: 14px; text-align: center; }
.preset .lb { flex: 1; }
.preset .meta { font-size: 10px; color: var(--fg-3); opacity: 0.7; }

.scroll { max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 2px; }
.scroll .empty { color: var(--fg-3); opacity: 0.5; padding: 4px 0; text-align: center; }

.tag-chip {
  display: flex; align-items: center; gap: 6px;
  background: var(--surface-3); border: 1px solid transparent; border-radius: 4px;
  padding: 2px 6px;
  color: var(--fg-2); cursor: pointer; font-size: 11px;
  min-width: 0;
}
.tag-chip:hover { color: var(--fg-1); }
.tag-chip.active { background: rgba(96,165,250,0.18); border-color: #60a5fa; color: #fff; }
.tag-chip .lb {
  flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10.5px;
}
.tag-chip .cnt { color: var(--fg-3); font-size: 10px; flex: 0 0 auto; }

.pid-row {
  display: grid; grid-template-columns: 42px 1fr 34px; align-items: center; gap: 4px;
  background: var(--surface-3); border: 1px solid transparent; border-radius: 4px;
  padding: 2px 6px;
  color: var(--fg-2); cursor: pointer; font-size: 10.5px;
  text-align: left;
}
.pid-row:hover { color: var(--fg-1); }
.pid-row.active { background: rgba(94,234,212,0.14); border-color: #5eead4; color: #fff; }
.pid-row .pid { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: var(--fg-3); }
.pid-row.active .pid { color: #fff; }
.pid-row .pkg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pid-row .cnt { text-align: right; color: var(--fg-3); }

/* ===== Main ===== */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 11px;
}
.toolbar button {
  background: var(--surface-3); border: none; border-radius: 4px;
  padding: 3px 8px; color: var(--fg-1); cursor: pointer;
}
.filter {
  flex: 1;
  background: var(--surface-3); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;
  color: var(--fg-1); padding: 2px 8px; font-size: 11px;
}
.lvl { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; }
.lvl input { margin: 0; }
.auto { display: inline-flex; align-items: center; gap: 3px; color: var(--fg-3); }
.status { color: var(--fg-3); }

.list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  line-height: 1.4;
}
.line {
  padding: 0 10px;
  border-left: 2px solid transparent;
  white-space: pre;
  color: var(--fg-2);
}
.line:hover { background: rgba(255,255,255,0.03); }
.line.hl { background: rgba(96,165,250,0.08); }
.line.hl:hover { background: rgba(96,165,250,0.14); }
</style>
