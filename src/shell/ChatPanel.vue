<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { chat, agentAsk, agentState, agentSettings, deviceHub } from '@/services'

export type ChatPosition = 'left' | 'right' | 'float' | 'hidden'

const props = defineProps<{ position: ChatPosition }>()
const emit = defineEmits<{
  'update:position': [value: ChatPosition]
}>()

const input = ref('')
const showSettings = ref(false)
const streamRef = ref<HTMLDivElement | null>(null)

function scrollBottom() {
  requestAnimationFrame(() => {
    streamRef.value?.scrollTo({ top: streamRef.value.scrollHeight })
  })
}

function onSend() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  agentAsk(text).then(scrollBottom).catch(() => {})
  scrollBottom()
}

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
      <div class="device-hint" v-if="deviceHub.currentId.value">
        @ {{ deviceHub.devices.value.find(d => d.id === deviceHub.currentId.value)?.name }}
      </div>
      <div class="device-hint" v-else>未连接设备</div>
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
        <div class="content">{{ m.content }}</div>
      </div>
      <div v-if="agentState.running" class="thinking">
        <span class="dot" /><span class="dot" /><span class="dot" />
      </div>
    </div>

    <footer>
      <textarea
        v-model="input"
        rows="3"
        :placeholder="agentState.running ? '正在回复…' : '告诉 Agent 你想做什么…'"
        :disabled="agentState.running"
        @keydown.enter.exact.prevent="onSend"
      />
      <button class="send" :disabled="agentState.running" @click="onSend">发送</button>
    </footer>
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
  gap: 8px;
}
footer textarea {
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
footer textarea:focus { outline: none; border-color: rgba(99, 163, 255, 0.45); }
footer textarea:disabled { opacity: 0.5; }
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
}
.send:disabled { opacity: 0.4; cursor: not-allowed; }
.send:hover:not(:disabled) { background: rgba(99, 163, 255, 0.35); }
</style>
