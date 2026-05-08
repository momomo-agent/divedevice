<!-- 简易 treemap（按 value 排序，slice-and-dice）-->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  items: Array<{ name: string; value: number; tip?: string; color?: string }>
  width?: number
  height?: number
  maxItems?: number
}>(), { width: 600, height: 200, maxItems: 80 })

const emit = defineEmits<{ click: [name: string] }>()

function layout(items: Array<{ name: string; value: number; tip?: string; color?: string }>, w: number, h: number) {
  // Squarified-lite：排序后按累加比例切条，行向竖切列
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const total = sorted.reduce((s, it) => s + it.value, 0) || 1
  const rects: Array<{ x: number; y: number; w: number; h: number; item: typeof items[number] }> = []
  let x = 0, y = 0, remW = w, remH = h
  let i = 0
  while (i < sorted.length) {
    const horizontal = remW >= remH
    // Accumulate items until aspect ratio worsens
    const rowStart = i
    let rowSum = 0
    let bestRatio = Infinity
    let bestEnd = i
    while (i < sorted.length) {
      rowSum += sorted[i].value
      const rowFrac = rowSum / total
      // row rect size
      const long = horizontal ? remW : remH
      const rowLen = long * rowFrac / (sorted.slice(rowStart, i + 1).reduce((s, it) => s + it.value, 0) / total || 1)
      // avg aspect
      const count = i - rowStart + 1
      const avgSide = (horizontal ? remH : remW) / count
      const otherSide = horizontal ? rowLen : rowLen
      const ratio = Math.max(avgSide, otherSide) / Math.max(1, Math.min(avgSide, otherSide))
      if (ratio <= bestRatio) { bestRatio = ratio; bestEnd = i; i++ } else break
      // Cap row at 6 to prevent slivers
      if (count >= 8) break
    }
    const rowItems = sorted.slice(rowStart, bestEnd + 1)
    const rowValSum = rowItems.reduce((s, it) => s + it.value, 0)
    const rowFrac = rowValSum / total
    const rowLen = horizontal ? remW : remH
    // Fallback simple: rowThick = otherSide * rowFrac
    const simpleThick = (horizontal ? remH : remW) * rowFrac / Math.max(0.0001, rowFrac + (1 - rowFrac))
    const useThick = Math.min(horizontal ? remH : remW, Math.max(1, simpleThick || (horizontal ? remH : remW) * rowFrac))
    // Lay out items along the row
    let cursor = 0
    for (const it of rowItems) {
      const itLen = rowLen * (it.value / rowValSum)
      if (horizontal) {
        rects.push({ x: x + cursor, y, w: itLen, h: useThick, item: it })
      } else {
        rects.push({ x, y: y + cursor, w: useThick, h: itLen, item: it })
      }
      cursor += itLen
    }
    if (horizontal) { y += useThick; remH -= useThick } else { x += useThick; remW -= useThick }
    if (remW < 1 || remH < 1) break
  }
  return rects
}

const rects = computed(() => {
  const items = props.items.slice(0, props.maxItems)
  return layout(items, props.width, props.height)
})

function fill(it: { name: string; color?: string }) {
  if (it.color) return it.color
  // hash → hue
  let h = 0
  for (let i = 0; i < it.name.length; i++) h = (h * 31 + it.name.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 52% 52% / 0.55)`
}
function fmtKb(kb: number): string {
  if (kb > 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb > 1024) return (kb / 1024).toFixed(1) + ' MB'
  return kb + ' KB'
}
</script>

<template>
  <svg :viewBox="`0 0 ${width} ${height}`" :width="width" :height="height" preserveAspectRatio="none" class="tm">
    <g v-for="(r, i) in rects" :key="i" @click="emit('click', r.item.name)" class="cell">
      <title>{{ r.item.tip ?? `${r.item.name}  ${fmtKb(r.item.value)}` }}</title>
      <rect :x="r.x" :y="r.y" :width="Math.max(0.5, r.w - 1)" :height="Math.max(0.5, r.h - 1)" :fill="fill(r.item)" rx="2" ry="2" />
      <text
        v-if="r.w > 42 && r.h > 14"
        :x="r.x + 4" :y="r.y + 12" fill="rgba(255,255,255,0.85)" font-size="9" style="pointer-events:none"
      >{{ r.item.name.slice(r.item.name.lastIndexOf(':') + 1).slice(-18) }}</text>
      <text
        v-if="r.w > 42 && r.h > 26"
        :x="r.x + 4" :y="r.y + 22" fill="rgba(255,255,255,0.55)" font-size="9" style="pointer-events:none"
      >{{ fmtKb(r.item.value) }}</text>
    </g>
  </svg>
</template>

<style scoped>
.tm { display: block; background: var(--surface-2); border-radius: 6px; }
.cell { cursor: pointer; }
.cell:hover rect { filter: brightness(1.2) saturate(1.15); }
</style>
