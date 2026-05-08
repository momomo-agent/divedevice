<script setup lang="ts">
/**
 * Finder —— macOS 风格。
 * sidebar（收藏/位置）+ toolbar（后退/前进/上级/路径/视图切换/搜索）
 * + 三视图：Icons / List / Columns
 */
import { ref, watch, computed, onBeforeUnmount } from 'vue'
import { useDevice, useWindow, useEventbus, useAppController } from '@/composables'
import { windowManager, lookupFileAssoc, isImageFile, chat } from '@/services'
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
      { name: 'newFolder', description: 'Create a new folder in current dir (auto-named, enters rename mode)' },
      { name: 'rename', description: 'Rename a file/dir. payload: {from: string, to: string}' },
      { name: 'delete', description: 'Delete a path. payload: {path: string}' },
      { name: 'download', description: 'Download a file/dir to user’s machine. payload: {path: string}' },
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
      case 'newFolder': {
        await newFolder()
        return { ok: true, path: selected.value }
      }
      case 'rename': {
        const from = String(p.from ?? '')
        const to = String(p.to ?? '')
        if (!from || !to) throw new Error('rename requires payload.from + payload.to')
        await device.value!.fs.rename(from, to)
        await load()
        return { ok: true, from, to }
      }
      case 'delete': {
        const target = String(p.path ?? '')
        if (!target) throw new Error('delete requires payload.path')
        const st = await device.value!.fs.stat(target)
        await device.value!.fs.rm(target, st?.isDir ?? false)
        await load()
        return { ok: true, deleted: target }
      }
      case 'download': {
        const target = String(p.path ?? '')
        if (!target) throw new Error('download requires payload.path')
        const st = await device.value!.fs.stat(target)
        if (!st) throw new Error('path not found')
        await downloadEntry(st)
        return { ok: true, path: target }
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

// ---- File operations: new folder / rename / delete / download / upload ----
function joinPath(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir.replace(/\/$/, '')}/${name}`
}

function suggestName(base: string): string {
  // 汇入本目录已有的名字集合
  const used = new Set(entries.value.map((e) => e.name))
  if (!used.has(base)) return base
  let i = 2
  while (true) {
    const cand = `${base} ${i}`
    if (!used.has(cand)) return cand
    i++
    if (i > 1000) return `${base} ${Date.now()}`
  }
}

const busy = ref<string | null>(null)
async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  busy.value = label
  try { return await fn() } finally { busy.value = null }
}

// New folder — 不弹原生 prompt，直接创建“新建文件夹”然后立刻进入重命名模式。
async function newFolder() {
  if (!device.value) return
  const name = suggestName('新建文件夹')
  const full = joinPath(path.value, name)
  await withBusy(`创建 ${name}…`, async () => {
    await device.value!.fs.mkdir(full, false)
    await load()
  })
  selected.value = full
  renamingPath.value = full
  renamingValue.value = name
}

// Rename — inline edit
const renamingPath = ref<string | null>(null)
const renamingValue = ref('')
async function commitRename() {
  if (!renamingPath.value || !device.value) { cancelRename(); return }
  const from = renamingPath.value
  const newName = renamingValue.value.trim()
  const oldName = from.split('/').pop()!
  if (!newName || newName === oldName) { cancelRename(); return }
  if (newName.includes('/')) { chat.push('system', '文件名不能包含 "/"'); cancelRename(); return }
  const parent = from.substring(0, from.lastIndexOf('/')) || '/'
  const to = joinPath(parent, newName)
  await withBusy(`重命名 → ${newName}`, async () => {
    await device.value!.fs.rename(from, to)
    await load()
  }).catch((err) => chat.push('system', `重命名失败: ${(err as Error).message}`))
  renamingPath.value = null
  selected.value = to
}
function cancelRename() {
  renamingPath.value = null
  renamingValue.value = ''
}
function startRename(e: FileEntry) {
  renamingPath.value = e.path
  renamingValue.value = e.name
}

// Delete
async function deleteSelected() {
  if (!selected.value || !device.value) return
  const target = entries.value.find((e) => e.path === selected.value)
  if (!target) return
  if (!confirm(`确定删除 ${target.name}${target.isDir ? '（整个目录）' : ''}？`)) return
  await withBusy(`删除 ${target.name}…`, async () => {
    await device.value!.fs.rm(target.path, target.isDir)
    await load()
  }).catch((err) => chat.push('system', `删除失败: ${(err as Error).message}`))
}

// Download selected (or specific entry) to user's machine via <a download>
async function downloadEntry(e: FileEntry) {
  if (!device.value) return
  if (e.isDir) {
    // 目录：tar 打包流输出再存为 .tar
    await withBusy(`打包 ${e.name}…`, async () => {
      const proc = await device.value!.shell.spawn(`tar -cf - -C "${e.path.substring(0, e.path.lastIndexOf('/')) || '/'}" "${e.name}"`)
      const chunks: Uint8Array[] = []
      // @ts-expect-error stream compat
      const reader = (proc.output as ReadableStream<Uint8Array>).getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      let total = 0
      for (const c of chunks) total += c.byteLength
      const buf = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { buf.set(c, off); off += c.byteLength }
      triggerDownload(new Blob([buf], { type: 'application/x-tar' }), `${e.name}.tar`)
    }).catch((err) => chat.push('system', `下载失败: ${(err as Error).message}`))
  } else {
    await withBusy(`下载 ${e.name}…`, async () => {
      const bytes = await device.value!.fs.read(e.path)
      triggerDownload(new Blob([bytes as BlobPart]), e.name)
    }).catch((err) => chat.push('system', `下载失败: ${(err as Error).message}`))
  }
}
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---- Upload via drag&drop or file picker ----
interface Transfer {
  id: number
  name: string
  total: number
  sent: number
  status: 'running' | 'done' | 'error'
  error?: string
}
const transfers = ref<Transfer[]>([])
let _tid = 0
const dragHover = ref(false)

function walkFileSystemEntry(entry: any, pathPrefix: string, out: Array<{ file: File; relPath: string }>): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as any).file((f: File) => {
        out.push({ file: f, relPath: pathPrefix + f.name })
        resolve()
      }, () => resolve())
    } else if (entry.isDirectory) {
      const reader = (entry as any).createReader()
      const readAll = (acc: any[] = []): Promise<any[]> => new Promise((res) => {
        reader.readEntries((ents: any[]) => {
          if (!ents.length) res(acc)
          else readAll(acc.concat(ents)).then(res)
        }, () => res(acc))
      })
      readAll().then(async (ents) => {
        for (const child of ents) {
          await walkFileSystemEntry(child, pathPrefix + entry.name + '/', out)
        }
        resolve()
      })
    } else { resolve() }
  })
}

async function collectDropped(dt: DataTransfer): Promise<Array<{ file: File; relPath: string }>> {
  const out: Array<{ file: File; relPath: string }> = []
  const items = Array.from(dt.items || [])
  if (items.some((it) => typeof (it as any).webkitGetAsEntry === 'function')) {
    for (const it of items) {
      if (it.kind !== 'file') continue
      const entry = (it as any).webkitGetAsEntry?.()
      if (!entry) continue
      await walkFileSystemEntry(entry, '', out)
    }
    if (out.length) return out
  }
  // Fallback
  for (const f of Array.from(dt.files || [])) {
    out.push({ file: f, relPath: f.name })
  }
  return out
}

async function uploadFiles(files: Array<{ file: File; relPath: string }>) {
  if (!device.value || !files.length) return
  // 确保需要的子目录
  const dirsToCreate = new Set<string>()
  for (const f of files) {
    const sub = f.relPath.substring(0, f.relPath.lastIndexOf('/'))
    if (sub) dirsToCreate.add(joinPath(path.value, sub))
  }
  for (const d of dirsToCreate) {
    try { await device.value!.fs.mkdir(d, true) } catch { /* ignore */ }
  }
  for (const { file, relPath } of files) {
    const dest = joinPath(path.value, relPath)
    const t: Transfer = { id: ++_tid, name: relPath, total: file.size, sent: 0, status: 'running' }
    transfers.value.push(t)
    try {
      const ws = await device.value!.fs.writeStream(dest, file.size)
      const reader = file.stream().getReader()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          await ws.write(value)
          t.sent += value.byteLength
          transfers.value = [...transfers.value]
        }
      }
      await ws.close()
      t.status = 'done'
    } catch (err) {
      t.status = 'error'
      t.error = (err as Error).message
      chat.push('system', `上传失败 ${relPath}: ${t.error}`)
    }
    transfers.value = [...transfers.value]
  }
  await load()
  // 3 秒后清掉已完成的
  setTimeout(() => {
    transfers.value = transfers.value.filter((x) => x.status === 'running')
  }, 3000)
}

async function onDrop(ev: DragEvent) {
  ev.preventDefault()
  dragHover.value = false
  if (!ev.dataTransfer || !device.value) return
  const files = await collectDropped(ev.dataTransfer)
  if (!files.length) return
  await uploadFiles(files)
}
function onDragEnter(ev: DragEvent) {
  if (!ev.dataTransfer?.types?.includes('Files')) return
  ev.preventDefault()
  dragHover.value = true
}
function onDragLeave(ev: DragEvent) {
  // 只有离开容器本身时才真的绿灯
  if (ev.currentTarget === ev.target) dragHover.value = false
}
function onDragOver(ev: DragEvent) {
  if (!ev.dataTransfer?.types?.includes('Files')) return
  ev.preventDefault()
  ev.dataTransfer.dropEffect = 'copy'
}

// 点 toolbar 上传 button 走隐藏 input
const fileInputRef = ref<HTMLInputElement | null>(null)
async function onFileInput(ev: Event) {
  const input = ev.target as HTMLInputElement
  if (!input.files?.length) return
  const list: Array<{ file: File; relPath: string }> = []
  for (const f of Array.from(input.files)) {
    // 如果支持 webkitdirectory 会带相对路径
    const rel = (f as any).webkitRelativePath && (f as any).webkitRelativePath.length
      ? (f as any).webkitRelativePath
      : f.name
    list.push({ file: f, relPath: rel })
  }
  await uploadFiles(list)
  input.value = ''
}

function fmtPct(t: Transfer) {
  if (!t.total) return '0%'
  return `${Math.floor((t.sent / t.total) * 100)}%`
}

// autofocus directive for rename input
const vFocus = {
  mounted(el: HTMLElement) {
    const input = (el.tagName === 'INPUT' ? el : el.querySelector('input')) as HTMLInputElement | null
    input?.focus()
    input?.select()
  },
}

// Context menu
interface ContextMenu {
  x: number
  y: number
  entry: FileEntry
}
const contextMenu = ref<ContextMenu | null>(null)
function openContextMenu(ev: MouseEvent, e: FileEntry) {
  contextMenu.value = { x: ev.clientX, y: ev.clientY, entry: e }
}
function closeContextMenu() { contextMenu.value = null }
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
      <button class="icon-btn" @click="newFolder" title="新建文件夹 (N)">➕</button>
      <button
        class="icon-btn"
        :disabled="!selected"
        @click="() => { const e = entries.find(x => x.path === selected); if (e) startRename(e) }"
        title="重命名 (F2)"
      >✏️</button>
      <button
        class="icon-btn"
        :disabled="!selected"
        @click="() => { const e = entries.find(x => x.path === selected); if (e) downloadEntry(e) }"
        title="下载到本地"
      >⬇️</button>
      <button class="icon-btn" @click="() => fileInputRef?.click()" title="上传文件">⬆️</button>
      <button class="icon-btn" :disabled="!selected" @click="deleteSelected" title="删除 (Del)">🗑</button>
      <input ref="fileInputRef" type="file" multiple style="display:none" @change="onFileInput" />
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
      <main
        class="content"
        :class="{ 'drag-hover': dragHover }"
        @dragenter="onDragEnter"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
        @keydown.f2.prevent="() => { const e = entries.find(x => x.path === selected); if (e) startRename(e) }"
        @keydown.delete.prevent="deleteSelected"
        tabindex="0"
      >
        <div v-if="error" class="error">{{ error }}</div>
        <div v-else-if="loading && view !== 'columns'" class="center">加载中…</div>

        <!-- Icons -->
        <div v-else-if="view === 'icons'" class="icons" @click.self="selected = null">
          <div
            v-for="e in visible"
            :key="e.path"
            class="tile"
            :class="{ selected: selected === e.path }"
            tabindex="0"
            @click.stop="selected = e.path"
            @dblclick="onEnter(e)"
            @contextmenu.prevent="(ev) => { selected = e.path; openContextMenu(ev, e) }"
          >
            <div class="tile-icon">{{ iconOf(e) }}</div>
            <input
              v-if="renamingPath === e.path"
              class="rename-input tile-rename"
              v-model="renamingValue"
              v-focus
              @keydown.enter.prevent="commitRename"
              @keydown.escape.prevent="cancelRename"
              @blur="commitRename"
              @click.stop
            />
            <div v-else class="tile-name">{{ e.name }}</div>
          </div>
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
            @contextmenu.prevent="(ev) => { selected = e.path; openContextMenu(ev, e) }"
          >
            <div class="col name">
              <span class="icon">{{ iconOf(e) }}</span>
              <input
                v-if="renamingPath === e.path"
                class="rename-input"
                v-model="renamingValue"
                v-focus
                @keydown.enter.prevent="commitRename"
                @keydown.escape.prevent="cancelRename"
                @blur="commitRename"
                @click.stop
              />
              <span v-else class="label">{{ e.name }}</span>
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

    <!-- ================= Transfer progress ================= -->
    <div v-if="transfers.length" class="transfers">
      <div v-for="t in transfers" :key="t.id" class="xfer" :class="t.status">
        <div class="xfer-head">
          <span class="xfer-name" :title="t.name">{{ t.name }}</span>
          <span class="xfer-pct">
            <template v-if="t.status === 'running'">{{ fmtPct(t) }}</template>
            <template v-else-if="t.status === 'done'">✓</template>
            <template v-else>✗ {{ t.error }}</template>
          </span>
        </div>
        <div class="xfer-bar">
          <div class="xfer-fill" :style="{ width: t.total ? ((t.sent / t.total) * 100) + '%' : '100%' }" />
        </div>
      </div>
    </div>

    <!-- ================= Drop overlay ================= -->
    <div v-if="dragHover" class="drop-overlay">
      <div class="drop-box">⬇ 松手上传到 <b>{{ path }}</b></div>
    </div>

    <!-- ================= Context menu ================= -->
    <div
      v-if="contextMenu"
      class="ctx-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @click.stop
    >
      <button @click="onEnter(contextMenu.entry); closeContextMenu()">打开</button>
      <button @click="startRename(contextMenu.entry); closeContextMenu()">重命名</button>
      <button @click="downloadEntry(contextMenu.entry); closeContextMenu()">下载到本地</button>
      <div class="ctx-sep"></div>
      <button class="danger" @click="selected = contextMenu.entry.path; deleteSelected(); closeContextMenu()">删除</button>
    </div>
    <div v-if="contextMenu" class="ctx-backdrop" @click="closeContextMenu" @contextmenu.prevent="closeContextMenu" />

    <!-- ================= Status bar ================= -->
    <footer class="statusbar">
      <span>{{ visible.length }} 项</span>
      <span v-if="busy" class="busy">{{ busy }}</span>
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

/* ---------- Drag & drop ---------- */
.content {
  position: relative;
  outline: none;
}
.content.drag-hover::after {
  content: '';
  position: absolute; inset: 8px;
  border: 2px dashed rgba(99, 163, 255, 0.7);
  border-radius: 12px;
  pointer-events: none;
  background: rgba(99, 163, 255, 0.06);
}
.drop-overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  z-index: 20;
}
.drop-box {
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(8px);
  padding: 16px 24px;
  border-radius: 10px;
  color: #fff;
  font-size: 14px;
  border: 1px solid rgba(99, 163, 255, 0.4);
}
.drop-box b { color: #63a3ff; font-family: ui-monospace, 'SF Mono', monospace; font-weight: 500; }

/* ---------- Transfer panel ---------- */
.transfers {
  display: flex; flex-direction: column; gap: 6px;
  padding: 8px 12px;
  background: var(--surface-2);
  border-top: 1px solid rgba(255,255,255,0.06);
  max-height: 160px;
  overflow-y: auto;
}
.xfer { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.xfer-head { display: flex; justify-content: space-between; gap: 8px; }
.xfer-name {
  color: var(--fg-2);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-family: ui-monospace, 'SF Mono', monospace;
}
.xfer-pct { color: var(--fg-3); font-variant-numeric: tabular-nums; }
.xfer.done .xfer-pct { color: #5eead4; }
.xfer.error .xfer-pct { color: #f87171; }
.xfer-bar {
  height: 3px;
  background: rgba(255,255,255,0.08);
  border-radius: 2px;
  overflow: hidden;
}
.xfer-fill {
  height: 100%;
  background: linear-gradient(90deg, #63a3ff, #5eead4);
  transition: width 0.15s ease;
}
.xfer.done .xfer-fill { background: #5eead4; }
.xfer.error .xfer-fill { background: #f87171; }

/* ---------- Rename inline input ---------- */
.rename-input {
  background: var(--surface-1);
  color: var(--fg-1);
  border: 1px solid #63a3ff;
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
  min-width: 0;
  width: 100%;
}
.tile-rename {
  font-size: 11px;
  text-align: center;
  max-width: 90%;
}

/* ---------- Context menu ---------- */
.ctx-backdrop {
  position: fixed; inset: 0;
  z-index: 50;
}
.ctx-menu {
  position: fixed;
  z-index: 51;
  min-width: 160px;
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  display: flex; flex-direction: column;
}
.ctx-menu button {
  background: transparent;
  border: none;
  color: var(--fg-1);
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
.ctx-menu button:hover { background: rgba(99, 163, 255, 0.15); }
.ctx-menu button.danger { color: #f87171; }
.ctx-menu button.danger:hover { background: rgba(248, 113, 113, 0.15); }
.ctx-sep { height: 1px; background: rgba(255,255,255,0.08); margin: 3px 4px; }

.statusbar .busy { color: #63a3ff; font-size: 11px; }
</style>
