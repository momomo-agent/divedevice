<script setup lang="ts">
/**
 * Media —— 视频 / 音频 播放器。
 * 通过 fs.read 拉整文件 → Blob objectURL → <video>/<audio>
 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useDevice, useWindow } from '@/composables'

const { window: win } = useWindow()
const device = useDevice()
const props = defineProps<{ openPath?: string }>()

const path = ref<string | null>(props.openPath ?? null)
const url = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const isAudio = (p: string) => /\.(mp3|wav|flac|aac|m4a|ogg|opus)$/i.test(p)
const isVideo = (p: string) => /\.(mp4|mov|mkv|webm|m4v|avi|3gp)$/i.test(p)

function mime(p: string): string {
  const e = p.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  switch (e) {
    case 'mp4': case 'm4v': return 'video/mp4'
    case 'mov': return 'video/quicktime'
    case 'webm': return 'video/webm'
    case 'mkv': return 'video/x-matroska'
    case '3gp': return 'video/3gpp'
    case 'avi': return 'video/x-msvideo'
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'flac': return 'audio/flac'
    case 'aac': case 'm4a': return 'audio/mp4'
    case 'ogg': case 'opus': return 'audio/ogg'
    default: return 'application/octet-stream'
  }
}

async function load(p: string) {
  if (!device.value) { error.value = '未连接设备'; return }
  loading.value = true
  error.value = null
  if (url.value) { URL.revokeObjectURL(url.value); url.value = null }
  try {
    const bytes = await device.value.fs.read(p)
    const blob = new Blob([bytes as BlobPart], { type: mime(p) })
    url.value = URL.createObjectURL(blob)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch(path, (p) => { if (p) load(p) }, { immediate: true })
watch(() => win.value.deviceId, () => { if (path.value) load(path.value) })

onBeforeUnmount(() => { if (url.value) URL.revokeObjectURL(url.value) })

function fmt(p: string | null) {
  if (!p) return '—'
  return p.split('/').pop() ?? p
}
</script>

<template>
  <div class="media">
    <header>
      <span class="icon">{{ path && isAudio(path) ? '🎵' : '🎬' }}</span>
      <span class="name">{{ fmt(path) }}</span>
    </header>
    <div class="body">
      <div v-if="!path" class="center">未选择文件</div>
      <div v-else-if="loading" class="center">加载中… {{ fmt(path) }}</div>
      <div v-else-if="error" class="center err">{{ error }}</div>
      <video v-else-if="url && isVideo(path)" :src="url" controls autoplay />
      <div v-else-if="url && isAudio(path)" class="audio-wrap">
        <div class="audio-icon">🎵</div>
        <audio :src="url" controls autoplay />
      </div>
      <div v-else class="center">不支持的格式：{{ fmt(path) }}</div>
    </div>
  </div>
</template>

<style scoped>
.media {
  display: flex; flex-direction: column;
  height: 100%;
  background: var(--surface-1);
}
header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 12px;
  color: var(--fg-1);
}
header .icon { font-size: 14px; }
header .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body {
  flex: 1; min-height: 0;
  display: flex; align-items: center; justify-content: center;
  background: #000;
}
.body video {
  max-width: 100%; max-height: 100%;
  outline: none;
}
.audio-wrap {
  display: flex; flex-direction: column;
  align-items: center; gap: 14px;
  color: white;
}
.audio-icon { font-size: 56px; }
.audio-wrap audio { width: 380px; }
.center { color: var(--fg-3); font-size: 13px; }
.center.err { color: #ff8b7a; }
</style>
