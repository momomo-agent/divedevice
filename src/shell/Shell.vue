<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import Dock from './Dock.vue'
import Desktop from './Desktop.vue'
import ChatPanel, { type ChatPosition } from './ChatPanel.vue'
import StatusBar from './StatusBar.vue'
import { usePersistedState } from '@/services/persist'

// 对话窗口位置持久化——left / right / float / hidden
const { state: chatPos } = usePersistedState<ChatPosition>('shell', 'chatPos', 'right')
// “上次不是 hidden 的位置”——按 ⌘J 唤起时回到这里
const { state: previousPos } = usePersistedState<ChatPosition>('shell', 'chatPrevPos', 'right')

// 从 hidden 切回可见时，同步更新 previousPos
watch(chatPos, (v, old) => {
  if (old === 'hidden' && v !== 'hidden') previousPos.value = v
  else if (v !== 'hidden') previousPos.value = v
})

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault()
    if (chatPos.value === 'hidden') {
      chatPos.value = previousPos.value === 'hidden' ? 'right' : previousPos.value
    } else {
      previousPos.value = chatPos.value
      chatPos.value = 'hidden'
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="shell">
    <Dock />
    <ChatPanel
      v-if="chatPos === 'left'"
      position="left"
      @update:position="chatPos = $event"
    />
    <Desktop />
    <ChatPanel
      v-if="chatPos === 'right'"
      position="right"
      @update:position="chatPos = $event"
    />
    <ChatPanel
      v-if="chatPos === 'float'"
      position="float"
      @update:position="chatPos = $event"
    />
    <button
      v-if="chatPos === 'hidden'"
      class="chat-fab"
      title="唤起对话 (⌘J)"
      @click="chatPos = previousPos === 'hidden' ? 'right' : previousPos"
    >✶</button>
    <StatusBar :right-inset="chatPos === 'right' ? 360 : 0" />
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  width: 100vw;
  display: flex;
  overflow: hidden;
  background: var(--bg);
}
.chat-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: rgba(99, 163, 255, 0.85);
  color: white;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  z-index: 9999;
}
.chat-fab:hover { transform: scale(1.05); }
</style>
