<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DeviceAPI } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const map = ref<Record<string, string>>({})
const query = ref('')

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    map.value = await props.device.system.getProps()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

const entries = computed(() => {
  const q = query.value.toLowerCase().trim()
  let list = Object.entries(map.value)
  if (q) list = list.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q))
  list.sort(([a], [b]) => a.localeCompare(b))
  return list
})

function copy(v: string) { navigator.clipboard?.writeText(v).catch(() => {}) }
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <input v-model="query" class="search" placeholder="搜索 key / value（如 ro.build / model）" />
      <div class="kv" style="grid-template-columns: auto auto; margin-bottom: 10px;">
        <span>总数</span><code>{{ entries.length }} / {{ Object.keys(map).length }}</code>
      </div>
      <table>
        <thead><tr><th style="width: 40%;">key</th><th>value</th></tr></thead>
        <tbody>
          <tr v-for="[k, v] in entries.slice(0, 600)" :key="k" @dblclick="copy(v)" :title="`双击复制: ${v}`">
            <td style="color: var(--fg-2)">{{ k }}</td>
            <td>{{ v || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="entries.length > 600" class="hint">仅显示前 600 项，继续搜索缩小范围</div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
