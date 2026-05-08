<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, reactive } from 'vue'
import * as monaco from 'monaco-editor'
import { useDevice, useWindow, useEventbus, useWindowManager, useAppController } from '@/composables'

const { window: win } = useWindow()
const device = useDevice()
const eventbus = useEventbus()
const windowManager = useWindowManager()

const props = defineProps<{ openPath?: string }>()

interface Tab {
  id: string
  path: string
  language: string
  model: monaco.editor.ITextModel
  dirty: boolean
  originalContent: string
}

const hostRef = ref<HTMLDivElement | null>(null)
const tabs = reactive<Tab[]>([])
const activeId = ref<string | null>(null)
const status = ref('')

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let tabSeq = 0

function extToLang(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return 'javascript'
    case 'ts': case 'mts': case 'cts': return 'typescript'
    case 'json': return 'json'
    case 'md': case 'markdown': return 'markdown'
    case 'xml': return 'xml'
    case 'html': case 'htm': return 'html'
    case 'css': return 'css'
    case 'py': return 'python'
    case 'sh': case 'bash': return 'shell'
    case 'yml': case 'yaml': return 'yaml'
    case 'kt': return 'kotlin'
    case 'java': return 'java'
    case 'c': case 'h': return 'c'
    case 'cpp': case 'cc': case 'cxx': case 'hpp': return 'cpp'
    case 'rs': return 'rust'
    case 'go': return 'go'
    case 'conf': case 'prop': case 'properties': case 'ini': return 'ini'
    case 'log': case 'txt': return 'plaintext'
    default: return 'plaintext'
  }
}

async function openFile(path: string) {
  const existing = tabs.find((t) => t.path === path)
  if (existing) {
    activeId.value = existing.id
    return
  }
  if (!device.value) {
    status.value = '未连接设备'
    return
  }
  status.value = `加载 ${path}…`
  try {
    const content = await device.value.fs.readText(path)
    const language = extToLang(path)
    const model = monaco.editor.createModel(content, language)
    model.onDidChangeContent(() => {
      const t = tabs.find((x) => x.model === model)
      if (t) t.dirty = model.getValue() !== t.originalContent
    })
    const tab: Tab = {
      id: `t${++tabSeq}`,
      path,
      language,
      model,
      dirty: false,
      originalContent: content,
    }
    tabs.push(tab)
    activeId.value = tab.id
    status.value = ''
  } catch (err) {
    status.value = `打开失败：${(err as Error).message}`
  }
}

async function save(tab: Tab) {
  if (!device.value) {
    status.value = '未连接设备'
    return
  }
  const content = tab.model.getValue()
  try {
    await device.value.fs.write(tab.path, content)
    tab.originalContent = content
    tab.dirty = false
    status.value = '已保存'
    setTimeout(() => {
      if (status.value === '已保存') status.value = ''
    }, 1200)
  } catch (err) {
    status.value = `保存失败：${(err as Error).message}`
  }
}

function closeTab(id: string) {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  const t = tabs[idx]
  t.model.dispose()
  tabs.splice(idx, 1)
  if (activeId.value === id) {
    activeId.value = tabs[Math.max(0, idx - 1)]?.id ?? null
  }
}

function activate(id: string) {
  activeId.value = id
}

