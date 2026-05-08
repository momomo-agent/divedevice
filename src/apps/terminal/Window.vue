<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDevice, useWindow, useAppController } from '@/composables'
import Session from './Session.vue'
import {
  terminalStore,
  bumpSnippet,
  addSnippet,
  removeSnippet,
  togglePin,
  type Snippet,
} from './store'

const { window: win } = useWindow()
const device = useDevice()

// ========== Tabs ==========
interface Tab {
  id: string
  title: string
  status: string
  visibleTick: number
  searchRequest: { query: string; dir: 'next' | 'prev'; ts: number } | null
}

let tabSeq = 0
function makeTab(title = 'shell'): Tab {
  return {
    id: `t${++tabSeq}`,
    title,
    status: '',
    visibleTick: 0,
    searchRequest: null,
  }
}

const tabs = ref<Tab[]>([makeTab()])
const activeId = ref<string>(tabs.value[0].id)
const sessionRefs = ref<Record<string, InstanceType<typeof Session> | null>>({})
function setSessionRef(id: string, el: unknown) {
  sessionRefs.value[id] = el as InstanceType<typeof Session> | null
}
const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value))
const activeSession = computed(() => sessionRefs.value[activeId.value])

function newTab() {
  const t = makeTab(`shell ${tabs.value.length + 1}`)
  tabs.value.push(t)
  activeId.value = t.id
  nextTick(() => { sessionRefs.value[t.id]?.focus() })
}
function closeTab(id: string) {
  const i = tabs.value.findIndex((t) => t.id === id)
  if (i < 0) return
  tabs.value.splice(i, 1)
  delete sessionRefs.value[id]
  if (activeId.value === id) {
    if (tabs.value.length === 0) {
      newTab()
    } else {
      activeId.value = tabs.value[Math.max(0, i - 1)].id
    }
  }
}
function selectTab(id: string) {
  if (activeId.value === id) return
  activeId.value = id
  const t = tabs.value.find((x) => x.id === id)
  if (t) t.visibleTick++
}

// ========== Sidebar ==========
type SidebarSection = 'snippets' | 'history'
const sidebarOpen = ref(true)
const sidebarSection = ref<SidebarSection>('snippets')
const sidebarWidth = 220

// Snippets 排序：pinned 在前，次按 uses 降序
const sortedSnippets = computed<Snippet[]>(() => {
  return [...terminalStore.snippets].sort((a, b) => {
    if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
    return (b.uses ?? 0) - (a.uses ?? 0)
  })
})

const sidebarQuery = ref('')
const filteredSnippets = computed(() => {
  const q = sidebarQuery.value.toLowerCase().trim()
  if (!q) return sortedSnippets.value
  return sortedSnippets.value.filter((s) => s.label.toLowerCase().includes(q) || s.cmd.toLowerCase().includes(q))
})
// 历史倒序显示（最新在上）
const reverseHistory = computed(() => [...terminalStore.history].reverse())
const filteredHistory = computed(() => {
  const q = sidebarQuery.value.toLowerCase().trim()
  if (!q) return reverseHistory.value
  return reverseHistory.value.filter((h) => h.toLowerCase().includes(q))
})

function runSnippet(s: Snippet) {
  bumpSnippet(s.id)
  activeSession.value?.run(s.cmd)
  activeSession.value?.focus()
}
function pasteSnippet(s: Snippet) {
  // 只 paste 不回车，用户可以再编辑
  activeSession.value?.paste(s.cmd)
  activeSession.value?.focus()
}
function runHistory(cmd: string) {
  activeSession.value?.run(cmd)
  activeSession.value?.focus()
}
function saveAsSnippet(cmd: string) {
  const label = window.prompt('snippet 标签', cmd.slice(0, 32))
  if (label === null) return
  addSnippet(label || cmd.slice(0, 32), cmd)
}

function onAddSnippet() {
  const cmd = window.prompt('命令')
  if (!cmd) return
  const label = window.prompt('标签', cmd.slice(0, 32)) ?? cmd.slice(0, 32)
  addSnippet(label, cmd)
}

// ========== Toolbar actions ==========
const searchQuery = ref('')
const searchOpen = ref(false)

function triggerSearch(dir: 'next' | 'prev') {
  const t = activeTab.value
  if (!t || !searchQuery.value) return
  t.searchRequest = { query: searchQuery.value, dir, ts: Date.now() }
}
function clearActive() { activeSession.value?.clear() }
function sigintActive() { activeSession.value?.sigint() }

