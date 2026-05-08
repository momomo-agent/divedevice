<!-- 环形百分比（电池/janky）-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  percent: number           // 0..100
  size?: number
  thickness?: number
  color?: string
  trackColor?: string
  label?: string | number
  sublabel?: string
}>(), { size: 96, thickness: 8, color: '#63a3ff', trackColor: 'rgba(255,255,255,0.08)' })

const geo = computed(() => {
  const r = (props.size - props.thickness) / 2
  const c = 2 * Math.PI * r
  const clamp = Math.max(0, Math.min(100, props.percent))
  const dash = (clamp / 100) * c
  return { r, c, dash, cx: props.size / 2, cy: props.size / 2 }
})
</script>

<template>
  <div class="donut" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size">
      <circle :cx="geo.cx" :cy="geo.cy" :r="geo.r" :stroke="trackColor" :stroke-width="thickness" fill="none" />
      <circle
        :cx="geo.cx" :cy="geo.cy" :r="geo.r"
        :stroke="color" :stroke-width="thickness" fill="none"
        stroke-linecap="round"
        :stroke-dasharray="`${geo.dash} ${geo.c}`"
        :transform="`rotate(-90 ${geo.cx} ${geo.cy})`"
        style="transition: stroke-dasharray 0.35s"
      />
    </svg>
    <div class="label">
      <div class="val">{{ label ?? Math.round(percent) + '%' }}</div>
      <div v-if="sublabel" class="sub">{{ sublabel }}</div>
    </div>
  </div>
</template>

<style scoped>
.donut { position: relative; }
.label { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.val { font-size: 20px; font-weight: 500; color: var(--fg-1); line-height: 1.1; }
.sub { font-size: 10px; color: var(--fg-3); margin-top: 2px; letter-spacing: 0.3px; }
</style>
