<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, nextTick, computed, watch } from 'vue'
import { useDevice, useWindow } from '@/composables'
import type { SpawnedProcess } from '@/device'

const { window: win } = useWindow()
const device = useDevice()

interface LogLine {
  id: number
  text: string
  level: string
}

const lines = ref<LogLine[]>([])
const filter = ref('')
const autoScroll = ref(true)
const levels = ref({ V: true, D: true, I: true, W: true, E: true, F: true })
const paused = ref(false)
const status = ref('未启动')
const listRef = ref<HTMLDivElement | null>(null)
const MAX_LINES = 3000

let proc: SpawnedProcess | null = null
let buf = ''
let id = 0

function classify(text: string): string {
  // logcat brief: "D ActivityManager: ..."
  const m = text.match(/^\s?[A-Z]\/[^(]+\(\s*\d+\):/)
  if (m) return m[0].charAt(0)
  const m2 = text.match(/^\d+-\d+ .*\s([VDIWEF])\s/)
  if (m2) return m2[1]
  return 'I'
}

function append(text: string) {
  if (paused.value) return
  const level = classify(text)
  lines.value.push({ id: ++id, text, level })
  if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
}

async function start() {
  if (!device.value) { status.value = '未连接设备'; return }
  stop()
  status.value = '订阅 logcat…'
  try {
    proc = await device.value.logcat()
    status.value = '实时'
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

const filtered = computed(() => {
  const f = filter.value.toLowerCase()
  return lines.value.filter((l) => {
    if (!levels.value[l.level as keyof typeof levels.value]) return false
    if (f && !l.text.toLowerCase().includes(f)) return false
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

onMounted(start)
onBeforeUnmount(stop)
watch(() => win.value.deviceId, () => { lines.value = []; start() })
</script>

<template>
  <div class="logcat">
    <div class="toolbar">
      <button v-if="!paused" @click="paused = true">⏸</button>
      <button v-else @click="paused = false">▶</button>
      <button @click="clear">🗑</button>
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
        :style="{ borderLeftColor: colorOf(l.level) }"
      >
        {{ l.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.logcat { display: flex; flex-direction: column; height: 100%; background: #0a0c11; }
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
</style>
