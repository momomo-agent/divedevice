<script setup lang="ts">
/**
 * Photos —— Android 相册浏览器。
 * 左侧相册列表（DCIM/Camera, DCIM/Screenshots, Pictures 等）+ 右侧缩略图网格 + 全屏预览。
 */
import { ref, shallowRef, computed, watch, onBeforeUnmount } from 'vue'
import { useDevice, useWindow } from '@/composables'
import type { FileEntry } from '@/device'

const { window: win } = useWindow()
const device = useDevice()

interface Album {
  name: string
  path: string
  count: number
  coverPath?: string
}

const albumRoots = [
  '/sdcard/DCIM',
  '/sdcard/Pictures',
  '/sdcard/Download',
  '/sdcard/Movies',
]
const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|heic|bmp)$/i

const loading = ref(false)
const error = ref<string | null>(null)
const albums = ref<Album[]>([])
const selectedAlbum = ref<string | null>(null)
const photos = shallowRef<FileEntry[]>([])
const loadingPhotos = ref(false)

/** path → objectURL 缓存（懒加载） */
const thumbCache = new Map<string, { url: string; loading: boolean }>()
const thumbTick = ref(0) // 触发 re-render

const previewIndex = ref<number | null>(null)
const previewPhoto = computed(() => {
  if (previewIndex.value === null) return null
  return photos.value[previewIndex.value] ?? null
})

