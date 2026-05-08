<!-- 可复用：简洁 sparkline（SVG path）-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  width?: number
  height?: number
  stroke?: string
  fill?: string
  min?: number
  max?: number
  strokeWidth?: number
}>(), { width: 120, height: 28, stroke: '#63a3ff', fill: 'rgba(99,163,255,0.18)', strokeWidth: 1.4 })

const geo = computed(() => {
  const { data, width: w, height: h, min, max } = props
  if (!data.length) return { d: '', fill: '', last: 0, lastX: 0, lastY: h }
  const lo = min ?? Math.min(...data)
  const hi = max ?? Math.max(...data)
  const range = hi - lo || 1
  const step = data.length > 1 ? w / (data.length - 1) : w
  const pts = data.map((v, i) => {
    const x = i * step
    const y = h - ((v - lo) / range) * h
    return { x, y }
  })
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const fillD = `${d} L${w.toFixed(1)} ${h} L0 ${h} Z`
  const last = pts[pts.length - 1]
  return { d, fill: fillD, last: data[data.length - 1], lastX: last.x, lastY: last.y }
})
</script>

<template>
  <svg :width="width" :height="height" class="spark" viewBox="0 0 120 28" preserveAspectRatio="none">
    <path :d="geo.fill" :fill="fill" stroke="none" />
    <path :d="geo.d" :stroke="stroke" fill="none" :stroke-width="strokeWidth" stroke-linejoin="round" stroke-linecap="round" />
    <circle :cx="geo.lastX" :cy="geo.lastY" r="2" :fill="stroke" />
  </svg>
</template>

<style scoped>
.spark { display: block; }
</style>
