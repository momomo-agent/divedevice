<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, inject, type Ref } from 'vue'
import type { DeviceAPI, TopActivity, BatteryInfo, CpuInfo, LayerInfo, ProcessInfo } from '@/device'
import StatCard from '../components/StatCard.vue'
import Donut from '../components/Donut.vue'
import Sparkline from '../components/Sparkline.vue'
import GaugeBar from '../components/GaugeBar.vue'

const props = defineProps<{ device: DeviceAPI | null }>()

const loading = ref(true)
const error = ref<string | null>(null)
const top = ref<TopActivity | null>(null)
const battery = ref<BatteryInfo>({})
const cpu = ref<CpuInfo>({})
const layers = ref<LayerInfo | null>(null)
const procs = ref<ProcessInfo[]>([])
const ime = ref<string | null>(null)
const deviceBrand = ref('')
const deviceModel = ref('')
const androidVer = ref('')
const sdkVer = ref('')
const uptimeSec = ref<number | null>(null)
const topMem = ref<Array<{ name: string; rss: number }>>([])

// 轮询 cpu load 做 sparkline
const loadHistory = ref<number[]>([])
let pollTimer: number | null = null

async function loadAll() {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  const d = props.device
  try {
    const [t, b, c, l, ps, im, propsMap, uptimeRaw] = await Promise.all([
      d.system.topActivity().catch(() => null),
      d.system.battery().catch(() => ({})),
      d.system.cpuinfo().catch(() => ({})),
      d.system.layers().catch(() => null),
      d.system.processes().catch(() => []),
      d.system.currentIme().catch(() => null),
      d.system.getProps().catch(() => ({} as Record<string, string>)),
      d.shell.exec('cat /proc/uptime').then((r) => r.stdout).catch(() => ''),
    ])
    top.value = t
    battery.value = b
    cpu.value = c
    layers.value = l
    procs.value = ps
    ime.value = im
    deviceBrand.value = propsMap['ro.product.brand'] || propsMap['ro.product.manufacturer'] || ''
    deviceModel.value = propsMap['ro.product.model'] || propsMap['ro.product.name'] || ''
    androidVer.value = propsMap['ro.build.version.release'] || ''
    sdkVer.value = propsMap['ro.build.version.sdk'] || ''
    uptimeSec.value = Number((uptimeRaw || '').trim().split(/\s+/)[0]) || null
    // top 8 RSS
    topMem.value = [...ps].sort((a, b) => b.rss - a.rss).slice(0, 8).map((p) => ({ name: p.name, rss: p.rss }))
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function pollLoad() {
  if (!props.device) return
  try {
    const c = await props.device.system.cpuinfo()
    if (typeof c.load1 === 'number') {
      loadHistory.value.push(c.load1)
      if (loadHistory.value.length > 60) loadHistory.value.shift()
      cpu.value = c
    }
  } catch {}
}

onMounted(async () => {
  await loadAll()
  // 初始 sparkline 种子：几个采样
  if (typeof cpu.value.load1 === 'number') loadHistory.value = [cpu.value.load1]
  pollTimer = window.setInterval(pollLoad, 3000) as unknown as number
})
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })

const tick = inject<Ref<number>>('inspector:refreshTick')
if (tick) watch(tick, loadAll)

// 派生指标
const batteryPct = computed(() => {
  const b = battery.value
  if (b.level && b.scale) return Math.round((b.level / b.scale) * 100)
  if (b.level && b.level <= 100) return b.level
  return null
})
const cpuPct = computed(() => {
  if (!cpu.value.load1 || !cpu.value.cores) return null
  return Math.min(100, Math.round((cpu.value.load1 / cpu.value.cores) * 100))
})
const totalRss = computed(() => procs.value.reduce((s, p) => s + p.rss, 0))
const visibleRatio = computed(() => {
  if (!layers.value || !layers.value.total) return 0
  return layers.value.visible / layers.value.total * 100
})

function fmtUptime(sec: number | null): string {
  if (!sec) return '—'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}
function fmtMem(kb: number): string {
  if (kb > 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb > 1024) return (kb / 1024).toFixed(1) + ' MB'
  return kb + ' KB'
}

