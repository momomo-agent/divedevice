<script setup lang="ts">
import { ref, onMounted, computed, watch, inject, type Ref } from 'vue'
import type { DeviceAPI, TopActivity, ActivityTask } from '@/device'

const props = defineProps<{ device: DeviceAPI | null }>()
const loading = ref(true)
const error = ref<string | null>(null)
const top = ref<TopActivity | null>(null)
const tasks = ref<ActivityTask[]>([])
const selected = ref<ActivityTask | null>(null)

async function load() {
  if (!props.device) { error.value = '未连接设备'; loading.value = false; return }
  try {
    const [t, ts] = await Promise.all([
      props.device.system.topActivity(),
      props.device.system.tasks(),
    ])
    top.value = t
    tasks.value = ts
    // 刷新后保留用户选择：如果选中的 task 还在 就保留，不在了才 fallback
    if (selected.value && !ts.some((x) => x.taskId === selected.value!.taskId)) {
      selected.value = ts.find((x) => x.topActivity === t?.activityName) ?? ts[0] ?? null
    } else if (!selected.value) {
      selected.value = ts.find((x) => x.topActivity === t?.activityName) ?? ts[0] ?? null
    }
    error.value = null
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

onMounted(load)
const tick = inject<Ref<number>>('inspector:refreshTick')
if (tick) watch(tick, load)

function pkgFromActivity(s?: string | null): string {
  if (!s) return ''
  const idx = s.indexOf('/')
  return idx > 0 ? s.slice(0, idx) : s
}
function shortActivity(s?: string | null): string {
  if (!s) return '—'
  const idx = s.indexOf('/')
  const tail = idx > 0 ? s.slice(idx + 1) : s
  return tail.startsWith('.') ? tail.slice(1) : tail
}
function pkgShort(p: string): string {
  return p.split('.').pop() ?? p
}
function hue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}
const isForeground = computed(() => (t: ActivityTask) => t.topActivity === top.value?.activityName)
</script>

<template>
  <div class="panel">
    <div v-if="error" class="hint err">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>
    <template v-else>
      <!-- Foreground Hero -->
      <div class="hero">
        <div class="hero-ic" :style="{ background: `hsl(${hue(pkgFromActivity(top?.activityName))} 50% 50% / 0.3)` }">
          {{ pkgShort(pkgFromActivity(top?.activityName)).slice(0, 2).toUpperCase() }}
        </div>
        <div class="hero-text">
          <div class="lbl">Current Foreground</div>
          <div class="pkg">{{ top?.packageName || '—' }}</div>
          <div class="act">{{ shortActivity(top?.activityName) }}</div>
        </div>
      </div>

      <!-- Task Stack 纸牌堆 -->
      <h3 class="hdr">
        <span>🗂 Task Stack</span>
        <span class="count">{{ tasks.length }} 个 task · 点击查看</span>
      </h3>
      <div v-if="!tasks.length" class="hint">无 recent tasks</div>
      <div v-else class="layout">
        <div class="stack-col">
          <div
            v-for="t in tasks"
            :key="t.taskId"
            class="task-card"
            :class="{ active: selected?.taskId === t.taskId, foreground: isForeground(t) }"
            :style="{ background: `linear-gradient(135deg, hsl(${hue(pkgFromActivity(t.topActivity))} 50% 45% / 0.22), hsl(${hue(pkgFromActivity(t.topActivity))} 50% 55% / 0.12))` }"
            @click="selected = t"
          >
            <div class="row1">
              <span class="tag">#{{ t.taskId }}</span>
              <span class="pkg">{{ pkgShort(pkgFromActivity(t.topActivity)) }}</span>
              <div class="grow" />
              <span v-if="isForeground(t)" class="pill good">● Top</span>
              <span v-else class="pill neutral">Bg</span>
            </div>
            <div class="act">{{ shortActivity(t.topActivity) }}</div>
            <div class="meta">
              <span v-if="t.numActivities">× {{ t.numActivities }} activities</span>
              <span v-if="t.realActivity && t.realActivity !== t.topActivity">real: {{ shortActivity(t.realActivity) }}</span>
            </div>
          </div>
        </div>

        <div class="detail-col">
          <div v-if="selected" class="detail">
            <h4>#{{ selected.taskId }} · {{ pkgFromActivity(selected.topActivity) }}</h4>
            <div class="kv">
              <span>Task ID</span><code>{{ selected.taskId }}</code>
              <span>Top Activity</span><code>{{ selected.topActivity ?? '—' }}</code>
              <span>Real Activity</span><code>{{ selected.realActivity ?? '—' }}</code>
              <span>Activity Count</span><code>{{ selected.numActivities ?? '—' }}</code>
              <span>是否前台</span><code>{{ isForeground(selected) ? 'Yes' : 'No' }}</code>
            </div>
          </div>
          <div v-else class="hint">点击左侧 task 查看详情</div>
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
  background: var(--surface-2);
  border-radius: 10px;
  margin-bottom: 14px;
}
.hero-ic {
  width: 52px; height: 52px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 600; color: var(--fg-1);
}
.hero-text { flex: 1; min-width: 0; }
.hero-text .lbl { font-size: 10px; color: var(--fg-3); text-transform: uppercase; letter-spacing: 0.4px; }
.hero-text .pkg { font-size: 14px; color: var(--fg-1); font-weight: 600; font-family: ui-monospace, monospace; margin: 3px 0 1px; }
.hero-text .act { font-size: 11px; color: var(--fg-3); font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.layout { display: grid; grid-template-columns: 1fr 1.1fr; gap: 12px; }
.stack-col { display: flex; flex-direction: column; gap: 6px; max-height: 480px; overflow: auto; }

.task-card {
  background: var(--surface-2);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  transition: transform 0.12s, border-color 0.12s;
}
.task-card:hover { border-color: rgba(255,255,255,0.12); transform: translateY(-1px); }
.task-card.active { border-color: rgba(99,163,255,0.5); box-shadow: 0 0 0 1px rgba(99,163,255,0.25); }
.task-card.foreground { border-color: rgba(126,230,166,0.5); }
.task-card .row1 { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.task-card .tag { font-size: 10px; color: var(--fg-3); font-family: ui-monospace, monospace; }
.task-card .pkg { font-size: 11.5px; color: var(--fg-1); font-weight: 500; font-family: ui-monospace, monospace; }
.task-card .grow { flex: 1; }
.task-card .act {
  font-size: 10.5px; color: var(--fg-2); font-family: ui-monospace, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.task-card .meta {
  font-size: 10px; color: var(--fg-3);
  display: flex; gap: 10px;
  margin-top: 3px;
}

.detail-col { background: var(--surface-2); border-radius: 8px; padding: 12px 14px; min-height: 200px; }
.detail h4 { margin: 0 0 10px; font-size: 12px; color: var(--fg-1); }
</style>