async function loadAlbums() {
  if (!device.value) return
  loading.value = true
  error.value = null
  try {
    const found: Album[] = []
    for (const root of albumRoots) {
      try {
        const stat = await device.value.fs.stat(root)
        if (!stat?.isDir) continue
        const entries = await device.value.fs.ls(root)
        // 顶层图片 → 合并成一个 "<name>" 虚拟相册
        const topImgs = entries.filter((e) => !e.isDir && IMAGE_EXT.test(e.name))
        if (topImgs.length) {
          found.push({
            name: basename(root),
            path: root,
            count: topImgs.length,
            coverPath: topImgs[topImgs.length - 1].path,
          })
        }
        // 子目录递归一层找相册
        for (const sub of entries) {
          if (!sub.isDir) continue
          try {
            const subItems = await device.value.fs.ls(sub.path)
            const imgs = subItems.filter((e) => !e.isDir && IMAGE_EXT.test(e.name))
            if (imgs.length) {
              found.push({
                name: `${basename(root)} / ${sub.name}`,
                path: sub.path,
                count: imgs.length,
                coverPath: imgs[imgs.length - 1].path,
              })
            }
          } catch {}
        }
      } catch {}
    }
    albums.value = found
    if (!selectedAlbum.value && found.length) {
      selectedAlbum.value = found[0].path
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function loadPhotos(path: string) {
  if (!device.value) return
  loadingPhotos.value = true
  try {
    const entries = await device.value.fs.ls(path)
    photos.value = entries
      .filter((e) => !e.isDir && IMAGE_EXT.test(e.name))
      .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  } catch (err) {
    console.error('[photos]', err)
    photos.value = []
  } finally {
    loadingPhotos.value = false
  }
}

watch(selectedAlbum, (p) => { if (p) loadPhotos(p) })
watch(() => win.value.deviceId, () => {
  albums.value = []
  photos.value = []
  selectedAlbum.value = null
  thumbCache.forEach((t) => URL.revokeObjectURL(t.url))
  thumbCache.clear()
  loadAlbums()
}, { immediate: true })

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function thumbUrl(path: string): string | null {
  const hit = thumbCache.get(path)
  if (hit) return hit.loading ? null : hit.url
  // 懒加载
  thumbCache.set(path, { url: '', loading: true })
  ;(async () => {
    if (!device.value) return
    try {
      const bytes = await device.value.fs.read(path)
      const blob = new Blob([bytes as BlobPart], { type: sniffMime(path) })
      const url = URL.createObjectURL(blob)
      thumbCache.set(path, { url, loading: false })
      thumbTick.value++
    } catch (err) {
      thumbCache.delete(path)
      console.warn('[photos] thumb failed', path, err)
    }
  })()
  return null
}

function sniffMime(path: string): string {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = m?.[1] ?? ''
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'heic': return 'image/heic'
    case 'bmp': return 'image/bmp'
    default: return 'application/octet-stream'
  }
}

function openPreview(i: number) { previewIndex.value = i }
function closePreview() { previewIndex.value = null }
function prev() {
  if (previewIndex.value === null) return
  previewIndex.value = (previewIndex.value - 1 + photos.value.length) % photos.value.length
}
function next() {
  if (previewIndex.value === null) return
  previewIndex.value = (previewIndex.value + 1) % photos.value.length
}
function onKey(e: KeyboardEvent) {
  if (previewIndex.value === null) return
  // IME 候选/正在输入的 input/textarea 不抢方向键
  if (e.isComposing || e.keyCode === 229) return
  const active = document.activeElement as HTMLElement | null
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return
  if (e.key === 'Escape') closePreview()
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  thumbCache.forEach((t) => t.url && URL.revokeObjectURL(t.url))
  thumbCache.clear()
})

function formatSize(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="photos">
    <aside class="sidebar">
      <div class="section-title">相册</div>
      <div v-if="loading" class="hint">扫描中…</div>
      <div v-else-if="error" class="hint err">{{ error }}</div>
      <div v-else-if="!albums.length" class="hint">未找到图片</div>
      <button
        v-for="a in albums"
        :key="a.path"
        class="album"
        :class="{ active: a.path === selectedAlbum }"
        @click="selectedAlbum = a.path"
      >
        <div class="cover">
          <img v-if="a.coverPath && thumbUrl(a.coverPath) || thumbTick" :src="thumbCache.get(a.coverPath ?? '')?.url" alt="" />
          <span v-if="!thumbCache.get(a.coverPath ?? '')?.url" class="cover-placeholder">🖼</span>
        </div>
        <div class="meta">
          <div class="name">{{ a.name }}</div>
          <div class="count">{{ a.count }} 张</div>
        </div>
      </button>
      <button class="refresh" @click="loadAlbums" :disabled="loading">⟳ 刷新</button>
    </aside>

    <section class="main">
      <header class="toolbar">
        <div class="title">{{ albums.find(a => a.path === selectedAlbum)?.name ?? '—' }}</div>
        <div class="count">{{ photos.length }} 项</div>
      </header>
      <div v-if="loadingPhotos" class="hint center">加载中…</div>
      <div v-else-if="!photos.length" class="hint center">空相册</div>
      <div v-else class="grid" :data-tick="thumbTick">
        <button
          v-for="(p, i) in photos"
          :key="p.path"
          class="tile"
          @click="openPreview(i)"
          :title="`${p.name}\n${formatSize(p.size)}`"
        >
          <img v-if="thumbUrl(p.path)" :src="thumbCache.get(p.path)?.url" :alt="p.name" loading="lazy" />
          <span v-else class="tile-placeholder">…</span>
        </button>
      </div>
    </section>

    <div v-if="previewPhoto" class="preview" @click="closePreview">
      <img :src="thumbCache.get(previewPhoto.path)?.url" :alt="previewPhoto.name" @click.stop />
      <button class="pv-close" @click.stop="closePreview">×</button>
      <button class="pv-prev" @click.stop="prev" v-if="photos.length > 1">‹</button>
      <button class="pv-next" @click.stop="next" v-if="photos.length > 1">›</button>
      <div class="pv-info" @click.stop>
        {{ previewPhoto.name }} · {{ formatSize(previewPhoto.size) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.photos { display: flex; height: 100%; background: var(--surface-1); }
.sidebar {
  width: 220px;
  border-right: 1px solid rgba(255,255,255,0.06);
  background: var(--surface-2);
  overflow-y: auto;
  padding: 8px 0;
  flex-shrink: 0;
}
.section-title {
  padding: 4px 12px 6px;
  font-size: 10px;
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.hint { padding: 8px 12px; font-size: 11px; color: var(--fg-3); }
.hint.err { color: #f87171; }
.hint.center { text-align: center; padding: 60px; }
.album {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  background: transparent;
  border: none;
  color: var(--fg-1);
  cursor: pointer;
  text-align: left;
}
.album:hover { background: rgba(255,255,255,0.05); }
.album.active { background: rgba(99,163,255,0.18); }
.cover {
  width: 36px; height: 36px; border-radius: 6px;
  background: var(--surface-3);
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.cover img { width: 100%; height: 100%; object-fit: cover; }
.cover-placeholder { font-size: 14px; opacity: 0.4; }
.meta { min-width: 0; flex: 1; }
.meta .name { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .count { font-size: 10px; color: var(--fg-3); }
.refresh {
  margin: 8px 12px;
  background: var(--surface-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px;
  color: var(--fg-2);
  padding: 4px;
  cursor: pointer;
  font-size: 11px;
}

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.toolbar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  background: var(--surface-2);
}
.toolbar .title { font-size: 12px; color: var(--fg-1); flex: 1; font-weight: 500; }
.toolbar .count { font-size: 10px; color: var(--fg-3); }

.grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 4px;
}
.tile {
  position: relative;
  aspect-ratio: 1 / 1;
  border: none;
  padding: 0;
  background: var(--surface-3);
  cursor: pointer;
  overflow: hidden;
  border-radius: 2px;
}
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile:hover { outline: 2px solid rgba(99,163,255,0.55); }
.tile-placeholder {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--fg-3);
  font-size: 14px;
}

.preview {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.92);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.preview img { max-width: 96%; max-height: 92%; object-fit: contain; }
.pv-close, .pv-prev, .pv-next {
  position: absolute;
  background: rgba(255,255,255,0.1);
  color: white;
  border: none;
  border-radius: 50%;
  width: 40px; height: 40px;
  font-size: 22px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.pv-close { top: 16px; right: 16px; }
.pv-prev { left: 16px; top: 50%; transform: translateY(-50%); }
.pv-next { right: 16px; top: 50%; transform: translateY(-50%); }
.pv-close:hover, .pv-prev:hover, .pv-next:hover { background: rgba(255,255,255,0.2); }
.pv-info {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  background: rgba(0,0,0,0.6);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  backdrop-filter: blur(10px);
}
</style>
