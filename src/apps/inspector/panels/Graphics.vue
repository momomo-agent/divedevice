<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DeviceAPI } from '@/device'
import Donut from '../components/Donut.vue'
import GaugeBar from '../components/GaugeBar.vue'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(false)
const error = ref<string | null>(null)
const target = ref('')
const output = ref('')
const topActivityPkg = ref<string | null>(null)

async function load() {
  if (!props.device) { error.value = '未连接设备'; return }
  loading.value = true
  error.value = null
  try {
    output.value = await props.device.system.gfxinfo(target.value || undefined)
  } catch (err) {
    error.value = (err as Error).message
    output.value = ''
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (props.device) {
    const t = await props.device.system.topActivity().catch(() => null)
    topActivityPkg.value = t?.packageName ?? null
    if (t?.packageName) target.value = t.packageName
  }
  load()
})

// 解析关键指标
interface ParsedMetrics {
  totalFrames?: number
  jankyFrames?: number
  jankyPercent?: number
  p50?: number
  p90?: number
  p95?: number
  p99?: number
  missedVsyncs?: number
  highInputLatency?: number
  slowUiThread?: number
  slowBitmapUploads?: number
  slowIssueDrawCmd?: number
  histogram?: Array<{ bucket: number; count: number }>
}
const parsed = computed<ParsedMetrics>(() => {
  const o = output.value
  if (!o) return {}
  const m: ParsedMetrics = {}
  m.totalFrames = Number(o.match(/Total frames rendered:\s*(\d+)/)?.[1]) || undefined
  const jank = o.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/)
  if (jank) { m.jankyFrames = Number(jank[1]); m.jankyPercent = Number(jank[2]) }
  m.p50 = Number(o.match(/50th percentile:\s*(\d+)\s*ms/)?.[1]) || undefined
  m.p90 = Number(o.match(/90th percentile:\s*(\d+)\s*ms/)?.[1]) || undefined
  m.p95 = Number(o.match(/95th percentile:\s*(\d+)\s*ms/)?.[1]) || undefined
  m.p99 = Number(o.match(/99th percentile:\s*(\d+)\s*ms/)?.[1]) || undefined
  m.missedVsyncs = Number(o.match(/Number Missed Vsync:\s*(\d+)/)?.[1]) || 0
  m.highInputLatency = Number(o.match(/Number High input latency:\s*(\d+)/)?.[1]) || 0
  m.slowUiThread = Number(o.match(/Number Slow UI thread:\s*(\d+)/)?.[1]) || 0
  m.slowBitmapUploads = Number(o.match(/Number Slow bitmap uploads:\s*(\d+)/)?.[1]) || 0
  m.slowIssueDrawCmd = Number(o.match(/Number Slow issue draw commands:\s*(\d+)/)?.[1]) || 0
  // HISTOGRAM: e.g. `HISTOGRAM: 5ms=123 6ms=456 ...`
  const hist = o.match(/HISTOGRAM:\s*([^\n]+)/)?.[1]
  if (hist) {
    m.histogram = []
    for (const tok of hist.split(/\s+/)) {
      const mm = tok.match(/^(\d+)ms=(\d+)$/)
      if (mm) m.histogram.push({ bucket: Number(mm[1]), count: Number(mm[2]) })
    }
  }
  return m
})

const jankTone = computed<'good'|'warn'|'danger'|'default'>(() => {
  const j = parsed.value.jankyPercent
  if (j === undefined) return 'default'
  if (j >= 10) return 'danger'
  if (j >= 5) return 'warn'
  return 'good'
})
const jankColor = computed(() => jankTone.value === 'danger' ? '#f87171' : jankTone.value === 'warn' ? '#f5c04a' : '#7ee6a6')

