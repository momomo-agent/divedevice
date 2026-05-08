<!-- 水平带刻度的进度条，支持 danger/warn 阈值 + 动态色 -->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  value: number
  max: number
  min?: number
  tickCount?: number
  thresholds?: { warn?: number; danger?: number } // 百分比 0..100
  /** invertThreshold: true = 低数值危险（如剩余电量）；false = 高数值危险（如温度） */
  invertThreshold?: boolean
  height?: number
  unit?: string
  showValue?: boolean
}>(), { min: 0, tickCount: 5, height: 8, showValue: true, invertThreshold: false })

const pct = computed(() => {
  if (props.max <= props.min) return 0
  return Math.max(0, Math.min(100, ((props.value - props.min) / (props.max - props.min)) * 100))
})

const color = computed(() => {
  if (!props.thresholds) return '#63a3ff'
  const p = pct.value
  const { warn, danger } = props.thresholds
  const w = warn ?? 100, dg = danger ?? 100
  if (props.invertThreshold) {
    if (p <= dg) return '#f87171'
    if (p <= w) return '#f5c04a'
    return '#7ee6a6'
  }
  if (p >= dg) return '#f87171'
  if (p >= w) return '#f5c04a'
  return '#7ee6a6'
})
</script>

<template>
  <div class="gb" :style="{ ['--h' as any]: height + 'px' }">
    <div class="track">
      <div class="fill" :style="{ width: pct + '%', background: color }" />
      <template v-for="i in (tickCount - 1)" :key="i">
        <div class="tick" :style="{ left: (i / tickCount) * 100 + '%' }" />
      </template>
    </div>
    <div v-if="showValue" class="labels">
      <span class="lo">{{ min }}{{ unit ? ' ' + unit : '' }}</span>
      <span class="hi">{{ max }}{{ unit ? ' ' + unit : '' }}</span>
    </div>
  </div>
</template>

<style scoped>
.gb { width: 100%; }
.track {
  position: relative;
  height: var(--h);
  background: var(--surface-3);
  border-radius: calc(var(--h) / 2);
  overflow: hidden;
}
.fill {
  position: absolute; inset: 0 auto 0 0;
  border-radius: inherit;
  transition: width 0.4s, background 0.3s;
}
.tick {
  position: absolute; top: 0; bottom: 0; width: 1px;
  background: rgba(255,255,255,0.08);
  transform: translateX(-0.5px);
}
.labels { display: flex; justify-content: space-between; margin-top: 3px; font-size: 10px; color: var(--fg-3); font-variant-numeric: tabular-nums; }
</style>
