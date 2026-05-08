<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DeviceAPI, TopActivity, ActivityTask } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const top = ref<TopActivity | null>(null)
const tasks = ref<ActivityTask[]>([])

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    const [t, ts] = await Promise.all([
      props.device.system.topActivity(),
      props.device.system.tasks(),
    ])
    top.value = t
    tasks.value = ts
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <h3>前台 Activity</h3>
      <div v-if="!top" class="hint">未获取到</div>
      <div v-else class="kv">
        <span>包名</span><code>{{ top.packageName }}</code>
        <span>Activity</span><code>{{ top.activityName }}</code>
      </div>

      <h3>Task Stack ({{ tasks.length }})</h3>
      <div v-if="!tasks.length" class="hint">无 recent tasks</div>
      <table v-else>
        <thead><tr><th>taskId</th><th>top</th><th>real</th><th>count</th></tr></thead>
        <tbody>
          <tr v-for="t in tasks" :key="t.taskId">
            <td>{{ t.taskId }}</td>
            <td>{{ t.topActivity ?? '—' }}</td>
            <td>{{ t.realActivity ?? '—' }}</td>
            <td>{{ t.numActivities ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
