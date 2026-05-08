<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { chat, sendOrQueue, agentState, agentSettings } from '@/services'
import type { AgentImage } from '@/services/agent'

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
    ? { position: 'fixed' as const, right: '40px', bottom: '40px', width: '380px', height: '520px' }
    : undefined,
)

// 观察消息变化触发滚动
let stopWatching: (() => void) | null = null
onMounted(() => {
  const observer = new MutationObserver(scrollBottom)
  if (streamRef.value) observer.observe(streamRef.value, { childList: true, subtree: true })
  stopWatching = () => observer.disconnect()
})
onBeforeUnmount(() => { stopWatching?.() })
</script>

<template>
  <aside
    v-if="position !== 'hidden'"
    class="chat"
    :class="position"
    :style="floatStyle"
  >
    <header>
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
        :class="m.role"
      >
        <div class="role">{{ m.role }}</div>
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
          @keydown.enter.exact.prevent="onSend"
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
}
.chat.left { border-left: none; border-right: 1px solid rgba(255, 255, 255, 0.05); }
.chat.float {
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
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
