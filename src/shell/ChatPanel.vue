<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { chat, sendOrQueue, agentState, agentSettings } from '@/services'
import type { AgentImage } from '@/services/agent'
import { useComposingLock } from '@/composables'
import { usePersistedState } from '@/services/persist'

export type ChatPosition = 'left' | 'right' | 'float' | 'hidden'

const props = defineProps<{ position: ChatPosition }>()
const emit = defineEmits<{
  'update:position': [value: ChatPosition]
}>()

const input = ref('')
const showSettings = ref(false)
const showPending = ref(true)
const streamRef = ref<HTMLDivElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const attachments = ref<AgentImage[]>([])
const dragOver = ref(false)
const previewUrl = ref<string | null>(null)

// Tool 消息展开/折叠状态
const expandedTools = ref(new Set<string>())
function toggleToolExpand(id: string) {
  if (expandedTools.value.has(id)) expandedTools.value.delete(id)
  else expandedTools.value.add(id)
  expandedTools.value = new Set(expandedTools.value)
}
function toolArgsSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const entries = Object.entries(input as Record<string, unknown>)
  if (!entries.length) return ''
  const parts = entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === 'string' ? (v.length > 30 ? v.slice(0, 30) + '…' : v) : JSON.stringify(v)
    return `${k}=${val}`
  })
  if (entries.length > 3) parts.push('…')
  return parts.join(', ')
}
function toolResultSummary(content: string): string {
  if (!content) return '(empty)'
  if (content.length <= 60) return content
  return content.slice(0, 60) + '…'
}

const { composing, onCompositionStart, onCompositionEnd } = useComposingLock()

function onInputKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || composing.value || e.keyCode === 229) return
  e.preventDefault()
  onSend()
}

function scrollBottom() {
  requestAnimationFrame(() => {
    streamRef.value?.scrollTo({ top: streamRef.value.scrollHeight })
  })
}

function fileToImage(file: File): Promise<AgentImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const dataUrl = reader.result as string
      const comma = dataUrl.indexOf(',')
      const data = dataUrl.slice(comma + 1)
      resolve({ data, media_type: file.type || 'image/png', preview: dataUrl })
    }
    reader.readAsDataURL(file)
  })
}

async function addFiles(files: FileList | File[]) {
  const arr = Array.from(files)
  for (const f of arr) {
    if (!f.type.startsWith('image/')) continue
    try {
      const img = await fileToImage(f)
      attachments.value.push(img)
    } catch (err) { console.error('[chat/attach]', err) }
  }
}

function onPickFiles(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length) addFiles(target.files)
  target.value = ''
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const it of Array.from(items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile()
      if (f && f.type.startsWith('image/')) files.push(f)
    }
  }
  if (files.length) {
    e.preventDefault()
    addFiles(files)
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
}

function removeAttachment(i: number) { attachments.value.splice(i, 1) }

function onSend() {
  const text = input.value.trim()
  if (!text && !attachments.value.length) return
  const imgs = attachments.value.length ? attachments.value.slice() : undefined
  const r = sendOrQueue(text, imgs)
  if (r !== 'empty') {
    input.value = ''
    attachments.value = []
  }
  scrollBottom()
}

function removePending(id: string) { chat.removePending(id) }
function movePendingUp(id: string) { chat.movePendingUp(id) }
function movePendingDown(id: string) { chat.movePendingDown(id) }
function clearPending() { chat.clearPending() }
function editPending(id: string, current: string) {
  const next = window.prompt('编辑排队消息：', current)
  if (next !== null && next.trim()) chat.updatePending(id, next.trim())
}

function openPreview(url: string) { previewUrl.value = url }
function closePreview() { previewUrl.value = null }

const floatStyle = computed(() =>
  props.position === 'float'
    ? {
        position: 'fixed' as const,
        left: floatFrame.value.x + 'px',
        top: floatFrame.value.y + 'px',
        width: floatFrame.value.w + 'px',
        height: floatFrame.value.h + 'px',
      }
    : undefined,
)

// ---------- 悬浮窗的拖动 / resize / 持久化 ----------
interface FloatFrame { x: number; y: number; w: number; h: number }

const MIN_W = 300
const MIN_H = 320

function defaultFrame(): FloatFrame {
  // 默认右下角接近原样式
  const w = 380, h = 520
  const x = Math.max(20, (typeof window !== 'undefined' ? window.innerWidth : 1200) - w - 40)
  const y = Math.max(20, (typeof window !== 'undefined' ? window.innerHeight : 800) - h - 40)
  return { x, y, w, h }
}

