<script setup lang="ts">
/**
 * Finder —— macOS 风格。
 * sidebar（收藏/位置）+ toolbar（后退/前进/上级/路径/视图切换/搜索）
 * + 三视图：Icons / List / Columns
 */
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useDevice, useWindow, useEventbus, useAppController } from '@/composables'
import { windowManager, lookupFileAssoc, isImageFile } from '@/services'
import type { FileEntry } from '@/device'

const { window: win } = useWindow()
const device = useDevice()
const eventbus = useEventbus()

const props = defineProps<{ initialPath?: string }>()

type ViewMode = 'icons' | 'list' | 'columns'
const view = ref<ViewMode>('list')

// ---- Navigation history ----
const history = ref<string[]>([props.initialPath ?? '/sdcard'])
const historyPos = ref(0)
const path = computed({
  get: () => history.value[historyPos.value] ?? '/sdcard',
  set: (v: string) => {
    // 丢弃 forward 历史
    history.value = history.value.slice(0, historyPos.value + 1)
    history.value.push(v)
    historyPos.value = history.value.length - 1
  },
})

function back() { if (historyPos.value > 0) historyPos.value-- }
function forward() { if (historyPos.value < history.value.length - 1) historyPos.value++ }
function goUp() {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  path.value = parts.length ? '/' + parts.join('/') : '/'
}

// ---- Shortcuts (sidebar) ----
const shortcuts = [
  { icon: '🏠', name: 'Home', path: '/sdcard' },
  { icon: '📥', name: 'Download', path: '/sdcard/Download' },
  { icon: '📷', name: 'DCIM', path: '/sdcard/DCIM' },
  { icon: '🖼', name: 'Pictures', path: '/sdcard/Pictures' },
  { icon: '🎬', name: 'Movies', path: '/sdcard/Movies' },
  { icon: '🎵', name: 'Music', path: '/sdcard/Music' },
  { icon: '📄', name: 'Documents', path: '/sdcard/Documents' },
  { icon: '💾', name: 'Android/data', path: '/sdcard/Android/data' },
  { icon: '🗄', name: '/', path: '/' },
]

// ---- Listing ----
const loading = ref(false)
const error = ref<string | null>(null)
const entries = ref<FileEntry[]>([])
const selected = ref<string | null>(null)

const searchQ = ref('')

async function load() {
  if (!device.value) {
    error.value = '未连接设备'
    entries.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    entries.value = await device.value.fs.ls(path.value)
    selected.value = null
  } catch (err) {
    error.value = (err as Error).message
    entries.value = []
  } finally {
    loading.value = false
  }
}

const visible = computed(() => {
  const q = searchQ.value.toLowerCase().trim()
  const list = q
    ? entries.value.filter((e) => e.name.toLowerCase().includes(q))
    : entries.value
  return [...list].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
})

const crumbs = computed(() => {
  const parts = path.value.split('/').filter(Boolean)
  const acc: Array<{ name: string; path: string }> = [{ name: '/', path: '/' }]
  let p = ''
  for (const part of parts) {
    p += '/' + part
    acc.push({ name: part, path: p })
  }
  return acc
})

