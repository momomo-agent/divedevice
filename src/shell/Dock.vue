<script setup lang="ts">
import { computed } from 'vue'
import { appRegistry, windowManager, deviceHub } from '@/services'

const apps = computed(() => appRegistry.list())

function onLaunch(appId: string) {
  const manifest = appRegistry.get(appId)
  if (!manifest) return
  windowManager.open({
    appId,
    deviceId: manifest.requiresDevice ? deviceHub.currentId.value : null,
  })
}
</script>

<template>
  <aside class="dock">
    <div class="logo">◈</div>
    <div class="apps">
      <button
        v-for="a in apps"
        :key="a.id"
        class="app"
        :title="a.name"
        @click="onLaunch(a.id)"
      >
        <span class="icon">{{ a.icon }}</span>
      </button>
    </div>
    <div class="bottom">
      <button class="app connect" title="连接 USB 设备" @click="deviceHub.requestUsb()">
        <span class="icon">🔌</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.dock {
  width: 56px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  gap: 12px;
  background: var(--surface-2);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}
.logo {
  color: var(--accent);
  font-size: 20px;
  margin-bottom: 4px;
}
.apps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  overflow-y: auto;
}
.bottom {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.app {
  width: 40px;
  height: 40px;
  border-radius: 9px;
  border: none;
  background: var(--surface-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.08s ease, background 0.15s ease;
}
.app:hover { background: var(--surface-4); transform: scale(1.04); }
.app:active { transform: scale(0.96); }
.app .icon { font-size: 18px; }
.app.connect { background: rgba(99, 163, 255, 0.18); }
</style>
