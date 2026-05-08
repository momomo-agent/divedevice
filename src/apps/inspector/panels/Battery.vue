<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { DeviceAPI, BatteryInfo } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const b = ref<BatteryInfo>({})

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    b.value = await props.device.system.battery()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

const percent = computed(() => {
  if (b.value.level && b.value.scale) return Math.round((b.value.level / b.value.scale) * 100)
  if (b.value.level && b.value.level <= 100) return b.value.level
  return null
})
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <h3>电量</h3>
      <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
        <div style="font-size: 40px; font-weight: 300;">{{ percent ?? '?' }}%</div>
        <div class="bar" style="flex: 1; height: 14px;">
          <div class="fill" :style="{ width: (percent ?? 0) + '%' }"></div>
        </div>
      </div>

      <h3>详情</h3>
      <div class="kv">
        <span>状态</span><code>{{ b.status ?? '—' }}</code>
        <span>充电</span><code>{{ b.plugged ?? '—' }}</code>
        <span>电压</span><code>{{ b.voltage ? (b.voltage / 1000).toFixed(3) + ' V' : '—' }}</code>
        <span>温度</span><code>{{ b.temperature !== undefined ? b.temperature + ' °C' : '—' }}</code>
        <span>健康</span><code>{{ b.health ?? '—' }}</code>
        <span>类型</span><code>{{ b.technology ?? '—' }}</code>
        <span>Present</span><code>{{ b.present === undefined ? '—' : (b.present ? 'true' : 'false') }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
