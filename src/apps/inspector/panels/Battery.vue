<script setup lang="ts">
import { ref, onMounted, computed, onBeforeUnmount } from 'vue'
import type { DeviceAPI, BatteryInfo } from '@/device'
import Donut from '../components/Donut.vue'
import GaugeBar from '../components/GaugeBar.vue'
import Sparkline from '../components/Sparkline.vue'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const b = ref<BatteryInfo>({})

const pctHistory = ref<number[]>([])
const tempHistory = ref<number[]>([])
let timer: number | null = null

async function load() {
  if (!props.device) return
  try { b.value = await props.device.system.battery() } catch (err) { error.value = (err as Error).message }
}

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    await load()
    // 初始化历史（单点）
    if (percent.value !== null) pctHistory.value = [percent.value]
    if (b.value.temperature !== undefined) tempHistory.value = [b.value.temperature]
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
  timer = window.setInterval(async () => {
    await load()
    if (percent.value !== null) {
      pctHistory.value.push(percent.value)
      if (pctHistory.value.length > 60) pctHistory.value.shift()
    }
    if (b.value.temperature !== undefined) {
      tempHistory.value.push(b.value.temperature)
      if (tempHistory.value.length > 60) tempHistory.value.shift()
    }
  }, 5000) as unknown as number
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const percent = computed(() => {
  if (b.value.level && b.value.scale) return Math.round((b.value.level / b.value.scale) * 100)
  if (b.value.level && b.value.level <= 100) return b.value.level
  return null
})
const color = computed(() => {
  const p = percent.value
  if (p === null) return '#63a3ff'
  if (p <= 15) return '#f87171'
  if (p <= 30) return '#f5c04a'
  return '#7ee6a6'
})
const statusTone = computed<'good'|'warn'|'danger'|'neutral'>(() => {
  const s = (b.value.status || '').toLowerCase()
  if (s.includes('charging')) return 'good'
  if (s.includes('full')) return 'good'
  if (s.includes('discharging') && (percent.value ?? 100) <= 20) return 'warn'
  if (s.includes('unknown')) return 'warn'
  return 'neutral'
})
const tempTone = computed<'good'|'warn'|'danger'|'neutral'>(() => {
  const t = b.value.temperature
  if (t === undefined) return 'neutral'
  if (t >= 45) return 'danger'
  if (t >= 40) return 'warn'
  return 'good'
})
const voltV = computed(() => b.value.voltage ? b.value.voltage / 1000 : null)
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <!-- Hero：大环形 + 状态胶囊 -->
      <div class="hero-row">
        <Donut
          :percent="percent ?? 0"
          :label="(percent ?? '?') + '%'"
          :color="color"
          :size="160"
          :thickness="14"
          :sublabel="b.status ?? ''"
        />
        <div class="hero-meta">
          <div class="pill-row">
            <span class="pill" :class="statusTone">{{ b.status || '—' }}</span>
            <span v-if="b.plugged && b.plugged !== 'None'" class="pill info">🔌 {{ b.plugged }}</span>
            <span v-if="b.present" class="pill good">已连接</span>
            <span v-else-if="b.present === false" class="pill danger">未检测到</span>
          </div>
          <div class="muted">{{ b.technology ?? 'Unknown type' }} · 健康：{{ b.health ?? '—' }}</div>

          <!-- 百分比变化曲线 -->
          <div v-if="pctHistory.length > 1" class="spark-block">
            <div class="label">电量变化（每 5s 采样 · 最近 5 分钟）</div>
            <Sparkline :data="pctHistory" :width="360" :height="38" :min="0" :max="100" :stroke="color" :fill="color + '22'" />
          </div>
        </div>
      </div>

      <!-- 各种 gauge -->
      <div class="gauges">
        <div class="card">
          <div class="head">
            <span class="ic">🌡</span>
            <span class="lbl">Temperature</span>
            <div class="grow" />
            <span class="pill" :class="tempTone">
              {{ b.temperature !== undefined ? b.temperature + ' °C' : '—' }}
            </span>
          </div>
          <div class="num big" :style="{ color: tempTone === 'danger' ? '#f87171' : tempTone === 'warn' ? '#f5c04a' : '#7ee6a6' }">
            {{ b.temperature !== undefined ? b.temperature : '—' }}<span class="unit">°C</span>
          </div>
          <GaugeBar
            v-if="b.temperature !== undefined"
            :value="b.temperature"
            :min="0"
            :max="60"
            :thresholds="{ warn: 66, danger: 75 }"
            :show-value="true"
            unit="°C"
            :height="6"
          />
          <Sparkline
            v-if="tempHistory.length > 1"
            :data="tempHistory"
            :width="240"
            :height="30"
            :min="Math.min(...tempHistory) - 1"
            :max="Math.max(...tempHistory) + 1"
            :stroke="tempTone === 'danger' ? '#f87171' : tempTone === 'warn' ? '#f5c04a' : '#7ee6a6'"
            :fill="tempTone === 'danger' ? 'rgba(248,113,113,0.18)' : 'rgba(126,230,166,0.12)'"
          />
        </div>

        <div class="card">
          <div class="head">
            <span class="ic">⚡</span>
            <span class="lbl">Voltage</span>
            <div class="grow" />
          </div>
          <div class="num big">{{ voltV !== null ? voltV.toFixed(3) : '—' }}<span class="unit">V</span></div>
          <GaugeBar
            v-if="voltV !== null"
            :value="voltV"
            :min="3.0"
            :max="4.4"
            :thresholds="{ warn: 20, danger: 10 }"
            invert-threshold
            :show-value="true"
            unit="V"
            :height="6"
          />
          <div class="muted sm">电芯电压 · 常见正常范围 3.5–4.2 V</div>
        </div>

        <div class="card">
          <div class="head">
            <span class="ic">🔋</span>
            <span class="lbl">Level</span>
            <div class="grow" />
          </div>
          <div class="num big">{{ b.level ?? '—' }}<span class="unit">/ {{ b.scale ?? '?' }}</span></div>
          <GaugeBar
            v-if="b.level !== undefined && b.scale !== undefined"
            :value="b.level"
            :max="b.scale"
            :thresholds="{ warn: 30, danger: 15 }"
            invert-threshold
            :show-value="true"
            :height="6"
          />
          <div class="muted sm">充电 / 放电流入量</div>
        </div>
      </div>

      <!-- 原始 KV -->
      <h3 class="hdr"><span>详情</span></h3>
      <div class="kv">
        <span>状态</span><code>{{ b.status ?? '—' }}</code>
        <span>充电源</span><code>{{ b.plugged ?? '—' }}</code>
        <span>电压</span><code>{{ b.voltage ? (b.voltage / 1000).toFixed(3) + ' V' : '—' }}</code>
        <span>温度</span><code>{{ b.temperature !== undefined ? b.temperature + ' °C' : '—' }}</code>
        <span>健康</span><code>{{ b.health ?? '—' }}</code>
        <span>类型</span><code>{{ b.technology ?? '—' }}</code>
        <span>Present</span><code>{{ b.present === undefined ? '—' : (b.present ? 'true' : 'false') }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.hero-row { display: flex; align-items: center; gap: 24px; padding: 18px 12px; background: var(--surface-2); border-radius: 10px; margin-bottom: 14px; }
.hero-meta { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
.muted { color: var(--fg-3); font-size: 11px; }
.muted.sm { font-size: 10.5px; margin-top: 4px; }
.spark-block { margin-top: 4px; }
.spark-block .label { font-size: 10.5px; color: var(--fg-3); margin-bottom: 3px; }

.gauges { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-bottom: 14px; }
.card .head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.card .head .ic { font-size: 13px; opacity: 0.8; }
.card .head .lbl { font-size: 10.5px; color: var(--fg-3); letter-spacing: 0.3px; text-transform: uppercase; }
.card .head .grow { flex: 1; }
.card .num.big { margin-bottom: 8px; }
</style>