// ========== App Controller ==========
useAppController({
  getState: () => ({
    tabCount: tabs.value.length,
    activeTab: activeId.value,
    sidebarOpen: sidebarOpen.value,
    sidebarSection: sidebarSection.value,
    snippetCount: terminalStore.snippets.length,
    historyCount: terminalStore.history.length,
  }),
  describe: () => ({
    events: [
      { name: 'newTab', description: '新建 tab' },
      { name: 'closeTab', description: 'payload: {id?: string} 关闭当前或指定 tab' },
      { name: 'selectTab', description: 'payload: {id: string}' },
      { name: 'runCommand', description: 'payload: {cmd: string} 在当前 tab 里回车执行' },
      { name: 'paste', description: 'payload: {text: string} 在当前 tab 里 paste（不回车）' },
      { name: 'sigint', description: '当前 tab 发 Ctrl-C' },
      { name: 'clear', description: '清屏（当前 tab）' },
      { name: 'toggleSidebar', description: 'payload: {open?: boolean}' },
      { name: 'setSidebarSection', description: 'payload: {section: "snippets"|"history"}' },
      { name: 'addSnippet', description: 'payload: {label?: string, cmd: string}' },
    ],
  }),
  send(event, payload) {
    const p = (payload ?? {}) as Record<string, unknown>
    switch (event) {
      case 'newTab': newTab(); return { ok: true, activeTab: activeId.value }
      case 'closeTab': closeTab((p.id as string) ?? activeId.value); return { ok: true }
      case 'selectTab': selectTab(String(p.id ?? '')); return { ok: true, activeTab: activeId.value }
      case 'runCommand': {
        const cmd = String(p.cmd ?? '')
        if (!cmd) throw new Error('missing cmd')
        activeSession.value?.run(cmd)
        return { ok: true }
      }
      case 'paste': activeSession.value?.paste(String(p.text ?? '')); return { ok: true }
      case 'sigint': sigintActive(); return { ok: true }
      case 'clear': clearActive(); return { ok: true }
      case 'toggleSidebar': sidebarOpen.value = 'open' in p ? !!p.open : !sidebarOpen.value; return { ok: true, sidebarOpen: sidebarOpen.value }
      case 'setSidebarSection': {
        const s = String(p.section ?? '')
        if (s !== 'snippets' && s !== 'history') throw new Error(`invalid section: ${s}`)
        sidebarSection.value = s
        return { ok: true }
      }
      case 'addSnippet': {
        const cmd = String(p.cmd ?? '')
        if (!cmd) throw new Error('missing cmd')
        const label = String(p.label ?? cmd.slice(0, 32))
        const s = addSnippet(label, cmd)
        return { ok: true, id: s.id }
      }
      default: throw new Error(`Unknown terminal event: ${event}`)
    }
  },
})

// 设备切换时 session.vue 自己会处理——Window 无需重启
watch(() => win.value.deviceId, () => { /* session 自己响应 props.device */ })
</script>