const { state: floatFrame } = usePersistedState<FloatFrame>(
  'shell',
  'chatFloatFrame',
  defaultFrame(),
)

// ---------- docked (left/right) 宽度 ----------
const DOCK_MIN_W = 280
const DOCK_RESERVE = 300 // 主区至少留这么宽
function clampDockedWidth(w: number): number {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const max = Math.max(DOCK_MIN_W, vw - DOCK_RESERVE)
  return Math.min(Math.max(w, DOCK_MIN_W), max)
}
const { state: dockedWidth } = usePersistedState<number>(
  'shell',
  'chatDockedWidth',
  360,
)
let dockDragOrigin: { x: number; w: number } | null = null
const dockResizing = ref(false)
function beginDockResize(e: PointerEvent) {
  if (props.position !== 'left' && props.position !== 'right') return
  e.preventDefault()
  dockResizing.value = true
  dockDragOrigin = { x: e.clientX, w: dockedWidth.value }
  const target = e.currentTarget as HTMLElement
  try { target.setPointerCapture?.(e.pointerId) } catch {}
  window.addEventListener('pointermove', onDockResizeMove)
  window.addEventListener('pointerup', onDockResizeEnd, { once: true })
  window.addEventListener('pointercancel', onDockResizeEnd, { once: true })
}
function onDockResizeMove(e: PointerEvent) {
  if (!dockDragOrigin) return
  const dx = e.clientX - dockDragOrigin.x
  // right 态：把手在面板左侧，往左拖变宽（dx<0 → +width）
  // left  态：把手在面板右侧，往右拖变宽（dx>0 → +width）
  const signed = props.position === 'right' ? -dx : dx
  dockedWidth.value = clampDockedWidth(dockDragOrigin.w + signed)
}
function onDockResizeEnd() {
  dockResizing.value = false
  dockDragOrigin = null
  window.removeEventListener('pointermove', onDockResizeMove)
}

const dockStyle = computed(() =>
  props.position === 'left' || props.position === 'right'
    ? { width: dockedWidth.value + 'px' }
    : undefined,
)

function clampInViewport(f: FloatFrame): FloatFrame {
  const vw = window.innerWidth
  const vh = window.innerHeight
  // 允许超出一点，但至少留 80px 在视窗内方便拖回来
  const w = Math.min(Math.max(f.w, MIN_W), Math.max(vw, MIN_W))
  const h = Math.min(Math.max(f.h, MIN_H), Math.max(vh, MIN_H))
  const x = Math.min(Math.max(f.x, -w + 80), Math.max(vw - 80, 0))
  const y = Math.min(Math.max(f.y, 0), Math.max(vh - 40, 0))
  return { x, y, w, h }
}

type DragMode = null | 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const dragMode = ref<DragMode>(null)
interface DragOrigin { x: number; y: number; frame: FloatFrame }
let dragOrigin: DragOrigin | null = null

function beginDrag(mode: Exclude<DragMode, null>) {
  return (e: PointerEvent) => {
    if (props.position !== 'float') return
    if (mode === 'move') {
      // 避免按钉头区的按钮时触发拖动
      const target = e.target as HTMLElement
      if (target.closest('button,select,input,textarea')) return
    }
    e.preventDefault()
    dragMode.value = mode
    dragOrigin = { x: e.clientX, y: e.clientY, frame: { ...floatFrame.value } }
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture?.(e.pointerId) } catch {}
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd, { once: true })
    window.addEventListener('pointercancel', onDragEnd, { once: true })
  }
}

function onDragMove(e: PointerEvent) {
  if (!dragOrigin || !dragMode.value) return
  const dx = e.clientX - dragOrigin.x
  const dy = e.clientY - dragOrigin.y
  const f0 = dragOrigin.frame
  let { x, y, w, h } = f0
  const mode = dragMode.value
  if (mode === 'move') {
    x = f0.x + dx
    y = f0.y + dy
  } else {
    if (mode.includes('e')) w = Math.max(MIN_W, f0.w + dx)
    if (mode.includes('s')) h = Math.max(MIN_H, f0.h + dy)
    if (mode.includes('w')) {
      const newW = Math.max(MIN_W, f0.w - dx)
      x = f0.x + (f0.w - newW)
      w = newW
    }
    if (mode.includes('n')) {
      const newH = Math.max(MIN_H, f0.h - dy)
      y = f0.y + (f0.h - newH)
      h = newH
    }
  }
  floatFrame.value = clampInViewport({ x, y, w, h })
}

