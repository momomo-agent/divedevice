<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useDevice } from '@/composables'

const device = useDevice()
const imgRef = ref<HTMLImageElement | null>(null)
const status = ref('')
let currentBlob: Blob | null = null
let currentUrl: string | null = null

async function take() {
  if (!device.value) {
    status.value = '未连接设备'
    return
  }
  status.value = '截取中…'
  try {
    const png = await device.value.screen.capture()
    currentBlob = new Blob([png as BlobPart], { type: 'image/png' })
    if (currentUrl) URL.revokeObjectURL(currentUrl)
    currentUrl = URL.createObjectURL(currentBlob)
    if (imgRef.value) imgRef.value.src = currentUrl
    status.value = `${(png.length / 1024).toFixed(1)} KB`
  } catch (err) {
    status.value = (err as Error).message
  }
}

function download() {
  if (!currentUrl) return
  const a = document.createElement('a')
  a.href = currentUrl
  a.download = `screenshot-${Date.now()}.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

async function copy() {
  if (!currentBlob) return
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': currentBlob })])
    status.value = '已复制到剪贴板'
  } catch (err) {
    status.value = '复制失败：' + (err as Error).message
  }
}

onMounted(take)
onBeforeUnmount(() => {
  if (currentUrl) URL.revokeObjectURL(currentUrl)
})
</script>

<template>
  <div class="shot">
    <div class="toolbar">
      <button @click="take">📸 重新截图</button>
      <button @click="download" :disabled="!currentUrl">⬇ 下载</button>
      <button @click="copy" :disabled="!currentBlob">📋 复制</button>
      <span class="status">{{ status }}</span>
    </div>
    <div class="view">
      <img ref="imgRef" />
    </div>
  </div>
</template>

<style scoped>
.shot {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0a0c11;
}
.toolbar {
  display: flex;
  gap: 8px;
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
  font-size: 12px;
}
.toolbar button:disabled { opacity: 0.4; cursor: not-allowed; }
.toolbar button:hover:not(:disabled) { background: var(--surface-4); }
.status { color: var(--fg-3); flex: 1; }
.view {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.view img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
}
</style>