// ---- App controller: expose state + events to desktop.send ----
useAppController({
  getState: () => ({
    path: path.value,
    view: view.value,
    search: searchQ.value,
    selected: selected.value,
    entryCount: entries.value.length,
  }),
  describe: () => ({
    events: [
      { name: 'navigate', description: 'Go to a path. payload: {path: string}' },
      { name: 'back', description: 'Go back in history' },
      { name: 'forward', description: 'Go forward in history' },
      { name: 'up', description: 'Go to parent directory' },
      { name: 'setView', description: 'Change layout. payload: {view: "icons"|"list"|"columns"}' },
      { name: 'search', description: 'Filter current dir. payload: {query: string}' },
      { name: 'refresh', description: 'Reload current dir' },
    ],
  }),
  async send(event, payload) {
    const p = (payload ?? {}) as Record<string, unknown>
    switch (event) {
      case 'navigate': {
        const target = String(p.path ?? '')
        if (!target) throw new Error('navigate requires payload.path')
        path.value = target
        return { ok: true, path: path.value }
      }
      case 'back': back(); return { ok: true, path: path.value }
      case 'forward': forward(); return { ok: true, path: path.value }
      case 'up': goUp(); return { ok: true, path: path.value }
      case 'setView': {
        const v = String(p.view ?? '')
        if (v !== 'icons' && v !== 'list' && v !== 'columns') throw new Error('view must be icons|list|columns')
        view.value = v
        return { ok: true, view: view.value }
      }
      case 'search': {
        searchQ.value = String(p.query ?? '')
        return { ok: true, search: searchQ.value, matches: visible.value.length }
      }
      case 'refresh': {
        await load()
        return { ok: true, entryCount: entries.value.length }
      }
      default: throw new Error(`Unknown finder event: ${event}`)
    }
  },
})

function onEnter(entry: FileEntry) {
  if (entry.isDir) {
    path.value = entry.path
    return
  }
  if (isImageFile(entry.name)) {
    openPreview(entry)
    return
  }
  const assoc = lookupFileAssoc(entry.path)
  // 已有目标 app 的窗口 → eventbus 广播（交给窗口自己新建 tab）
  const existing = windowManager.findByApp?.(assoc.appId, win.value.deviceId)
  if (existing) {
    windowManager.focus(existing.id)
    eventbus.emit('finder.openFile', {
      deviceId: win.value.deviceId!,
      path: entry.path,
    })
    return
  }
  // 新开一个
  windowManager.open({
    appId: assoc.appId,
    deviceId: win.value.deviceId,
    title: assoc.title?.(entry.name) ?? entry.name,
    props: { [assoc.pathProp]: entry.path },
  })
}

function isImage(name: string) {
  return isImageFile(name)
}

// ---- Quick image preview (list/icons 双击图片时用) ----
const previewEntry = ref<FileEntry | null>(null)
const previewUrl = ref<string | null>(null)
async function openPreview(e: FileEntry) {
  if (!device.value) return
  previewEntry.value = e
  previewUrl.value = null
  try {
    const bytes = await device.value.fs.read(e.path)
    const blob = new Blob([bytes as BlobPart], { type: sniffImage(e.name) })
    previewUrl.value = URL.createObjectURL(blob)
  } catch (err) {
    console.warn('[finder] preview', err)
    previewEntry.value = null
  }
}
function closePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  previewEntry.value = null
}
function sniffImage(n: string) {
  const m = n.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return m === 'png' ? 'image/png' : m === 'webp' ? 'image/webp' : m === 'gif' ? 'image/gif' : 'image/jpeg'
}