function onDragEnd() {
  dragMode.value = null
  dragOrigin = null
  window.removeEventListener('pointermove', onDragMove)
}

function onWinResize() {
  if (props.position === 'float') {
    floatFrame.value = clampInViewport(floatFrame.value)
  }
  if (props.position === 'left' || props.position === 'right') {
    const clamped = clampDockedWidth(dockedWidth.value)
    if (clamped !== dockedWidth.value) dockedWidth.value = clamped
  }
}

watch(() => props.position, (p) => {
  if (p === 'float') floatFrame.value = clampInViewport(floatFrame.value)
})

// 观察消息变化触发滚动
let stopWatching: (() => void) | null = null
onMounted(() => {
  const observer = new MutationObserver(scrollBottom)
  if (streamRef.value) observer.observe(streamRef.value, { childList: true, subtree: true })
  stopWatching = () => observer.disconnect()
  window.addEventListener('resize', onWinResize)
})
onBeforeUnmount(() => {
  stopWatching?.()
  window.removeEventListener('resize', onWinResize)
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointermove', onDockResizeMove)
})
</script>

<template>
  <aside
    v-if="position !== 'hidden'"
    class="chat"
    :class="[position, { dragging: dragMode !== null }]"
    :style="floatStyle || dockStyle"
  >
    <header
      :class="{ 'float-drag': position === 'float' }"
      @pointerdown="position === 'float' ? beginDrag('move')($event) : undefined"
    >
      <div class="title">对话</div>
      <div class="grow" />
      <button class="gear" title="设置" @click="showSettings = !showSettings">⚙</button>
      <div class="position-switch">
        <button :class="{ active: position === 'left' }" @click="emit('update:position', 'left')" title="左侧">⟨</button>
        <button :class="{ active: position === 'right' }" @click="emit('update:position', 'right')" title="右侧">⟩</button>
        <button :class="{ active: position === 'float' }" @click="emit('update:position', 'float')" title="悬浮">◇</button>
        <button @click="emit('update:position', 'hidden')" title="隐藏 (⌘J)">×</button>
      </div>
    </header>

    <div v-if="showSettings" class="settings">
      <div class="row">
        <label>Provider</label>
        <select v-model="agentSettings.provider">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI-Compatible</option>
        </select>
      </div>
      <div class="row">
        <label>Base URL</label>
        <input v-model="agentSettings.baseUrl" placeholder="留空走官方端点" />
      </div>
      <div class="row">
        <label>Proxy</label>
        <label class="switch" title="启用后所有请求转发到 Proxy URL">
          <input type="checkbox" v-model="agentSettings.proxyEnabled" />
          <span>{{ agentSettings.proxyEnabled ? '已启用' : '已关闭' }}</span>
        </label>
      </div>
      <div class="row" v-if="agentSettings.proxyEnabled">
        <label>Proxy URL</label>
        <input v-model="agentSettings.proxyUrl" placeholder="如 https://proxy.momomo.dev/" />
      </div>
      <div class="row">
        <label>Model</label>
        <input v-model="agentSettings.model" />
      </div>
      <div class="row">
        <label>API Key</label>
        <input v-model="agentSettings.apiKey" type="text" placeholder="sk-…" />
      </div>
      <div class="row system">
        <label>System Prompt</label>
        <textarea v-model="agentSettings.system" rows="3" />
      </div>
    </div>

    <div ref="streamRef" class="stream">
      <div v-if="!chat.messages.length" class="placeholder">
        告诉 Agent 你想做什么。Agent 可以调用所有 app 贡献的工具：
        fs.ls / shell.exec / editor.open / screen.capture / input.tap …
      </div>
      <div
        v-for="m in chat.messages"
        :key="m.id"
        class="msg"
        :class="[m.role, { 'tool-error': m.role === 'tool' && (m.meta as any)?.error }]"
      >
        <div class="role" v-if="m.role !== 'tool'">{{ m.role }}</div>
        <!-- Tool 消息结构化展示 -->
        <template v-if="m.role === 'tool'">
          <div class="tool-header" @click="toggleToolExpand(m.id)">
            <span class="tool-icon" v-if="(m.meta as any)?.kind === 'use'">⚡</span>
            <span class="tool-icon ok" v-else-if="(m.meta as any)?.kind === 'result' && !(m.meta as any)?.error">✓</span>
            <span class="tool-icon err" v-else>✗</span>
            <span class="tool-name">{{ (m.meta as any)?.name || 'tool' }}</span>
            <span class="tool-summary" v-if="(m.meta as any)?.kind === 'use' && (m.meta as any)?.input">
              {{ toolArgsSummary((m.meta as any).input) }}
            </span>
            <span class="tool-summary" v-else-if="(m.meta as any)?.kind === 'result'">
              {{ toolResultSummary(m.content) }}
            </span>
            <span class="tool-expand">{{ expandedTools.has(m.id) ? '▾' : '▸' }}</span>
          </div>
          <div v-if="expandedTools.has(m.id)" class="tool-detail">
            <div v-if="m.content" class="content">{{ m.content }}</div>
          </div>
        </template>
        <!-- 非 tool 消息 -->
        <template v-else>
          <div v-if="m.meta && (m.meta as any).images" class="msg-imgs">
            <img
              v-for="(im, i) in ((m.meta as any).images as Array<{preview?: string; media_type: string}>)"
              :key="i"
              :src="im.preview"
              class="thumb"
              @click="im.preview && openPreview(im.preview)"
            />
          </div>
          <div v-if="m.content" class="content">{{ m.content }}</div>
        </template>
      </div>
      <div v-if="agentState.running" class="thinking">
        <span class="dot" /><span class="dot" /><span class="dot" />
      </div>
    </div>

    <footer>
      <div v-if="chat.pending.length" class="pending">
        <div class="pending-head">
          <span>排队 {{ chat.pending.length }}</span>
          <div class="grow" />
          <button class="mini" @click="showPending = !showPending">{{ showPending ? '收起' : '展开' }}</button>
          <button class="mini danger" @click="clearPending" title="清空队列">清空</button>
        </div>
        <ul v-if="showPending">
          <li v-for="(p, i) in chat.pending" :key="p.id">
            <span class="idx">{{ i + 1 }}</span>
            <span v-if="p.images && p.images.length" class="img-badge" :title="`包含 ${p.images.length} 张图片`">🖼 {{ p.images.length }}</span>
            <span class="text" :title="p.text" @click="editPending(p.id, p.text)">{{ p.text || '(无文本)' }}</span>
            <div class="ops">
              <button class="mini" :disabled="i === 0" @click="movePendingUp(p.id)" title="上移">↑</button>
              <button class="mini" :disabled="i === chat.pending.length - 1" @click="movePendingDown(p.id)" title="下移">↓</button>
              <button class="mini danger" @click="removePending(p.id)" title="删除">×</button>
            </div>
          </li>
        </ul>
      </div>

      <!-- 附件已选列表 -->
      <div v-if="attachments.length" class="attachments">
        <div
          v-for="(a, i) in attachments"
          :key="i"
          class="att"
        >
          <img :src="a.preview" class="att-thumb" @click="a.preview && openPreview(a.preview)" />
          <button class="att-rm" @click="removeAttachment(i)" title="移除">×</button>
        </div>
      </div>

      <div
        class="input-row"
        :class="{ 'drag-over': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop="onDrop"
      >
        <button
          class="attach-btn"
          title="附加图片（也支持粘贴/拖拽）"
          @click="fileInput?.click()"
        >📎</button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          style="display:none"
          @change="onPickFiles"
        />
        <textarea
          v-model="input"
          rows="3"
          :placeholder="dragOver ? '松开鼠标添加图片' : (agentState.running ? '输入消息入排队… (Enter 发送，可粘图)' : '告诉 Agent 你想做什么…（可粘/拖拽图片）')"
          @keydown="onInputKey"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @paste="onPaste"
        />
        <button class="send" @click="onSend" :disabled="!input.trim() && !attachments.length">
          {{ agentState.running ? '排队' : '发送' }}
        </button>
      </div>
    </footer>

    <!-- 图片全屏预览 -->
    <div v-if="previewUrl" class="preview-overlay" @click="closePreview">
      <img :src="previewUrl" />
      <button class="preview-close" @click.stop="closePreview">×</button>
    </div>

    <!-- 悬浮态的 8 个 resize 手柄 -->
    <template v-if="position === 'float'">
      <div class="resize-handle n" @pointerdown="beginDrag('n')($event)" />
      <div class="resize-handle s" @pointerdown="beginDrag('s')($event)" />
      <div class="resize-handle e" @pointerdown="beginDrag('e')($event)" />
      <div class="resize-handle w" @pointerdown="beginDrag('w')($event)" />
      <div class="resize-handle ne" @pointerdown="beginDrag('ne')($event)" />
      <div class="resize-handle nw" @pointerdown="beginDrag('nw')($event)" />
      <div class="resize-handle se" @pointerdown="beginDrag('se')($event)" />
      <div class="resize-handle sw" @pointerdown="beginDrag('sw')($event)" />
    </template>
    <!-- docked (left/right) 宽度拖拽手柄 -->
    <div
      v-if="position === 'left' || position === 'right'"
      class="dock-resize-handle"
      :class="position"
      @pointerdown="beginDockResize($event)"
    />
  </aside>
