<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { DeviceAPI, ProcessInfo } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const procs = ref<ProcessInfo[]>([])
const query = ref('')
const sortBy = ref<'rss' | 'vsz' | 'pid' | 'name'>('rss')

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    procs.value = await props.device.system.processes()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

const visible = computed(() => {
  const q = query.value.toLowerCase().trim()
  let list = procs.value
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q))
  list = [...list]
  if (sortBy.value === 'rss') list.sort((a, b) => b.rss - a.rss)
  else if (sortBy.value === 'vsz') list.sort((a, b) => b.vsz - a.vsz)
  else if (sortBy.value === 'pid') list.sort((a, b) => a.pid - b.pid)
  else if (sortBy.value === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
  return list
})

const maxRss = computed(() => visible.value.reduce((m, p) => Math.max(m, p.rss), 1))

function fmtKb(kb: number) {
  if (kb > 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb > 1024) return (kb / 1024).toFixed(1) + ' MB'
  return kb + ' KB'
}
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <input v-model="query" class="search" placeholder="搜索进程名 / PID" />
      <div class="kv" style="grid-template-columns: auto auto; margin-bottom: 10px;">
        <span>总数</span><code>{{ visible.length }} / {{ procs.length }}</code>
      </div>
      <table>
        <thead>
          <tr>
            <th style="cursor: pointer" @click="sortBy = 'pid'">PID</th>
            <th>USER</th>
            <th style="cursor: pointer" @click="sortBy = 'name'">NAME</th>
            <th style="cursor: pointer; text-align: right" @click="sortBy = 'rss'">RSS</th>
            <th style="cursor: pointer; text-align: right" @click="sortBy = 'vsz'">VSZ</th>
            <th style="width: 120px;">MEM</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in visible.slice(0, 400)" :key="p.pid">
            <td>{{ p.pid }}</td>
            <td>{{ p.user }}</td>
            <td :title="p.name">{{ p.name }}</td>
            <td style="text-align: right">{{ fmtKb(p.rss) }}</td>
            <td style="text-align: right; color: var(--fg-3)">{{ fmtKb(p.vsz) }}</td>
            <td><div class="bar"><div class="fill" :style="{ width: (p.rss / maxRss * 100) + '%' }"></div></div></td>
          </tr>
        </tbody>
      </table>
      <div v-if="visible.length > 400" class="hint">仅显示前 400 项</div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
