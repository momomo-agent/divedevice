<script setup lang="ts">
import { deviceHub } from '@/services'

defineProps<{ currentId: string | null }>()
const emit = defineEmits<{
  select: [id: string | null]
  close: []
}>()

async function onAddUsb() {
  try {
    await deviceHub.requestUsb()
  } catch (err) {
    console.error(err)
    alert((err as Error).message)
  }
  emit('close')
}
</script>

<template>
  <div class="menu" @click.stop>
    <div class="section-title">设备</div>
    <div v-if="!deviceHub.devices.value.length" class="empty">
      尚未连接设备
    </div>
    <button
      v-for="d in deviceHub.devices.value"
      :key="d.id"
      class="row"
      :class="{ active: d.id === currentId }"
      @click="emit('select', d.id)"
    >
      <span class="dot" :class="{ on: d.connected }" />
      <span class="name">{{ d.name }}</span>
      <span class="transport">{{ d.transport.toUpperCase() }}</span>
    </button>
    <div class="sep" />
    <button class="row add" @click="onAddUsb">
      <span class="plus">+</span> 通过 USB 添加…
    </button>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 220px;
  background: var(--surface-3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  padding: 6px;
  z-index: 1000;
}
.section-title {
  font-size: 10px;
  color: var(--fg-3);
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.empty {
  padding: 8px;
  font-size: 11px;
  color: var(--fg-3);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 5px;
  background: transparent;
  border: none;
  color: var(--fg-1);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.row:hover { background: rgba(255, 255, 255, 0.08); }
.row.active { background: rgba(99, 163, 255, 0.18); }
.row .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-3);
}
.row .dot.on { background: #5eead4; }
.row .name { flex: 1; }
.row .transport {
  font-size: 10px;
  color: var(--fg-3);
}
.sep {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 4px 2px;
}
.row.add .plus {
  width: 6px;
  color: var(--fg-2);
}
</style>
