<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useDevice, useWindow } from '@/composables'

const { window: win } = useWindow()
const device = useDevice()

const imgRef = ref<HTMLImageElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const status = ref('未启动')
const fps = ref(60)
const playing = ref(false)
const deviceSize = ref<{ w: number; h: number } | null>(null)

let lastUrl: string | null = null
let disposed = false
let raf = 0

async function captureOnce() {
  if (!device.value) return
  try {
    const png = await device.value.screen.capture()
    const blob = new Blob([png as BlobPart], { type: 'image/png' })
    if (lastUrl) URL.revokeObjectURL(lastUrl)
    lastUrl = URL.createObjectURL(blob)
    if (imgRef.value) imgRef.value.src = lastUrl
  } catch (err) {
    status.value = (err as Error).message
  }
}

async function loop() {
  if (!playing.value || disposed) return
  const start = Date.now()
  await captureOnce()
  if (!playing.value || disposed) return
  const target = 1000 / Math.max(1, fps.value)
  const remaining = Math.max(0, target - (Date.now() - start))
  raf = window.setTimeout(loop, remaining) as unknown as number
}

function play() {
  if (playing.value) return
  playing.value = true
  status.value = '实时'
  loop()
}

function pause() {
  playing.value = false
  if (raf) { clearTimeout(raf); raf = 0 }
  status.value = '已暂停'
}

async function refreshSize() {
  if (!device.value) return
  try {
    const { stdout } = await device.value.shell.exec('wm size')
    // "Physical size: 1080x2400"
    const m = stdout.match(/(\d+)x(\d+)/)
    if (m) deviceSize.value = { w: parseInt(m[1], 10), h: parseInt(m[2], 10) }
  } catch {}
}

function toDevicePoint(ev: MouseEvent): { x: number; y: number } | null {
  if (!imgRef.value || !deviceSize.value) return null
  const rect = imgRef.value.getBoundingClientRect()
  const x = ((ev.clientX - rect.left) / rect.width) * deviceSize.value.w
  const y = ((ev.clientY - rect.top) / rect.height) * deviceSize.value.h
  return { x: Math.round(x), y: Math.round(y) }
}

let dragStart: { x: number; y: number; ts: number } | null = null

async function onMouseDown(ev: MouseEvent) {
  const p = toDevicePoint(ev)
  if (!p) return
  dragStart = { ...p, ts: Date.now() }
}

async function onMouseUp(ev: MouseEvent) {
  if (!dragStart || !device.value) return
  const p = toDevicePoint(ev)
  if (!p) { dragStart = null; return }
  const dx = p.x - dragStart.x
  const dy = p.y - dragStart.y
  const dist = Math.hypot(dx, dy)
  const duration = Date.now() - dragStart.ts
  try {
    if (dist < 10 && duration < 300) {
      await device.value.input.tap(p.x, p.y)
    } else {
      await device.value.input.swipe(dragStart.x, dragStart.y, p.x, p.y, Math.max(duration, 120))
    }
  } catch (err) {
    console.error(err)
  } finally {
    dragStart = null
  }
}

async function onKey(ev: KeyboardEvent) {
  if (!device.value) return
  if (ev.key === 'Backspace') {
    ev.preventDefault()
    await device.value.input.key('KEYCODE_DEL')
    return
  }
  if (ev.key === 'Enter') {
    ev.preventDefault()
    await device.value.input.key('KEYCODE_ENTER')
    return
  }
  if (ev.key.length === 1) {
    ev.preventDefault()
    await device.value.input.text(ev.key)
  }
}

async function pressHome() { await device.value?.input.key('KEYCODE_HOME') }
async function pressBack() { await device.value?.input.key('KEYCODE_BACK') }
async function pressRecent() { await device.value?.input.key('KEYCODE_APP_SWITCH') }

onMounted(async () => {
  await refreshSize()
  await captureOnce()
})

onBeforeUnmount(() => {
  disposed = true
  if (raf) clearTimeout(raf)
  if (lastUrl) URL.revokeObjectURL(lastUrl)
})

watch(() => win.value.deviceId, async () => {
  pause()
  deviceSize.value = null
  await refreshSize()
  await captureOnce()
})
</script>

<template>
  <div class="cast" tabindex="0" @keydown="onKey">
    <div class="toolbar">
      <button v-if="!playing" @click="play">▶ 实时</button>
      <button v-else @click="pause">⏸ 暂停</button>
      <button @click="captureOnce">📸 刷新</button>
      <span class="fps">
        FPS:
        <input type="range" min="1" max="60" v-model.number="fps" />
        <span>{{ fps }}</span>
      </span>
      <span class="status">{{ status }}</span>
      <div class="nav">
        <button @click="pressBack">◁</button>
        <button @click="pressHome">○</button>
        <button @click="pressRecent">▢</button>
      </div>
    </div>
    <div ref="wrapRef" class="viewport">
      <img
        ref="imgRef"
        draggable="false"
        @mousedown.prevent="onMouseDown"
        @mouseup.prevent="onMouseUp"
      />
    </div>
  </div>
</template>

<style scoped>
.cast {
  display: flex;
  flex-direction: column;
  height: 100%;
  outline: none;
  background: #0a0c11;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 12px;
}
.toolbar button {
  background: var(--surface-3);
  border: none;
  border-radius: 5px;
  padding: 4px 10px;
  color: var(--fg-1);
  cursor: pointer;
  font-size: 12px;
}
.toolbar button:hover { background: var(--surface-4); }
.fps { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-2); }
.fps input { width: 80px; }
.status { flex: 1; color: var(--fg-3); }
.nav { display: flex; gap: 4px; }
.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.viewport img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  cursor: crosshair;
}
</style>
