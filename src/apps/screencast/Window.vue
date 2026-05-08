<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import { useDevice, useWindow } from '@/composables'

const { window: win } = useWindow()
const device = useDevice()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const status = ref('未启动')
const playing = ref(false)
const deviceSize = ref<{ w: number; h: number } | null>(null)

// 实时性指标
const fpsActual = ref(0)
const latencyMs = ref(0)
const frameMs = ref(0) // 单帧获取耗时
const mode = ref<'framebuffer' | 'png'>('framebuffer')
const fpsCap = ref(0) // 0 = 无上限（设备能多快抄多快）

let disposed = false
let frameTimestamps: number[] = [] // 滚动窗口统计 FPS
let pauseTimeoutId = 0

/** 写 raw RGBA 到 canvas。处理 BGRA 互换（少见设备） */
function paintRawFrame(f: { width: number; height: number; data: Uint8Array; redOffset: number; blueOffset: number }) {
  const canvas = canvasRef.value
  if (!canvas) return
  // size 变了才 reset（reset 会清 GPU texture，很贵）
  if (canvas.width !== f.width || canvas.height !== f.height) {
    canvas.width = f.width
    canvas.height = f.height
  }
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return

  // framebuffer 各机 RGBA vs BGRA 不同。按 offset 判断：
  // RGBA 标准：red_offset=0, blue_offset=16 → 直接 put
  // BGRA：red_offset=16, blue_offset=0 → 要换 R 和 B
  const needSwap = f.redOffset === 16 && f.blueOffset === 0
  let pixels: Uint8ClampedArray
  if (needSwap) {
    const src = f.data
    const out = new Uint8ClampedArray(src.length)
    for (let i = 0; i < src.length; i += 4) {
      out[i] = src[i + 2]     // R <- B
      out[i + 1] = src[i + 1] // G
      out[i + 2] = src[i]     // B <- R
      out[i + 3] = 255        // alpha 有些设备不给有效值，强制 opaque
    }
    pixels = out
  } else {
    // 直接用 buffer（零拷贝）
    pixels = new Uint8ClampedArray(f.data.buffer, f.data.byteOffset, f.data.byteLength)
  }
  const imgData = new ImageData(pixels, f.width, f.height)
  ctx.putImageData(imgData, 0, 0)
}

/** 帧报到 timestamps 窗口，刷新 fpsActual */
function reportFrame() {
  const now = performance.now()
  frameTimestamps.push(now)
  const cutoff = now - 1000
  while (frameTimestamps.length && frameTimestamps[0] < cutoff) frameTimestamps.shift()
  fpsActual.value = frameTimestamps.length
}

