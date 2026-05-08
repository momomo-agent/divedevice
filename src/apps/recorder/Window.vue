<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useDevice } from '@/composables'

const device = useDevice()
const status = ref('空闲')
const recording = ref(false)
const fps = ref(60)
const elapsed = ref(0)
const lastBlobUrl = ref<string | null>(null)

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let recorder: MediaRecorder | null = null
let chunks: BlobPart[] = []
let stopRequested = false
let captureTimer = 0
let elapsedTimer = 0
let startedAt = 0

async function start() {
  if (!device.value) {
    status.value = '未连接设备'
    return
  }
  // 先抓一帧定尺寸
  status.value = '初始化…'
  const first = await device.value.screen.capture()
  const bitmap = await createImageBitmap(new Blob([first], { type: 'image/png' }))
  canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()

  const stream = canvas.captureStream(fps.value)
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm'
  recorder = new MediaRecorder(stream, { mimeType: mime })
  chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mime })
    if (lastBlobUrl.value) URL.revokeObjectURL(lastBlobUrl.value)
    lastBlobUrl.value = URL.createObjectURL(blob)
    status.value = `录制完成，${(blob.size / 1024 / 1024).toFixed(2)} MB`
  }
  recorder.start()
  recording.value = true
  stopRequested = false
  startedAt = Date.now()
  status.value = '录制中'

  elapsedTimer = window.setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000)
  }, 500) as unknown as number

  const loop = async () => {
    if (stopRequested || !device.value || !ctx) return
    const t0 = Date.now()
    try {
      const png = await device.value.screen.capture()
      const b = await createImageBitmap(new Blob([png], { type: 'image/png' }))
      ctx.drawImage(b, 0, 0, canvas!.width, canvas!.height)
      b.close()
    } catch (err) {
      console.error(err)
    }
    if (stopRequested) return
    const target = 1000 / Math.max(1, fps.value)
    const remaining = Math.max(0, target - (Date.now() - t0))
    captureTimer = window.setTimeout(loop, remaining) as unknown as number
  }
  loop()
}

function stop() {
  stopRequested = true
  if (captureTimer) { clearTimeout(captureTimer); captureTimer = 0 }
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = 0 }
  recorder?.stop()
  recording.value = false
}

function download() {
  if (!lastBlobUrl.value) return
  const a = document.createElement('a')
  a.href = lastBlobUrl.value
  a.download = `screen-${Date.now()}.webm`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

onBeforeUnmount(() => {
  stop()
  if (lastBlobUrl.value) URL.revokeObjectURL(lastBlobUrl.value)
})
</script>

<template>
  <div class="rec">
    <div class="toolbar">
      <button v-if="!recording" class="primary" @click="start">● 开始录制</button>
      <button v-else class="danger" @click="stop">■ 停止</button>
      <span class="fps">
        FPS:
        <input type="range" min="2" max="60" v-model.number="fps" :disabled="recording" />
        <span>{{ fps }}</span>
      </span>
      <span v-if="recording" class="timer">{{ fmt(elapsed) }}</span>
      <span class="status">{{ status }}</span>
    </div>
    <div class="preview">
      <video v-if="lastBlobUrl" :src="lastBlobUrl" controls />
      <div v-else class="placeholder">录制完成后在这里预览</div>
    </div>
    <div v-if="lastBlobUrl" class="actions">
      <button @click="download">⬇ 下载 webm</button>
    </div>
  </div>
</template>

<style scoped>
.rec {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0c11;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
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
}
.toolbar button.primary { background: rgba(239, 68, 68, 0.22); color: #fca5a5; }
.toolbar button.danger { background: rgba(239, 68, 68, 0.85); color: white; }
.fps { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-2); }
.fps input { width: 80px; }
.timer { font-family: ui-monospace, monospace; color: #f87171; }
.status { flex: 1; color: var(--fg-3); }
.preview {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.preview video { max-width: 100%; max-height: 100%; border-radius: 6px; }
.placeholder { color: var(--fg-3); font-size: 12px; }
.actions { padding: 8px 10px; border-top: 1px solid rgba(255, 255, 255, 0.06); }
.actions button {
  background: rgba(99, 163, 255, 0.22);
  color: var(--fg-1);
  border: none;
  border-radius: 5px;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 12px;
}
</style>