useAppController({
  getState: () => ({
    tabs: tabs.map((t) => ({ id: t.id, path: t.path, dirty: t.dirty })),
    activeTabId: activeId.value,
    activePath: tabs.find((t) => t.id === activeId.value)?.path ?? null,
  }),
  describe: () => ({
    events: [
      { name: 'open', description: 'Open a file path (reuse tab if already open). payload: {path: string}' },
      { name: 'selectTab', description: 'Activate a tab. payload: {tabId?: string, path?: string}' },
      { name: 'closeTab', description: 'Close a tab. payload: {tabId?: string, path?: string}' },
      { name: 'save', description: 'Save current or specific tab. payload?: {tabId?: string}' },
    ],
  }),
  async send(event, payload) {
    const p = (payload ?? {}) as Record<string, unknown>
    switch (event) {
      case 'open': {
        const target = String(p.path ?? '')
        if (!target) throw new Error('open requires payload.path')
        await openFile(target)
        return { ok: true, activePath: tabs.find((t) => t.id === activeId.value)?.path ?? null }
      }
      case 'selectTab': {
        let id: string | undefined
        if (typeof p.tabId === 'string') id = p.tabId
        else if (typeof p.path === 'string') id = tabs.find((t) => t.path === p.path)?.id
        if (!id) throw new Error('selectTab requires payload.tabId or payload.path (matching an open tab)')
        activate(id)
        return { ok: true, activeTabId: activeId.value }
      }
      case 'closeTab': {
        let id: string | undefined
        if (typeof p.tabId === 'string') id = p.tabId
        else if (typeof p.path === 'string') id = tabs.find((t) => t.path === p.path)?.id
        else id = activeId.value ?? undefined
        if (!id) throw new Error('no tab to close')
        closeTab(id)
        return { ok: true, remaining: tabs.length }
      }
      case 'save': {
        let tab = typeof p.tabId === 'string' ? tabs.find((t) => t.id === p.tabId) : undefined
        if (!tab) tab = tabs.find((t) => t.id === activeId.value)
        if (!tab) throw new Error('no active tab to save')
        await save(tab)
        return { ok: true, path: tab.path, dirty: tab.dirty }
      }
      default: throw new Error(`Unknown editor event: ${event}`)
    }
  },
})

watch(activeId, (id) => {
  const tab = tabs.find((t) => t.id === id)
  if (tab && editor) editor.setModel(tab.model)
  else if (editor) editor.setModel(null)
  if (tab) {
    windowManager.setTitle(win.value.id, `Editor — ${tab.path.split('/').pop()}`)
  } else {
    windowManager.setTitle(win.value.id, 'Editor')
  }
})

onMounted(async () => {
  await new Promise((r) => requestAnimationFrame(r))
  if (!hostRef.value) return
  editor = monaco.editor.create(hostRef.value, {
    theme: 'vs-dark',
    fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
    fontSize: 12.5,
    minimap: { enabled: false },
    automaticLayout: true,
    tabSize: 2,
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    const t = tabs.find((x) => x.id === activeId.value)
    if (t) save(t)
  })

  // 外部：finder.openFile 事件
  const off = eventbus.on('finder.openFile', ({ deviceId, path }) => {
    if (deviceId !== win.value.deviceId) {
      windowManager.setDevice(win.value.id, deviceId)
    }
    openFile(path)
  })
  onBeforeUnmount(off)

  if (props.openPath) await openFile(props.openPath)
})

onBeforeUnmount(() => {
  for (const t of tabs) t.model.dispose()
  editor?.dispose()
  editor = null
})
</script>

<template>
  <div class="editor-root">
    <div class="tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="tab"
        :class="{ active: t.id === activeId }"
        :title="t.path"
        @click="activate(t.id)"
      >
        <span class="name">{{ t.path.split('/').pop() }}</span>
        <span v-if="t.dirty" class="dot">●</span>
        <span class="x" @click.stop="closeTab(t.id)">×</span>
      </button>
      <div v-if="!tabs.length" class="empty-tabs">
        双击 Finder 中的文件打开
      </div>
    </div>
    <div ref="hostRef" class="host" />
    <div v-if="status" class="statusbar">{{ status }}</div>
  </div>
</template>

<style scoped>
.editor-root {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1e1e1e;
}
.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 0;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  min-height: 30px;
  overflow-x: auto;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px 5px 0 0;
  color: var(--fg-2);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover { background: rgba(255, 255, 255, 0.05); }
.tab.active { background: #1e1e1e; color: var(--fg-1); border-color: rgba(255,255,255,0.08); border-bottom-color: #1e1e1e; }
.tab .dot { color: var(--accent); font-size: 9px; }
.tab .x { opacity: 0.5; padding: 0 3px; }
.tab .x:hover { opacity: 1; }
.empty-tabs { padding: 4px 12px; color: var(--fg-3); font-size: 11px; }
.host { flex: 1; min-height: 0; }
.statusbar {
  padding: 4px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: var(--fg-3);
  background: var(--surface-2);
}
</style>
