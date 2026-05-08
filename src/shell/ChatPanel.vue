<script setup lang="ts">
import { ref, computed } from 'vue'
import { chat } from '@/services'

export type ChatPosition = 'left' | 'right' | 'float' | 'hidden'

const props = defineProps<{ position: ChatPosition }>()
const emit = defineEmits<{
  'update:position': [value: ChatPosition]
}>()

const input = ref('')

function onSend() {
  const text = input.value.trim()
  if (!text) return
  chat.push('user', text)
  chat.push('system', '（Agent 接入将在 Phase 3 启用）')
  input.value = ''
}

const floatStyle = computed(() =>
  props.position === 'float'
    ? { position: 'fixed', right: '40px', bottom: '40px', width: '380px', height: '520px' } as const
    : undefined,
)
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
      <div class="position-switch">
        <button :class="{ active: position === 'left' }" @click="emit('update:position', 'left')" title="左侧">⟨</button>
        <button :class="{ active: position === 'right' }" @click="emit('update:position', 'right')" title="右侧">⟩</button>
        <button :class="{ active: position === 'float' }" @click="emit('update:position', 'float')" title="悬浮">◇</button>
        <button @click="emit('update:position', 'hidden')" title="隐藏 (⌘J)">×</button>
      </div>
    </header>
    <div class="stream">
      <div v-if="!chat.messages.length" class="placeholder">
        这里是你和 Agent 的对话流。Phase 3 接入 agentic-core。
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
    </div>
    <footer>
      <textarea
        v-model="input"
        rows="3"
        placeholder="告诉 Agent 你想做什么…"
        @keydown.enter.exact.prevent="onSend"
      />
      <button class="send" @click="onSend">发送</button>
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
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
header .title {
  flex: 1;
  font-size: 12px;
  color: var(--fg-2);
  letter-spacing: 0.4px;
  text-transform: uppercase;
}
.position-switch {
  display: flex;
  gap: 2px;
}
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
  margin-top: 40%;
  font-size: 12px;
  padding: 0 20px;
}
.msg { display: flex; flex-direction: column; gap: 2px; }
.msg .role {
  font-size: 10px;
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.msg .content { white-space: pre-wrap; }
.msg.user .content { color: #9cc7ff; }
.msg.system .content { color: var(--fg-3); font-size: 11px; }
.msg.assistant .content { color: var(--fg-1); }

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
.send:hover { background: rgba(99, 163, 255, 0.35); }
</style>