const histMaxCount = computed(() => Math.max(1, ...(parsed.value.histogram ?? []).map((h) => h.count)))
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <input v-model="target" class="search" placeholder="包名（留空 = 全局）" style="flex: 1; margin-bottom: 0;" />
      <button class="btn" @click="load" :disabled="loading">{{ loading ? '…' : '获取' }}</button>
      <button
        v-if="topActivityPkg && target !== topActivityPkg"
        class="btn"
        @click="target = topActivityPkg!; load()"
        :title="`切到前台 ${topActivityPkg}`"
      >前台</button>
    </div>

    <div v-if="error" class="hint err">{{ error }}</div>

    <template v-if="output && parsed.totalFrames !== undefined">
      <!-- 核心指标 -->
      <div class="top-row">
        <div class="card jank-card">
          <div class="head">
            <span class="ic">⚠</span>
            <span class="lbl">Jank Rate</span>
            <div class="grow" />
            <span class="pill" :class="jankTone">{{ parsed.jankyPercent?.toFixed(2) ?? '—' }}%</span>
          </div>
          <Donut
            :percent="parsed.jankyPercent ?? 0"
            :label="(parsed.jankyPercent ?? 0).toFixed(1) + '%'"
            :color="jankColor"
            :size="110"
            :thickness="10"
            :sublabel="`${parsed.jankyFrames}/${parsed.totalFrames}`"
          />
        </div>

        <div class="percentiles card">
          <div class="head">
            <span class="ic">📊</span>
            <span class="lbl">Frame Time Percentiles</span>
          </div>
          <div class="pbar-grp">
            <div v-for="(p, lbl) in { '50%': parsed.p50, '90%': parsed.p90, '95%': parsed.p95, '99%': parsed.p99 }" :key="lbl" class="pbar">
              <span class="pct">{{ lbl }}</span>
              <span class="ms num">{{ p !== undefined ? p + ' ms' : '—' }}</span>
              <GaugeBar
                :value="p ?? 0"
                :max="Math.max(32, ...[parsed.p50, parsed.p90, parsed.p95, parsed.p99].filter(Boolean) as number[])"
                :thresholds="{ warn: 50, danger: 75 }"
                :show-value="false"
                :height="5"
              />
            </div>
          </div>
          <div class="muted" style="margin-top: 8px;">
            目标：60Hz 下 &lt; 16.7ms，90Hz 下 &lt; 11.1ms，120Hz 下 &lt; 8.3ms
          </div>
        </div>
      </div>

      <!-- 问题原因 -->
      <h3 class="hdr"><span>问题原因分布</span></h3>
      <div class="cause-grid">
        <div class="cause"><span>Missed Vsyncs</span><b class="num">{{ parsed.missedVsyncs }}</b></div>
        <div class="cause"><span>High Input Latency</span><b class="num">{{ parsed.highInputLatency }}</b></div>
        <div class="cause"><span>Slow UI Thread</span><b class="num">{{ parsed.slowUiThread }}</b></div>
        <div class="cause"><span>Slow Bitmap Uploads</span><b class="num">{{ parsed.slowBitmapUploads }}</b></div>
        <div class="cause"><span>Slow Issue Draw</span><b class="num">{{ parsed.slowIssueDrawCmd }}</b></div>
      </div>

      <!-- Histogram -->
      <template v-if="parsed.histogram && parsed.histogram.length">
        <h3 class="hdr"><span>帧耗时直方图</span><span class="count">— ms 粒度</span></h3>
        <div class="hist">
          <div v-for="h in parsed.histogram" :key="h.bucket" class="hist-bar" :title="`${h.bucket}ms: ${h.count} 帧`">
            <div class="col" :style="{ height: (h.count / histMaxCount * 100) + '%', background: h.bucket <= 16 ? '#7ee6a6' : h.bucket <= 32 ? '#f5c04a' : '#f87171' }"></div>
            <span class="lb">{{ h.bucket }}</span>
          </div>
        </div>
      </template>

      <!-- 原始输出（折叠） -->
      <details style="margin-top: 18px;">
        <summary style="cursor: pointer; color: var(--fg-3); font-size: 11px;">原始 gfxinfo</summary>
        <pre style="margin-top: 8px;">{{ output }}</pre>
      </details>
    </template>

    <template v-else-if="output">
      <div class="hint">未解析到关键指标，查看原始输出：</div>
      <pre>{{ output }}</pre>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.top-row { display: grid; grid-template-columns: auto 1fr; gap: 10px; margin-bottom: 14px; }
.card .head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.card .head .ic { font-size: 13px; opacity: 0.8; }
.card .head .lbl { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.3px; text-transform: uppercase; }
.card .head .grow { flex: 1; }
.jank-card { display: flex; flex-direction: column; align-items: center; padding: 14px 14px 18px; }
.jank-card .head { width: 100%; }

.percentiles { padding: 14px 16px; }
.pbar-grp { display: flex; flex-direction: column; gap: 7px; }
.pbar {
  display: grid; grid-template-columns: 40px 60px 1fr;
  gap: 8px; align-items: center;
}
.pbar .pct { font-size: 11px; color: var(--fg-3); font-family: ui-monospace, monospace; }
.pbar .ms { font-size: 11px; text-align: right; }
.muted { color: var(--fg-3); font-size: 10.5px; }

.cause-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px; margin-bottom: 14px;
}
.cause {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 10px; background: var(--surface-2); border-radius: 6px;
  font-size: 11px; color: var(--fg-3);
}
.cause b { color: var(--fg-1); font-variant-numeric: tabular-nums; }

.hist {
  display: flex; align-items: flex-end; gap: 2px;
  height: 100px; padding: 4px 4px 16px; background: var(--surface-2); border-radius: 6px;
  position: relative;
}
.hist-bar { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-width: 12px; position: relative; height: 100%; }
.hist-bar .col { width: 100%; border-radius: 2px 2px 0 0; transition: height 0.3s; min-height: 1px; }
.hist-bar .lb { position: absolute; bottom: -14px; font-size: 9px; color: var(--fg-3); font-family: ui-monospace, monospace; }
</style>
