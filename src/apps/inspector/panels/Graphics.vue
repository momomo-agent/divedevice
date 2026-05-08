<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DeviceAPI } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(false)
const error = ref<string | null>(null)
const target = ref('')
const output = ref('')
const topActivityPkg = ref<string | null>(null)

async function load() {
  if (!props.device) { error.value = '未连接设备'; return }
  loading.value = true
  error.value = null
  try {
    output.value = await props.device.system.gfxinfo(target.value || undefined)
  } catch (err) {
    error.value = (err as Error).message
    output.value = ''
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  // 默认填充前台包
  if (props.device) {
    const t = await props.device.system.topActivity().catch(() => null)
    topActivityPkg.value = t?.packageName ?? null
    if (t?.packageName) target.value = t.packageName
  }
  load()
})

function summaryLines(text: string): string[] {
  // 抽 "Total frames rendered"、"Janky frames"、"50th/90th/99th percentile"
  const lines = text.split('\n')
  return lines.filter((l) => /Total frames|Janky|percentile|Number Missed|HISTOGRAM/.test(l))
}
</script>

<template>
  <div class="panel">
    <h3>gfxinfo</h3>
    <div style="display: flex; gap: 8px; margin-bottom: 10px;">
      <input v-model="target" class="search" placeholder="包名（留空 = 全局）" style="flex: 1; margin-bottom: 0;" />
      <button class="btn" @click="load" :disabled="loading">{{ loading ? '…' : '获取' }}</button>
      <button
        v-if="topActivityPkg && target !== topActivityPkg"
        class="btn"
        @click="target = topActivityPkg!; load()"
        :title="`切到前台 ${topActivityPkg}`"
      >前台</button>
    </div>

    <div v-if="error" class="hint err">{{ error }}</div>

    <template v-if="output">
      <h3>关键指标</h3>
      <pre>{{ summaryLines(output).join('\n') || '(未抽到关键指标)' }}</pre>
      <h3>原始输出</h3>
      <pre>{{ output }}</pre>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