</template>

<style scoped>
.chat {
  width: 360px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-2);
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--fg-1);
  position: relative;
}
.chat.left, .chat.right { flex: 0 0 auto; }
.chat.dock-resizing { user-select: none; }
.dock-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 10;
  background: transparent;
  transition: background 120ms ease;
}
.dock-resize-handle.right { left: -3px; }
.dock-resize-handle.left  { right: -3px; }
.dock-resize-handle:hover,
.chat.dock-resizing .dock-resize-handle {
  background: rgba(120, 160, 255, 0.25);
}
.chat.left { border-left: none; border-right: 1px solid rgba(255, 255, 255, 0.05); }
.chat.float {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  z-index: 5000;           /* 置顶在 app 窗口之上，低于图片预览 9999 */
}
.chat.float.dragging { user-select: none; }
header.float-drag {
  cursor: move;
  touch-action: none;
}
header.float-drag button,
header.float-drag select,
header.float-drag input,
header.float-drag textarea { cursor: pointer; }

/* resize 手柄 —— 轻量开键区，视觉上不入侵 */
.resize-handle {
  position: absolute;
  z-index: 5001;
  touch-action: none;
}
.resize-handle.n  { top: -3px; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-handle.s  { bottom: -3px; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-handle.e  { top: 8px; bottom: 8px; right: -3px; width: 6px; cursor: ew-resize; }
.resize-handle.w  { top: 8px; bottom: 8px; left: -3px; width: 6px; cursor: ew-resize; }
.resize-handle.ne { top: -4px; right: -4px; width: 14px; height: 14px; cursor: nesw-resize; }
.resize-handle.nw { top: -4px; left: -4px;  width: 14px; height: 14px; cursor: nwse-resize; }
.resize-handle.se { bottom: -4px; right: -4px; width: 14px; height: 14px; cursor: nwse-resize; }
.resize-handle.sw { bottom: -4px; left: -4px;  width: 14px; height: 14px; cursor: nesw-resize; }
header {
  padding: 10px 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
header .title {
  font-size: 12px;
  color: var(--fg-2);
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.device-hint {
  flex: 1;
  font-size: 10px;
  color: var(--fg-3);
  padding-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grow { flex: 1; }
.gear {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-3);
  cursor: pointer;
  font-size: 13px;
}
.gear:hover { background: rgba(255, 255, 255, 0.1); color: var(--fg-1); }
.position-switch { display: flex; gap: 2px; }
.position-switch button {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-3);
  cursor: pointer;
  font-size: 13px;
}
.position-switch button:hover { background: rgba(255, 255, 255, 0.1); color: var(--fg-1); }
.position-switch button.active { background: rgba(99, 163, 255, 0.22); color: var(--fg-1); }

.settings {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface-3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.settings .row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
.settings .row label { width: 80px; color: var(--fg-3); flex-shrink: 0; }
.settings .row input, .settings .row select, .settings .row textarea {
  flex: 1;
  background: var(--surface-1);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  color: var(--fg-1);
  padding: 4px 8px;
  font-size: 11px;
  font-family: inherit;
}
.settings .row textarea { resize: vertical; min-height: 48px; }
.settings .row.system { align-items: flex-start; }
.settings .row .switch {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-1);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  color: var(--fg-2);
}
.settings .row .switch input { margin: 0; }

.stream {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  line-height: 1.5;
}
.placeholder {
  color: var(--fg-3);
  text-align: center;
  margin-top: 30%;
  font-size: 12px;
  padding: 0 20px;
  line-height: 1.6;
}
.msg { display: flex; flex-direction: column; gap: 2px; }
.msg .role {
  font-size: 10px;
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.msg .content { white-space: pre-wrap; word-break: break-word; }
.msg.user .content { color: #9cc7ff; }
.msg.system .content { color: var(--fg-3); font-size: 11px; font-style: italic; }
.msg.assistant .content { color: var(--fg-1); }
.msg.tool .content {
  color: var(--fg-3);
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
  background: var(--surface-3);
  padding: 5px 8px;
  border-radius: 4px;
  border-left: 2px solid rgba(94, 234, 212, 0.4);
}
.msg.tool-error .tool-header { border-left-color: rgba(248, 113, 113, 0.5); }
.msg.tool-error .tool-icon { color: #f87171; }

.tool-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--surface-3);
  border-left: 2px solid rgba(94, 234, 212, 0.4);
  cursor: pointer;
  font-size: 11.5px;
  transition: background 0.15s;
}
.tool-header:hover { background: var(--surface-4); }
.tool-icon { font-size: 11px; }
.tool-icon.ok { color: #5eead4; }
.tool-icon.err { color: #f87171; }
.tool-name {
  font-weight: 600;
  color: #7dd3fc;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11px;
}
.tool-summary {
  color: var(--fg-3);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.tool-expand {
  color: var(--fg-3);
  font-size: 10px;
  flex-shrink: 0;
}
.tool-detail {
  margin-top: 2px;
  padding: 4px 8px 4px 18px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 10.5px;
  color: var(--fg-3);
  max-height: 200px;
  overflow: auto;
  background: rgba(0,0,0,0.15);
  border-radius: 0 0 4px 4px;
}

.thinking {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}
.thinking .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-3);
  animation: blink 1.2s infinite;
}
.thinking .dot:nth-child(2) { animation-delay: 0.2s; }
.thinking .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

footer {
  padding: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-row {
  display: flex;
  gap: 8px;
}
.input-row textarea {
  flex: 1;
  resize: none;
  background: var(--surface-3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--fg-1);
  font-size: 13px;
  font-family: inherit;
}
.input-row textarea:focus { outline: none; border-color: rgba(99, 163, 255, 0.45); }

/* pending 队列 */
.pending {
  background: var(--surface-3);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  max-height: 180px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pending-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 10.5px;
  color: var(--fg-3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.025);
}
.pending-head .grow { flex: 1; }
.pending ul {
  list-style: none;
  margin: 0; padding: 2px 0;
  overflow: auto;
}
.pending li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11.5px;
}
.pending li:hover { background: rgba(255, 255, 255, 0.03); }
.pending .idx {
  color: var(--fg-3);
  font-family: ui-monospace, monospace;
  font-size: 10px;
  width: 14px;
  flex-shrink: 0;
}
.pending .text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-2);
  cursor: pointer;
}
.pending .text:hover { color: var(--fg-1); text-decoration: underline dotted; }
.pending .ops { display: flex; gap: 2px; flex-shrink: 0; }
.mini {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--fg-3);
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.mini:not(:disabled):hover { background: rgba(255, 255, 255, 0.08); color: var(--fg-1); }
.mini:disabled { opacity: 0.3; cursor: not-allowed; }
.mini.danger:not(:disabled):hover { background: rgba(248, 113, 113, 0.2); color: #fca5a5; }

/* 附件 & 图片 */
.msg-imgs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin: 2px 0;
}
.thumb, .att-thumb {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: zoom-in;
  background: var(--surface-1);
}
.attachments {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding: 4px 2px;
}
.att { position: relative; }
.att-rm {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.4);
  background: rgba(248, 113, 113, 0.9);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
}
.img-badge {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(94, 234, 212, 0.18);
  color: #5eead4;
  flex-shrink: 0;
}
.attach-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: var(--surface-3);
  color: var(--fg-3);
  cursor: pointer;
  font-size: 14px;
  align-self: flex-end;
  flex-shrink: 0;
}
.attach-btn:hover { background: rgba(255,255,255,0.08); color: var(--fg-1); }
.input-row.drag-over {
  outline: 2px dashed rgba(99, 163, 255, 0.7);
  outline-offset: 2px;
  border-radius: 6px;
}

/* 全屏预览 */
.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
}
.preview-overlay img {
  max-width: 92vw;
  max-height: 92vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.preview-close {
  position: fixed;
  top: 20px;
  right: 24px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  border: none;
  font-size: 18px;
  cursor: pointer;
}
.send {
  align-self: flex-end;
  background: rgba(99, 163, 255, 0.22);
  color: var(--fg-1);
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  height: 32px;
  flex-shrink: 0;
}
.send:disabled { opacity: 0.4; cursor: not-allowed; }
.send:hover:not(:disabled) { background: rgba(99, 163, 255, 0.35); }
</style>
