<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import Dock from './Dock.vue'
import Desktop from './Desktop.vue'
import ChatPanel, { type ChatPosition } from './ChatPanel.vue'

const chatPos = ref<ChatPosition>('right')
const previousPos = ref<ChatPosition>('right')

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault()
    if (chatPos.value === 'hidden') {
      chatPos.value = previousPos.value
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
      v-if="chatPos === 'right' || chatPos === 'hidden'"
      :position="chatPos"
      @update:position="chatPos = $event"
    />
    <ChatPanel
      v-if="chatPos === 'float'"
      position="float"
      @update:position="chatPos = $event"
    />
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
</style>
