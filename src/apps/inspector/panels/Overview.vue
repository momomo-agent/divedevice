<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DeviceAPI, TopActivity, BatteryInfo, CpuInfo, LayerInfo } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()

const loading = ref(true)
const error = ref<string | null>(null)
const top = ref<TopActivity | null>(null)
const battery = ref<BatteryInfo>({})
const cpu = ref<CpuInfo>({})
const layers = ref<LayerInfo | null>(null)
const procCount = ref<number | null>(null)
const ime = ref<string | null>(null)

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    const d = props.device
    const [t, b, c, l, p, im] = await Promise.all([
      d.system.topActivity().catch(() => null),
      d.system.battery().catch(() => ({})),
      d.system.cpuinfo().catch(() => ({})),
      d.system.layers().catch(() => null),
      d.system.processes().then((arr) => arr.length).catch(() => null),
      d.system.currentIme().catch(() => null),
    ])
    top.value = t
    battery.value = b
    cpu.value = c
    layers.value = l
    procCount.value = p
    ime.value = im
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
      <h3>当前前台</h3>
      <div class="kv">
        <span>包名</span><code>{{ top?.packageName ?? '—' }}</code>
        <span>Activity</span><code>{{ top?.activityName ?? '—' }}</code>
      </div>

      <h3>系统快照</h3>
      <div class="kv">
        <span>进程数</span><code>{{ procCount ?? '—' }}</code>
        <span>SurfaceFlinger</span><code>{{ layers ? `${layers.total} layers / ${layers.visible} visible` : '—' }}</code>
        <span>CPU load</span><code>{{ cpu.load1 ?? '?' }} / {{ cpu.load5 ?? '?' }} / {{ cpu.load15 ?? '?' }} · {{ cpu.cores ?? '?' }} cores</code>
        <span>电池</span><code>
          {{ battery.level ?? '?' }}{{ battery.scale ? '/' + battery.scale : '' }}
          · {{ battery.status ?? '?' }}
          <span v-if="battery.plugged && battery.plugged !== 'None'">· {{ battery.plugged }}</span>
          <span v-if="battery.temperature"> · {{ battery.temperature }}°C</span>
        </code>
        <span>IME</span><code>{{ ime ?? '—' }}</code>
      </div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
