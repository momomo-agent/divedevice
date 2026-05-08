<script setup lang="ts">
import { windowManager } from '@/services'
import WindowFrame from './WindowFrame.vue'
</script>

<template>
  <div class="desktop">
    <WindowFrame
      v-for="w in windowManager.windows"
      :key="w.id"
      :window="w"
    />
    <div v-if="!windowManager.windows.length" class="empty">
      <div class="empty-inner">
        <div class="title">DiveDevice</div>
        <div class="hint">从左侧 dock 打开一个 App，或点击 🔌 连接 Android 设备</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.desktop {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background:
    radial-gradient(circle at 30% 20%, rgba(99, 163, 255, 0.08), transparent 45%),
    radial-gradient(circle at 80% 80%, rgba(94, 234, 212, 0.05), transparent 50%),
    var(--bg);
}
.empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-3);
  pointer-events: none;
}
.empty-inner { text-align: center; }
.empty-inner .title {
  font-size: 28px;
  color: var(--fg-2);
  margin-bottom: 8px;
  letter-spacing: 1px;
}
.empty-inner .hint { font-size: 13px; }
</style>
