<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useDevice, useWindow, useEventbus } from '@/composables'
import type { FileEntry } from '@/device'

const { window: win } = useWindow()
const device = useDevice()
const eventbus = useEventbus()

const props = defineProps<{ initialPath?: string }>()

const path = ref(props.initialPath ?? '/sdcard')
const entries = ref<FileEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const sortedEntries = computed(() =>
  [...entries.value].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  }),
)

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
  } catch (err) {
    error.value = (err as Error).message
    entries.value = []
  } finally {
    loading.value = false
  }
}

function goUp() {
  const parts = path.value.split('/').filter(Boolean)
  parts.pop()
  path.value = parts.length ? '/' + parts.join('/') : '/'
}

function onEnter(entry: FileEntry) {
  if (entry.isDir) {
    path.value = entry.path
  } else {
    // 广播给其他 app（如 Editor）监听
    eventbus.emit('finder.openFile', {
      deviceId: win.value.deviceId!,
      path: entry.path,
    })
  }
}

watch([path, () => win.value.deviceId], load, { immediate: true })

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
</script>

<template>
  <div class="finder">
    <div class="toolbar">
      <button class="icon-btn" title="上一级" @click="goUp">↑</button>
      <input v-model="path" class="path" @keydown.enter="load" />
      <button class="icon-btn" title="刷新" @click="load">⟳</button>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="loading" class="loading">加载中…</div>
    <div v-else-if="!entries.length" class="empty">空目录</div>
    <ul v-else class="list">
      <li
        v-for="e in sortedEntries"
        :key="e.path"
        :class="{ dir: e.isDir }"
        @dblclick="onEnter(e)"
      >
        <span class="icon">{{ e.isDir ? '📁' : '📄' }}</span>
        <span class="name">{{ e.name }}</span>
        <span class="meta">{{ e.isDir ? '—' : fmtSize(e.size) }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.finder {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
}
.toolbar {
  display: flex;
  gap: 6px;
  padding: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--surface-2);
}
.icon-btn {
  width: 28px;
  height: 28px;
  border-radius: 5px;
  border: none;
  background: var(--surface-3);
  color: var(--fg-1);
  cursor: pointer;
  font-size: 14px;
}
.icon-btn:hover { background: var(--surface-4); }
.path {
  flex: 1;
  background: var(--surface-3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 5px;
  color: var(--fg-1);
  padding: 0 10px;
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
}
.path:focus { outline: none; border-color: rgba(99, 163, 255, 0.45); }
.list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
  flex: 1;
}
.list li {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 5px 12px;
  font-size: 12.5px;
  cursor: default;
  user-select: none;
}
.list li:hover { background: rgba(255, 255, 255, 0.05); }
.list li.dir .name { color: #9cc7ff; }
.list .meta { color: var(--fg-3); font-size: 11px; }
.error { padding: 16px; color: #ff8b7a; font-size: 12px; }
.loading, .empty {
  padding: 24px;
  text-align: center;
  color: var(--fg-3);
  font-size: 12px;
}
</style>