<template>
  <div class="term-root">
    <!-- ===== Sidebar ===== -->
    <aside v-if="sidebarOpen" class="sidebar" :style="{ width: sidebarWidth + 'px' }">
      <div class="side-head">
        <button
          class="seg"
          :class="{ active: sidebarSection === 'snippets' }"
          @click="sidebarSection = 'snippets'"
        >Snippets</button>
        <button
          class="seg"
          :class="{ active: sidebarSection === 'history' }"
          @click="sidebarSection = 'history'"
        >History</button>
        <button class="collapse" title="收起侧栏" @click="sidebarOpen = false">←</button>
      </div>

      <input
        v-model="sidebarQuery"
        class="side-search"
        :placeholder="sidebarSection === 'snippets' ? '搜 snippet…' : '搜历史…'"
      />

      <div v-if="sidebarSection === 'snippets'" class="side-body">
        <button class="add-snip" @click="onAddSnippet">＋ 新 snippet</button>
        <div class="scroll">
          <div
            v-for="s in filteredSnippets"
            :key="s.id"
            class="snip"
            :class="{ pinned: s.pinned }"
            :title="s.cmd"
          >
            <button class="snip-main" @click="runSnippet(s)">
              <span v-if="s.pinned" class="pin">📌</span>
              <span class="lb">{{ s.label }}</span>
              <span class="cmd">{{ s.cmd }}</span>
            </button>
            <div class="snip-actions">
              <button class="mini" @click.stop="pasteSnippet(s)" title="paste（不回车）">↵</button>
              <button class="mini" @click.stop="togglePin(s.id)" :title="s.pinned ? '取消置顶' : '置顶'">{{ s.pinned ? '📌' : '📍' }}</button>
              <button class="mini danger" @click.stop="removeSnippet(s.id)" title="删除">×</button>
            </div>
          </div>
          <div v-if="filteredSnippets.length === 0" class="empty">没有匹配的 snippet</div>
        </div>
      </div>

      <div v-else class="side-body">
        <div class="scroll">
          <button
            v-for="(h, i) in filteredHistory"
            :key="i"
            class="hist"
            :title="h"
          >
            <span class="h-main" @click="runHistory(h)">{{ h }}</span>
            <button class="mini" @click.stop="saveAsSnippet(h)" title="存为 snippet">＋</button>
          </button>
          <div v-if="filteredHistory.length === 0" class="empty">暂无历史</div>
        </div>
      </div>
    </aside>

    <!-- ===== Main ===== -->
    <div class="main">
      <div class="toolbar">
        <button v-if="!sidebarOpen" class="icon" @click="sidebarOpen = true" title="展开侧栏">→</button>
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            class="tab"
            :class="{ active: t.id === activeId }"
            @click="selectTab(t.id)"
          >
            <span class="lb">{{ t.title }}</span>
            <span v-if="tabs.length > 1" class="close" @click.stop="closeTab(t.id)">×</span>
          </button>
          <button class="tab-new" @click="newTab" title="新建 tab">＋</button>
        </div>
        <div class="spacer" />
        <button class="icon" @click="sigintActive" title="Ctrl-C">⟲</button>
        <button class="icon" @click="clearActive" title="清屏">🗑</button>
        <button
          class="icon"
          :class="{ active: searchOpen }"
          @click="searchOpen = !searchOpen"
          title="搜索"
        >🔍</button>
      </div>

      <div v-if="searchOpen" class="search-bar">
        <input
          v-model="searchQuery"
          class="search-input"
          placeholder="搜当前 tab 输出"
          @keydown.enter.prevent="triggerSearch('next')"
          @keydown.escape.prevent="searchOpen = false"
        />
        <button class="mini" @click="triggerSearch('prev')" title="上一个">↑</button>
        <button class="mini" @click="triggerSearch('next')" title="下一个">↓</button>
        <button class="mini" @click="searchOpen = false">Esc</button>
      </div>

      <div class="status-strip" v-if="activeTab && activeTab.status">{{ activeTab.status }}</div>

      <div class="sessions">
        <div
          v-for="t in tabs"
          :key="t.id"
          v-show="t.id === activeId"
          class="session-slot"
        >
          <Session
            :ref="(el) => setSessionRef(t.id, el)"
            :device="device ?? null"
            :visible-tick="t.visibleTick"
            :search-request="t.searchRequest"
            @status="(s) => (t.status = s)"
            @title="(tt) => (t.title = tt)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.term-root {
  display: flex; flex-direction: row;
  height: 100%;
  background: #141820;
  color: var(--fg-1);
}