// ---- Columns view ----
interface Column { path: string; entries: FileEntry[]; loading: boolean; selected?: string }
const columns = ref<Column[]>([])
async function loadColumn(idx: number, p: string) {
  const c: Column = { path: p, entries: [], loading: true }
  columns.value = [...columns.value.slice(0, idx), c]
  try {
    const es = await device.value!.fs.ls(p)
    c.entries = es.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch (err) {
    c.entries = []
  } finally {
    c.loading = false
    columns.value = [...columns.value]
  }
}
function onColumnClick(colIdx: number, e: FileEntry) {
  columns.value[colIdx].selected = e.path
  columns.value = columns.value.slice(0, colIdx + 1)
  if (e.isDir) {
    loadColumn(colIdx + 1, e.path)
  } else if (isImage(e.name)) {
    openPreview(e)
  }
}

watch([path, () => win.value.deviceId, view], () => {
  if (view.value === 'columns') {
    columns.value = []
    if (device.value) loadColumn(0, path.value)
  } else {
    load()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function fmtTime(ts: number | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}
function iconOf(e: FileEntry) {
  if (e.isDir) return '📁'
  if (isImage(e.name)) return '🖼'
  if (/\.(mp4|mov|mkv|webm)$/i.test(e.name)) return '🎬'
  if (/\.(mp3|wav|flac|aac|m4a|ogg)$/i.test(e.name)) return '🎵'
  if (/\.(pdf|docx?|xlsx?|pptx?)$/i.test(e.name)) return '📄'
  if (/\.(zip|tar|gz|7z|rar)$/i.test(e.name)) return '🗜'
  if (/\.(js|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|cpp|h)$/i.test(e.name)) return '⌨'
  return '📄'
}
</script>

<template>
  <div class="finder">
    <!-- ================= Toolbar ================= -->
    <header class="toolbar">
      <div class="nav-btns">
        <button class="icon-btn" :disabled="historyPos <= 0" @click="back" title="后退">‹</button>
        <button class="icon-btn" :disabled="historyPos >= history.length - 1" @click="forward" title="前进">›</button>
        <button class="icon-btn" @click="goUp" title="上级">↑</button>
      </div>
      <div class="view-segmented" role="tablist">
        <button :class="{ active: view === 'icons' }" @click="view = 'icons'" title="图标视图">⊞</button>
        <button :class="{ active: view === 'list' }" @click="view = 'list'" title="列表视图">≡</button>
        <button :class="{ active: view === 'columns' }" @click="view = 'columns'" title="列视图">‖‖</button>
      </div>
      <div class="crumbs">
        <template v-for="(c, i) in crumbs" :key="c.path">
          <button class="crumb" @click="path = c.path">{{ c.name === '/' ? '根目录' : c.name }}</button>
          <span v-if="i < crumbs.length - 1" class="sep">›</span>
        </template>
      </div>
      <input v-model="searchQ" class="search" placeholder="搜索当前目录…" />
      <button class="icon-btn" @click="load" title="刷新">⟳</button>
    </header>

    <div class="body">
      <!-- ================= Sidebar ================= -->
      <aside class="sidebar">
        <div class="section-title">收藏</div>
        <button
          v-for="s in shortcuts"
          :key="s.path"
          class="shortcut"
          :class="{ active: path.startsWith(s.path) && (s.path === path || path.length === s.path.length || path[s.path.length] === '/') }"
          @click="path = s.path"
        >
          <span class="sc-icon">{{ s.icon }}</span>
          <span class="sc-name">{{ s.name }}</span>
        </button>
      </aside>

      <!-- ================= Main panel ================= -->
      <main class="content">
        <div v-if="error" class="error">{{ error }}</div>
        <div v-else-if="loading && view !== 'columns'" class="center">加载中…</div>

        <!-- Icons -->
        <div v-else-if="view === 'icons'" class="icons" @click.self="selected = null">
          <button
            v-for="e in visible"
            :key="e.path"
            class="tile"
            :class="{ selected: selected === e.path }"
            @click.stop="selected = e.path"
            @dblclick="onEnter(e)"
          >
            <div class="tile-icon">{{ iconOf(e) }}</div>
            <div class="tile-name">{{ e.name }}</div>
          </button>
          <div v-if="!visible.length" class="center muted">空目录</div>
        </div>

        <!-- List -->
        <div v-else-if="view === 'list'" class="list">
          <div class="list-header">
            <div class="col name">名称</div>
            <div class="col size">大小</div>
            <div class="col mtime">修改时间</div>
          </div>
          <div
            v-for="e in visible"
            :key="e.path"
            class="list-row"
            :class="{ selected: selected === e.path }"
            @click="selected = e.path"
            @dblclick="onEnter(e)"
          >
            <div class="col name">
              <span class="icon">{{ iconOf(e) }}</span>
              <span class="label">{{ e.name }}</span>
            </div>
            <div class="col size">{{ e.isDir ? '—' : fmtSize(e.size) }}</div>
            <div class="col mtime">{{ fmtTime(e.mtime) }}</div>
          </div>
          <div v-if="!visible.length" class="center muted">空目录</div>
        </div>

        <!-- Columns -->
        <div v-else class="columns">
          <div v-for="(col, idx) in columns" :key="idx" class="column">
            <div v-if="col.loading" class="center muted">…</div>
            <button
              v-for="e in col.entries"
              :key="e.path"
              class="col-item"
              :class="{ selected: col.selected === e.path, dir: e.isDir }"
              @click="onColumnClick(idx, e)"
              @dblclick="e.isDir ? (path = e.path) : onEnter(e)"
            >
              <span class="icon">{{ iconOf(e) }}</span>
              <span class="label">{{ e.name }}</span>
              <span v-if="e.isDir" class="chev">›</span>
            </button>
          </div>
        </div>
      </main>
    </div>

    <!-- ================= Status bar ================= -->
    <footer class="statusbar">
      <span>{{ visible.length }} 项</span>
      <span v-if="selected" class="sel">{{ selected.split('/').pop() }}</span>
    </footer>

    <!-- ================= Image preview overlay ================= -->
    <div v-if="previewEntry" class="preview" @click="closePreview">
      <img v-if="previewUrl" :src="previewUrl" :alt="previewEntry.name" @click.stop />
      <div v-else class="pv-loading">加载中…</div>
      <button class="pv-close" @click.stop="closePreview">×</button>
      <div class="pv-info" @click.stop>
        {{ previewEntry.name }} · {{ fmtSize(previewEntry.size) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.finder {
  display: flex; flex-direction: column;
  height: 100%;
  background: var(--surface-1);
  color: var(--fg-1);
  font-family: system-ui, -apple-system, 'SF Pro Text', sans-serif;
}

/* ---------- Toolbar ---------- */
.toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.nav-btns { display: flex; gap: 2px; }
.icon-btn {
  width: 26px; height: 26px;
  border-radius: 5px; border: none;
  background: transparent;
  color: var(--fg-2);
  cursor: pointer;
  font-size: 14px;
  transition: background 0.1s ease;
}
.icon-btn:hover { background: rgba(255,255,255,0.08); color: var(--fg-1); }
.icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.view-segmented {
  display: inline-flex;
  background: var(--surface-3);
  border-radius: 5px;
  padding: 2px;
  gap: 2px;
}
.view-segmented button {
  border: none; background: transparent;
  color: var(--fg-3);
  width: 26px; height: 22px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  font-family: ui-monospace, 'SF Mono', monospace;
}
.view-segmented button:hover { color: var(--fg-1); }
.view-segmented button.active {
  background: var(--surface-1);
  color: var(--fg-1);
  box-shadow: 0 1px 2px rgba(0,0,0,0.25);
}

.crumbs {
  flex: 1;
  display: flex; align-items: center;
  gap: 2px;
  overflow-x: auto;
  white-space: nowrap;
  font-size: 12px;
  color: var(--fg-2);
  background: var(--surface-3);
  padding: 3px 8px;
  border-radius: 5px;
  height: 26px;
  min-width: 120px;
}
.crumb {
  background: transparent; border: none;
  color: inherit; cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 12px;
}
.crumb:hover { background: rgba(255,255,255,0.08); color: var(--fg-1); }
.sep { color: var(--fg-3); padding: 0 2px; }

.search {
  width: 160px;
  background: var(--surface-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px;
  color: var(--fg-1);
  padding: 3px 10px;
  height: 26px;
  font-size: 12px;
}
.search:focus { outline: none; border-color: rgba(99,163,255,0.45); }

/* ---------- Body ---------- */
.body { flex: 1; display: flex; min-height: 0; }

.sidebar {
  width: 170px;
  flex-shrink: 0;
  background: var(--surface-2);
  border-right: 1px solid rgba(255,255,255,0.05);
  padding: 10px 0;
  overflow-y: auto;
}
.section-title {
  padding: 4px 14px 6px;
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
.shortcut {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% - 10px);
  margin: 1px 5px;
  padding: 4px 10px;
  border: none; background: transparent;
  color: var(--fg-2);
  border-radius: 5px;
  cursor: pointer;
  font-size: 12.5px;
  text-align: left;
}
.shortcut:hover { background: rgba(255,255,255,0.06); color: var(--fg-1); }
.shortcut.active {
  background: rgba(99,163,255,0.22);
  color: var(--fg-1);
}
.sc-icon { font-size: 14px; width: 16px; text-align: center; }
.sc-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.content { flex: 1; min-width: 0; overflow: auto; }
.center { padding: 30px; text-align: center; color: var(--fg-3); font-size: 12px; }
.center.muted { color: var(--fg-3); }
.error { padding: 16px; color: #ff8b7a; font-size: 12px; }

/* ---------- Icons view ---------- */
.icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 4px;
  padding: 14px;
}
.tile {
  display: flex; flex-direction: column; align-items: center;
  padding: 10px 6px;
  border: none; background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--fg-1);
}
.tile:hover { background: rgba(255,255,255,0.04); }
.tile.selected { background: rgba(99,163,255,0.28); }
.tile-icon { font-size: 40px; line-height: 1; }
.tile-name {
  font-size: 11.5px;
  margin-top: 4px;
  max-width: 100%;
  text-align: center;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- List view ---------- */
.list { min-width: 100%; }
.list-header {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 110px 180px;
  padding: 5px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 11px;
  color: var(--fg-3);
  letter-spacing: 0.3px;
  position: sticky; top: 0;
  z-index: 2;
}
.list-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 110px 180px;
  padding: 4px 12px;
  font-size: 12.5px;
  cursor: default;
  user-select: none;
  border-top: 1px solid rgba(255,255,255,0.02);
}
.list-row:hover { background: rgba(255,255,255,0.03); }
.list-row.selected { background: rgba(99,163,255,0.22); }
.list .col { display: flex; align-items: center; overflow: hidden; }
.list .col.name { gap: 8px; }
.list .col.name .icon { width: 16px; flex-shrink: 0; text-align: center; }
.list .col.name .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list .col.size { color: var(--fg-3); font-size: 11px; justify-self: flex-end; }
.list .col.mtime { color: var(--fg-3); font-size: 11px; }

/* ---------- Columns view ---------- */
.columns {
  display: flex;
  height: 100%;
  overflow-x: auto;
}
.column {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255,255,255,0.05);
  overflow-y: auto;
  padding: 4px 0;
}
.col-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 4px 12px;
  border: none; background: transparent;
  color: var(--fg-1);
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
}
.col-item:hover { background: rgba(255,255,255,0.05); }
.col-item.selected { background: rgba(99,163,255,0.28); }
.col-item .icon { width: 16px; flex-shrink: 0; text-align: center; }
.col-item .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-item .chev { color: var(--fg-3); font-size: 12px; }

/* ---------- Status bar ---------- */
.statusbar {
  display: flex; justify-content: space-between;
  padding: 4px 14px;
  background: var(--surface-2);
  border-top: 1px solid rgba(255,255,255,0.05);
  font-size: 10.5px;
  color: var(--fg-3);
}

/* ---------- Preview overlay ---------- */
.preview {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.9);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.preview img { max-width: 94%; max-height: 90%; object-fit: contain; }
.pv-loading { color: white; font-size: 14px; }
.pv-close {
  position: absolute; top: 14px; right: 14px;
  width: 36px; height: 36px; border-radius: 50%;
  border: none;
  background: rgba(255,255,255,0.1);
  color: white; font-size: 20px;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
.pv-close:hover { background: rgba(255,255,255,0.2); }
.pv-info {
  position: absolute; bottom: 14px; left: 50%;
  transform: translateX(-50%);
  color: white;
  background: rgba(0,0,0,0.6);
  padding: 5px 14px;
  border-radius: 20px;
  font-size: 12px;
  backdrop-filter: blur(10px);
}
</style>
