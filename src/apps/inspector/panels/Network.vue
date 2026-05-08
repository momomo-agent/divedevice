<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DeviceAPI, NetworkInfo } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const info = ref<NetworkInfo | null>(null)

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    info.value = await props.device.system.network()
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
    <template v-else-if="info">
      <h3>Wi-Fi</h3>
      <div class="kv">
        <span>SSID</span><code>{{ info.wifi.ssid ?? '—' }}</code>
        <span>IP</span><code>{{ info.wifi.ip ?? '—' }}</code>
      </div>

      <h3>接口</h3>
      <table v-if="info.ipAddrs.length">
        <thead><tr><th>iface</th><th>IPv4</th><th>IPv6</th></tr></thead>
        <tbody>
          <tr v-for="a in info.ipAddrs" :key="a.iface">
            <td>{{ a.iface }}</td>
            <td>{{ a.ipv4 ?? '—' }}</td>
            <td style="color: var(--fg-3)">{{ a.ipv6 ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="hint">无</div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>