/* ===== Sidebar ===== */
.sidebar {
  flex: 0 0 auto;
  display: flex; flex-direction: column;
  background: var(--surface-2);
  border-right: 1px solid rgba(255,255,255,0.05);
  overflow: hidden;
  font-size: 11px;
}
.side-head {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 6px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.seg {
  flex: 1;
  background: transparent; border: 1px solid transparent;
  border-radius: 4px; padding: 3px 6px;
  color: var(--fg-3); cursor: pointer; font-size: 11px;
}
.seg:hover { color: var(--fg-1); background: rgba(255,255,255,0.04); }
.seg.active { background: rgba(99,163,255,0.14); border-color: rgba(99,163,255,0.4); color: #fff; }
.collapse {
  width: 22px; height: 22px;
  background: transparent; border: none; border-radius: 4px;
  color: var(--fg-3); cursor: pointer; font-size: 12px;
}
.collapse:hover { background: rgba(255,255,255,0.06); color: var(--fg-1); }

.side-search {
  margin: 6px 8px 4px;
  background: var(--surface-3); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;
  padding: 3px 7px; color: var(--fg-1); font-size: 11px;
}
.side-body { flex: 1; display: flex; flex-direction: column; min-height: 0; padding: 0 6px 6px; }
.add-snip {
  margin: 2px 0 6px;
  background: var(--surface-3); border: 1px dashed rgba(255,255,255,0.12); border-radius: 4px;
  padding: 3px 6px; color: var(--fg-2); cursor: pointer; font-size: 11px;
}
.add-snip:hover { background: rgba(255,255,255,0.06); color: var(--fg-1); }

.scroll {
  flex: 1; overflow-y: auto;
  display: flex; flex-direction: column; gap: 3px;
}
.scroll .empty { color: var(--fg-3); opacity: 0.5; padding: 8px 4px; text-align: center; }

.snip {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 2px;
  background: var(--surface-3); border: 1px solid transparent; border-radius: 4px;
  padding: 3px 4px;
}
.snip:hover { border-color: rgba(255,255,255,0.08); }
.snip.pinned { border-left: 2px solid #fbbf24; }
.snip-main {
  display: flex; flex-direction: column; gap: 1px;
  background: transparent; border: none; padding: 2px 4px;
  text-align: left; cursor: pointer; color: var(--fg-1);
  min-width: 0;
}
.snip-main .pin { font-size: 9px; margin-right: 2px; }
.snip-main .lb { font-size: 11px; color: var(--fg-1); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snip-main .cmd {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10px; color: var(--fg-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.snip-actions { display: flex; gap: 1px; opacity: 0; transition: opacity 0.12s; }
.snip:hover .snip-actions { opacity: 1; }

.mini {
  background: transparent; border: none; border-radius: 3px;
  padding: 2px 5px;
  color: var(--fg-3); cursor: pointer; font-size: 11px;
  line-height: 1;
}
.mini:hover { background: rgba(255,255,255,0.08); color: var(--fg-1); }
.mini.danger:hover { background: rgba(248,113,113,0.2); color: #fca5a5; }

.hist {
  display: grid; grid-template-columns: 1fr auto;
  align-items: center; gap: 2px;
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  padding: 0 4px;
  cursor: pointer;
}
.hist:hover { background: var(--surface-3); border-color: rgba(255,255,255,0.06); }
.hist .h-main {
  display: block;
  background: transparent; border: none; padding: 3px 4px;
  color: var(--fg-2);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  cursor: pointer;
}
.hist .mini { opacity: 0; }
.hist:hover .mini { opacity: 1; }

/* ===== Main ===== */
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

.toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.icon {
  width: 26px; height: 22px;
  background: transparent; border: none; border-radius: 4px;
  color: var(--fg-2); cursor: pointer; font-size: 12px;
}
.icon:hover { background: rgba(255,255,255,0.06); color: var(--fg-1); }
.icon.active { background: rgba(99,163,255,0.22); color: #9ecbff; }

.tabs { display: flex; align-items: center; gap: 2px; }
.tab {
  display: inline-flex; align-items: center; gap: 4px;
  background: transparent; border: 1px solid transparent;
  border-radius: 4px; padding: 3px 8px;
  color: var(--fg-3); cursor: pointer; font-size: 11px;
  max-width: 160px;
}
.tab:hover { color: var(--fg-1); }
.tab.active { background: var(--surface-3); color: var(--fg-1); border-color: rgba(255,255,255,0.08); }
.tab .lb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .close {
  width: 14px; height: 14px; border-radius: 2px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--fg-3); font-size: 12px; line-height: 1;
}
.tab .close:hover { background: rgba(255,255,255,0.12); color: #fff; }
.tab-new {
  background: transparent; border: 1px dashed rgba(255,255,255,0.1); border-radius: 4px;
  color: var(--fg-3); cursor: pointer;
  padding: 1px 6px; font-size: 11px;
}
.tab-new:hover { color: var(--fg-1); border-color: rgba(255,255,255,0.2); }

.spacer { flex: 1; }

.search-bar {
  display: flex; gap: 4px; align-items: center;
  padding: 4px 8px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.search-input {
  flex: 1;
  background: var(--surface-3); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;
  padding: 3px 8px; color: var(--fg-1); font-size: 11px;
}

.status-strip {
  padding: 2px 8px;
  font-size: 10.5px;
  color: var(--fg-3);
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.04);
}

.sessions { flex: 1; min-height: 0; position: relative; }
.session-slot { position: absolute; inset: 0; }
</style>
