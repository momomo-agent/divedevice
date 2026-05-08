<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch, inject, type Ref } from 'vue'
import type { DeviceAPI, NetworkInfo } from '@/device'
import Sparkline from '../components/Sparkline.vue'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const info = ref<NetworkInfo | null>(null)

// 流量采样：/proc/net/dev
interface IfaceTraffic {
  rxBytes: number
  txBytes: number
  rxHistory: number[]   // per-sample delta bytes/s
  txHistory: number[]
}
const traffic = ref<Map<string, IfaceTraffic>>(new Map())
let last: Map<string, { rx: number; tx: number; t: number }> = new Map()
let timer: number | null = null

async function loadTraffic() {
  if (!props.device) return
  try {
    const r = await props.device.shell.exec('cat /proc/net/dev')
    const now = Date.now()
    const lines = r.stdout.split('\n').slice(2) // skip 2 header lines
    const next = new Map<string, { rx: number; tx: number; t: number }>()
    for (const line of lines) {
      const m = line.trim().match(/^(\S+?):\s+(\d+)(?:\s+\d+){7}\s+(\d+)/)
      if (!m) continue
      const iface = m[1]
      const rx = Number(m[2])
      const tx = Number(m[3])
      next.set(iface, { rx, tx, t: now })
      const prev = last.get(iface)
      let entry = traffic.value.get(iface)
      if (!entry) {
        entry = { rxBytes: rx, txBytes: tx, rxHistory: [], txHistory: [] }
        traffic.value.set(iface, entry)
      }
      entry.rxBytes = rx
      entry.txBytes = tx
      if (prev) {
        const dt = Math.max(0.001, (now - prev.t) / 1000)
        const rxRate = Math.max(0, (rx - prev.rx) / dt)
        const txRate = Math.max(0, (tx - prev.tx) / dt)
        entry.rxHistory.push(rxRate)
        entry.txHistory.push(txRate)
        if (entry.rxHistory.length > 40) entry.rxHistory.shift()
        if (entry.txHistory.length > 40) entry.txHistory.shift()
      }
    }
    last = next
  } catch {}
}