function tempTone(t?: number): 'good' | 'warn' | 'danger' | 'default' {
  if (t === undefined) return 'default'
  if (t >= 45) return 'danger'
  if (t >= 40) return 'warn'
  return 'good'
}
function cpuTone(p: number | null): 'good' | 'warn' | 'danger' | 'default' {
  if (p === null) return 'default'
  if (p >= 80) return 'danger'
  if (p >= 50) return 'warn'
  return 'good'
}
function batteryTone(p: number | null): 'good' | 'warn' | 'danger' | 'default' {
  if (p === null) return 'default'
  if (p <= 15) return 'danger'
  if (p <= 30) return 'warn'
  return 'good'
}
function batteryColor(p: number | null): string {
  if (p === null) return '#63a3ff'
  if (p <= 15) return '#f87171'
  if (p <= 30) return '#f5c04a'
  return '#7ee6a6'
}
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <!-- 顶栏：设备身份 -->
      <div class="hero">
        <div class="device-ic">📱</div>
        <div class="device-text">
          <div class="brand">{{ deviceBrand || '—' }} {{ deviceModel }}</div>
          <div class="meta">
            <span class="pill info">Android {{ androidVer || '?' }}</span>
            <span class="pill neutral">SDK {{ sdkVer || '?' }}</span>
            <span class="pill neutral">⏱ {{ fmtUptime(uptimeSec) }}</span>
          </div>
        </div>
      </div>

      <!-- 主仪表 -->
      <div class="stats-grid">
        <!-- 前台应用 -->
        <StatCard
          icon="🎯"
          label="Foreground"
          :value="top?.packageName ? top.packageName.split('.').pop()! : '—'"
          :sublabel="top?.activityName || ''"
          tone="accent"
          full-width
        />

        <!-- 电池 -->
        <div class="card battery-card">
          <div class="head">
            <span class="ic">🔋</span>
            <span class="lbl">Battery</span>
            <div class="grow" />
            <span class="pill" :class="batteryTone(batteryPct)">{{ battery.status ?? '—' }}</span>
          </div>
          <div class="battery-body">
            <Donut
              :percent="batteryPct ?? 0"
              :label="(batteryPct ?? '?') + '%'"
              :color="batteryColor(batteryPct)"
              :sublabel="battery.plugged && battery.plugged !== 'None' ? battery.plugged : ''"
              :size="86"
            />
            <div class="battery-meta">
              <div class="mi"><span>电压</span><b class="num">{{ battery.voltage ? (battery.voltage/1000).toFixed(2) + ' V' : '—' }}</b></div>
              <div class="mi"><span>温度</span><b class="num" :style="{ color: tempTone(battery.temperature) === 'danger' ? '#f87171' : tempTone(battery.temperature) === 'warn' ? '#f5c04a' : '#7ee6a6' }">{{ battery.temperature !== undefined ? battery.temperature + ' °C' : '—' }}</b></div>
              <div class="mi"><span>健康</span><b class="num">{{ battery.health ?? '—' }}</b></div>
            </div>
          </div>
        </div>

        <!-- CPU -->
        <div class="card cpu-card">
          <div class="head">
            <span class="ic">⚙</span>
            <span class="lbl">CPU Load</span>
            <div class="grow" />
            <span v-if="cpuPct !== null" class="pill" :class="cpuTone(cpuPct)">{{ cpuPct }}%</span>
          </div>
          <div class="cpu-main">
            <div class="cpu-nums">
              <span class="num big">{{ cpu.load1 !== undefined ? cpu.load1.toFixed(2) : '—' }}</span>
              <span class="unit">1m · {{ cpu.cores ?? '?' }} cores</span>
            </div>
            <Sparkline
              v-if="loadHistory.length > 1"
              :data="loadHistory"
              :width="130"
              :height="36"
              :min="0"
              :max="Math.max(cpu.cores ?? 4, ...loadHistory)"
              :stroke="cpuTone(cpuPct) === 'danger' ? '#f87171' : cpuTone(cpuPct) === 'warn' ? '#f5c04a' : '#7ee6a6'"
              :fill="cpuTone(cpuPct) === 'danger' ? 'rgba(248,113,113,0.18)' : 'rgba(126,230,166,0.16)'"
            />
          </div>
          <GaugeBar
            v-if="cpu.cores"
            :value="cpu.load1 ?? 0"
            :max="cpu.cores"
            :thresholds="{ warn: 50, danger: 80 }"
            :height="6"
            :show-value="false"
          />
          <div class="cpu-legend">
            <span>5m {{ cpu.load5 !== undefined ? cpu.load5.toFixed(2) : '?' }}</span>
            <span>15m {{ cpu.load15 !== undefined ? cpu.load15.toFixed(2) : '?' }}</span>
          </div>
        </div>

        <!-- SurfaceFlinger -->
        <div class="card">
          <div class="head">
            <span class="ic">🪟</span>
            <span class="lbl">Surfaces</span>
            <div class="grow" />
            <span class="pill info">{{ Math.round(visibleRatio) }}% vis</span>
          </div>
          <div class="sf-body">
            <Donut
              :percent="visibleRatio"
              :label="layers ? String(layers.visible) : '—'"
              :sublabel="layers ? `/ ${layers.total}` : ''"
              color="#9ecbff"
              :size="82"
            />
            <div class="sf-note">
              Visible layers / Total<br />
              <span class="fg-3">SurfaceFlinger snapshot</span>
            </div>
          </div>
        </div>

        <!-- 进程 -->
        <StatCard
          icon="🧩"
          label="Processes"
          :value="procs.length"
          :sublabel="`总 RSS ${fmtMem(totalRss)}`"
          tone="accent"
        />

        <!-- IME -->
        <StatCard
          icon="⌨"
          label="Input Method"
          :value="ime ? (ime.split('/')[0].split('.').pop() ?? ime) : '—'"
          :sublabel="ime || ''"
        />
      </div>

      <!-- Top memory processes -->
      <h3 class="hdr">
        <span>TOP 内存进程</span>
        <span class="count">— top 8 by RSS</span>
      </h3>
      <div class="topmem">
        <div v-for="p in topMem" :key="p.name" class="topmem-row">
          <span class="nm" :title="p.name">{{ p.name }}</span>
          <span class="bar">
            <span class="fill" :style="{ width: (p.rss / (topMem[0]?.rss || 1) * 100) + '%' }" />
          </span>
          <span class="sz num">{{ fmtMem(p.rss) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  margin-bottom: 14px;
  background: linear-gradient(135deg, rgba(99,163,255,0.1), rgba(155,105,255,0.06));
  border: 1px solid rgba(99,163,255,0.18);
  border-radius: 10px;
}
.device-ic { font-size: 32px; }
.device-text .brand { font-size: 16px; font-weight: 600; color: var(--fg-1); }
.device-text .meta { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }

.card .head {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 10px;
}
.card .head .ic { font-size: 14px; opacity: 0.8; }
.card .head .lbl { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.3px; text-transform: uppercase; }
.card .head .grow { flex: 1; }

.battery-body { display: flex; align-items: center; gap: 14px; }
.battery-meta { flex: 1; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.battery-meta .mi { display: flex; justify-content: space-between; }
.battery-meta .mi span { color: var(--fg-3); }
.battery-meta .mi b { color: var(--fg-1); font-weight: 500; }

.cpu-main {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 8px;
}
.cpu-nums { display: flex; flex-direction: column; gap: 2px; }
.cpu-legend { display: flex; justify-content: space-between; margin-top: 6px; font-size: 10.5px; color: var(--fg-3); }

.sf-body { display: flex; align-items: center; gap: 12px; }
.sf-note { font-size: 11px; line-height: 1.5; color: var(--fg-2); }
.sf-note .fg-3 { color: var(--fg-3); }

.topmem { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
.topmem-row {
  display: grid; grid-template-columns: 1fr 2fr auto;
  gap: 10px; align-items: center;
  padding: 3px 4px; border-radius: 4px;
  font-size: 11px;
}
.topmem-row:hover { background: rgba(255,255,255,0.03); }
.topmem-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-family: ui-monospace, monospace; font-size: 10.5px; }
.topmem-row .bar { position: relative; height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
.topmem-row .bar .fill {
  position: absolute; inset: 0 auto 0 0;
  background: linear-gradient(90deg, #63a3ff, #9ecbff);
  border-radius: 3px;
}
.topmem-row .sz { color: var(--fg-2); font-size: 10.5px; min-width: 62px; text-align: right; }
</style>
