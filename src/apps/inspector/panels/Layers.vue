<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DeviceAPI, LayerInfo } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const layers = ref<LayerInfo | null>(null)
const query = ref('')
const onlyVisible = ref(false)

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    layers.value = await props.device.system.layers()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

const filtered = computed(() => {
  if (!layers.value) return []
  let list = layers.value.layers
  if (onlyVisible.value) list = list.filter((l) => l.visible)
  const q = query.value.toLowerCase().trim()
  if (q) list = list.filter((l) => l.name.toLowerCase().includes(q))
  return list
})
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else-if="layers">
      <h3>SurfaceFlinger</h3>
      <div class="kv" style="grid-template-columns: auto auto; margin-bottom: 12px;">
        <span>Total</span><code>{{ layers.total }}</code>
        <span>Visible (heuristic)</span><code>{{ layers.visible }}</code>
      </div>

      <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
        <input v-model="query" class="search" placeholder="搜索 layer 名" style="flex: 1; margin-bottom: 0;" />
        <label style="font-size: 11.5px; color: var(--fg-3); display: inline-flex; gap: 4px; align-items: center; user-select: none;">
          <input type="checkbox" v-model="onlyVisible" />仅 Visible
        </label>
      </div>

      <table>
        <thead>
          <tr><th style="width: 40px;">#</th><th>Layer</th><th style="width: 70px;">Visible</th></tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in filtered.slice(0, 500)" :key="l.name + i">
            <td style="color: var(--fg-3)">{{ i }}</td>
            <td :title="l.name">{{ l.name }}</td>
            <td>{{ l.visible ? '●' : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="filtered.length > 500" class="hint">仅显示前 500 项</div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