onMounted(async () => {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    info.value = await props.device.system.network()
    await loadTraffic()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
  timer = window.setInterval(loadTraffic, 2000) as unknown as number
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const tick = inject<Ref<number>>('inspector:refreshTick')
if (tick) watch(tick, async () => {
  if (!props.device) return
  try { info.value = await props.device.system.network() } catch (err) { error.value = (err as Error).message }
  await loadTraffic()
})

function fmtBytes(b: number): string {
  if (b > 1024 ** 3) return (b / 1024 ** 3).toFixed(2) + ' GB'
  if (b > 1024 ** 2) return (b / 1024 ** 2).toFixed(1) + ' MB'
  if (b > 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}
function fmtRate(bps: number): string {
  return fmtBytes(bps) + '/s'
}
function ifaceIcon(name: string): string {
  if (name.startsWith('wlan') || name.startsWith('wifi')) return '📶'
  if (name.startsWith('rmnet') || name.startsWith('ccmni')) return '📡'
  if (name === 'lo') return '🔁'
  if (name.startsWith('dummy')) return '🛈'
  if (name.startsWith('tun') || name.startsWith('ppp') || name.includes('vpn')) return '🔒'
  if (name.startsWith('p2p')) return '🤝'
  if (name.startsWith('eth')) return '🔌'
  if (name.includes('arp')) return '🧬'
  return '🔗'
}

const interfacesSorted = computed(() => {
  if (!info.value) return []
  return [...info.value.ipAddrs].sort((a, b) => {
    // wlan/rmnet > eth > lo > dummy
    const order = (n: string) => n.startsWith('wlan') ? 0 : n.startsWith('rmnet') ? 1 : n.startsWith('eth') ? 2 : n === 'lo' ? 9 : 5
    return order(a.iface) - order(b.iface)
  })
})
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else-if="info">
      <!-- Wi-Fi hero -->
      <div class="hero">
        <div class="ic">📶</div>
        <div class="meta">
          <div class="ssid">{{ info.wifi.ssid || 'Wi-Fi 未连接' }}</div>
          <div class="row">
            <span class="pill info" v-if="info.wifi.ip">IP {{ info.wifi.ip }}</span>
            <span class="pill neutral" v-else>未分配</span>
          </div>
        </div>
      </div>

      <!-- 接口列表 -->
      <h3 class="hdr"><span>Interfaces</span><span class="count">— 实时流量</span></h3>
      <div class="iface-list">
        <div v-for="a in interfacesSorted" :key="a.iface" class="iface-card">
          <div class="row1">
            <span class="iic">{{ ifaceIcon(a.iface) }}</span>
            <span class="nm">{{ a.iface }}</span>
            <div class="grow" />
            <span v-if="traffic.get(a.iface)" class="rx-rate">
              ↓ {{ fmtRate((traffic.get(a.iface)!.rxHistory.slice(-1)[0] ?? 0)) }}
            </span>
            <span v-if="traffic.get(a.iface)" class="tx-rate">
              ↑ {{ fmtRate((traffic.get(a.iface)!.txHistory.slice(-1)[0] ?? 0)) }}
            </span>
          </div>
          <div class="addrs">
            <span v-if="a.ipv4" class="addr ipv4">IPv4 {{ a.ipv4 }}</span>
            <span v-if="a.ipv6" class="addr ipv6">IPv6 {{ a.ipv6 }}</span>
            <span v-if="!a.ipv4 && !a.ipv6" class="addr none">无地址</span>
          </div>
          <div v-if="traffic.get(a.iface) && traffic.get(a.iface)!.rxHistory.length > 1" class="charts">
            <div class="ch">
              <span class="ch-lbl">RX</span>
              <Sparkline :data="traffic.get(a.iface)!.rxHistory" :width="160" :height="24" stroke="#7ee6a6" fill="rgba(126,230,166,0.16)" />
              <span class="ch-tot">{{ fmtBytes(traffic.get(a.iface)!.rxBytes) }}</span>
            </div>
            <div class="ch">
              <span class="ch-lbl">TX</span>
              <Sparkline :data="traffic.get(a.iface)!.txHistory" :width="160" :height="24" stroke="#9ecbff" fill="rgba(99,163,255,0.16)" />
              <span class="ch-tot">{{ fmtBytes(traffic.get(a.iface)!.txBytes) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped src="../panel.css"></style>

<style scoped>
.hero {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(99,163,255,0.12), rgba(126,230,166,0.06));
  border: 1px solid rgba(99,163,255,0.2);
  border-radius: 10px;
  margin-bottom: 14px;
}
.hero .ic { font-size: 32px; }
.hero .ssid { font-size: 15px; font-weight: 600; color: var(--fg-1); }
.hero .row { display: flex; gap: 6px; margin-top: 4px; }

.iface-list { display: flex; flex-direction: column; gap: 8px; }
.iface-card {
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 8px;
  padding: 10px 12px;
}
.row1 { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.row1 .iic { font-size: 14px; }
.row1 .nm { font-weight: 600; color: var(--fg-1); font-family: ui-monospace, monospace; }
.row1 .grow { flex: 1; }
.row1 .rx-rate { color: #7ee6a6; font-size: 11px; font-variant-numeric: tabular-nums; }
.row1 .tx-rate { color: #9ecbff; font-size: 11px; font-variant-numeric: tabular-nums; }

.addrs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; font-size: 10.5px; font-family: ui-monospace, monospace; }
.addr { padding: 2px 7px; border-radius: 3px; }
.addr.ipv4 { background: rgba(99,163,255,0.15); color: #9ecbff; }
.addr.ipv6 { background: rgba(155,105,255,0.15); color: #bdbbff; }
.addr.none { color: var(--fg-3); }

.charts { display: flex; gap: 16px; margin-top: 8px; flex-wrap: wrap; }
.ch { display: flex; align-items: center; gap: 8px; }
.ch-lbl { font-size: 10px; color: var(--fg-3); min-width: 18px; font-family: ui-monospace, monospace; }
.ch-tot { font-size: 10.5px; color: var(--fg-2); min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; }
</style>