/** 协调 fpsCap：上一帧结束距离 now 少于 target 等一把 */
let lastFrameEnd = 0
async function throttle() {
  if (!fpsCap.value) return
  const target = 1000 / fpsCap.value
  const wait = Math.max(0, target - (performance.now() - lastFrameEnd))
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

/** 主循环：电流式单稿工作队列——上一帧 paint 完成后立即 kick 下一帧拓 */
async function loop() {
  while (playing.value && !disposed && device.value) {
    const t0 = performance.now()
    try {
      if (mode.value === 'framebuffer') {
        const f = await device.value.screen.frame()
        const t1 = performance.now()
        // paint 和拉下一帧无法真并行（一个 ADB channel），paint 很快不干受
        paintRawFrame(f)
        frameMs.value = Math.round(t1 - t0)
        latencyMs.value = Math.round(performance.now() - t0)
        if (!deviceSize.value || deviceSize.value.w !== f.width || deviceSize.value.h !== f.height) {
          deviceSize.value = { w: f.width, h: f.height }
        }
      } else {
        // fallback PNG mode（与旧一致，留着调试）
        const png = await device.value.screen.capture()
        const blob = new Blob([png as BlobPart], { type: 'image/png' })
        const bmp = await createImageBitmap(blob)
        const canvas = canvasRef.value
        if (canvas) {
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width
            canvas.height = bmp.height
          }
          const ctx = canvas.getContext('2d', { alpha: false })
          ctx?.drawImage(bmp, 0, 0)
        }
        bmp.close()
        frameMs.value = Math.round(performance.now() - t0)
        latencyMs.value = frameMs.value
      }
      reportFrame()
      lastFrameEnd = performance.now()
      await throttle()
    } catch (err) {
      status.value = (err as Error).message
      // 出错后暂停 500ms 再试，避免破坏震荡
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

async function captureOnce() {
  if (!device.value) return
  const t0 = performance.now()
  try {
    if (mode.value === 'framebuffer') {
      const f = await device.value.screen.frame()
      paintRawFrame(f)
      deviceSize.value = { w: f.width, h: f.height }
    } else {
      const png = await device.value.screen.capture()
      const blob = new Blob([png as BlobPart], { type: 'image/png' })
      const bmp = await createImageBitmap(blob)
      const canvas = canvasRef.value
      if (canvas) {
        if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
          canvas.width = bmp.width
          canvas.height = bmp.height
        }
        const ctx = canvas.getContext('2d', { alpha: false })
        ctx?.drawImage(bmp, 0, 0)
      }
      bmp.close()
      deviceSize.value = { w: canvas?.width ?? 0, h: canvas?.height ?? 0 }
    }
    frameMs.value = Math.round(performance.now() - t0)
  } catch (err) {
    status.value = (err as Error).message
  }
}

function play() {
  if (playing.value) return
  playing.value = true
  status.value = '实时'
  frameTimestamps = []
  lastFrameEnd = 0
  loop()
}

function pause() {
  playing.value = false
  if (pauseTimeoutId) { clearTimeout(pauseTimeoutId); pauseTimeoutId = 0 }
  status.value = '已暂停'
}

// 死角检测：若 1.5s 没帧了则展示 warning
const stale = computed(() => playing.value && latencyMs.value > 1500)

function toDevicePoint(ev: MouseEvent): { x: number; y: number } | null {
  if (!canvasRef.value || !deviceSize.value) return null
  const rect = canvasRef.value.getBoundingClientRect()
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
  // IME 候选状态不要把键打到设备，让输入法先处理
  if (ev.isComposing || ev.keyCode === 229 || ev.key === 'Process') return
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
  await captureOnce()
  // 默认一进来就拉起来，追求实时
  play()
})

onBeforeUnmount(() => {
  disposed = true
  if (pauseTimeoutId) clearTimeout(pauseTimeoutId)
})

watch(() => win.value.deviceId, async () => {
  pause()
  deviceSize.value = null
  await captureOnce()
  play()
})
async function onCompositionEnd(ev: CompositionEvent) {
  // 拼音/注音/日文/韩文输入法上屏后一次性发给设备
  const text = ev.data
  if (!text || !device.value) return
  try { await device.value.input.text(text) } catch (err) { console.error('[screencast/composition]', err) }
}
</script>

<template>
  <div class="cast" tabindex="0" @keydown="onKey" @compositionend="onCompositionEnd">
    <div class="toolbar">
      <button v-if="!playing" @click="play">▶ 实时</button>
      <button v-else @click="pause">⏸ 暂停</button>
      <button @click="captureOnce">📸 刷新</button>
      <span class="metric" :class="{ stale }" title="实际帧率 / 单帧延迟">
        <b>{{ fpsActual }}</b> fps · <b>{{ latencyMs }}</b>ms
      </span>
      <span class="mode">
        <label><input type="radio" value="framebuffer" v-model="mode" /> raw</label>
        <label><input type="radio" value="png" v-model="mode" /> png</label>
      </span>
      <span class="cap">
        cap:
        <select v-model.number="fpsCap">
          <option :value="0">∅</option>
          <option :value="15">15</option>
          <option :value="30">30</option>
          <option :value="60">60</option>
        </select>
      </span>
      <span class="status">{{ status }}</span>
      <div class="nav">
        <button @click="pressBack">◁</button>
        <button @click="pressHome">○</button>
        <button @click="pressRecent">▢</button>
      </div>
    </div>
    <div ref="wrapRef" class="viewport">
      <canvas
        ref="canvasRef"
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
  gap: 10px;
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
.metric { color: var(--fg-2); font-variant-numeric: tabular-nums; }
.metric b { color: var(--fg-1); }
.metric.stale { color: #f87171; }
.metric.stale b { color: #fca5a5; }
.mode, .cap { color: var(--fg-3); display: inline-flex; gap: 6px; align-items: center; }
.mode label { display: inline-flex; gap: 2px; align-items: center; cursor: pointer; }
.cap select {
  background: var(--surface-3);
  color: var(--fg-1);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 11px;
}
.status { flex: 1; color: var(--fg-3); text-align: right; }
.nav { display: flex; gap: 4px; }
.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.viewport canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
  cursor: crosshair;
  image-rendering: pixelated; /* 像素友好放大缩小 */
}
</style>
