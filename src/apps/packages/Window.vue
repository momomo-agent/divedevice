<script setup lang="ts">
/**
 * Packages —— Android 包管理器
 * 列表 + 搜索 + 过滤（全部/第三方/系统/已禁用） + 选中操作（启动/停止/清数据/禁用/启用/卸载）
 */
import { ref, computed, watch, shallowRef, onBeforeUnmount } from 'vue'
import { useDevice, useWindow } from '@/composables'
import { chat } from '@/services'
import type { PackageInfo } from '@/device'

const { window: win } = useWindow()
const device = useDevice()

type Filter = 'all' | 'thirdParty' | 'system' | 'disabled'
const filter = ref<Filter>('thirdParty')
const query = ref('')

const loading = ref(false)
const error = ref<string | null>(null)
const pkgs = shallowRef<string[]>([])
const infoMap = ref<Record<string, PackageInfo>>({})

const selected = ref<string | null>(null)
const busy = ref<string | null>(null) // 进行中的操作 message

async function loadList() {
  if (!device.value) { error.value = '未连接设备'; pkgs.value = []; return }
  loading.value = true
  error.value = null
  try {
    const thirdParty = filter.value === 'thirdParty' ? true : undefined
    const system = filter.value === 'system' ? true : undefined
    const names = await device.value.app.list({ thirdParty, system })
    pkgs.value = names
    // 信息懒加载（用户点详情再拉）
    if (!selected.value && names[0]) selected.value = names[0]
  } catch (err) {
    error.value = (err as Error).message
    pkgs.value = []
  } finally {
    loading.value = false
  }
}

const visible = computed(() => {
  const q = query.value.toLowerCase().trim()
  let list = pkgs.value
  if (filter.value === 'disabled') {
    list = list.filter((p) => infoMap.value[p]?.enabled === false)
  }
  if (q) list = list.filter((p) =>
    p.toLowerCase().includes(q) || infoMap.value[p]?.label?.toLowerCase().includes(q),
  )
  return list
})

watch(filter, loadList)
watch(() => win.value.deviceId, () => { pkgs.value = []; infoMap.value = {}; loadList() }, { immediate: true })

async function ensureInfo(pkg: string) {
  if (infoMap.value[pkg]) return infoMap.value[pkg]
  if (!device.value) return null
  const info = await device.value.app.info(pkg)
  if (info) {
    infoMap.value = { ...infoMap.value, [pkg]: info }
  }
  return info
}

watch(selected, (p) => { if (p) ensureInfo(p) }, { immediate: true })

const selectedInfo = computed(() => selected.value ? infoMap.value[selected.value] : null)

// ---- 操作 ----
async function op(kind: 'launch' | 'stop' | 'clear' | 'disable' | 'enable' | 'uninstall', pkg: string) {
  if (!device.value || busy.value) return
  const labels: Record<typeof kind, string> = {
    launch: '启动', stop: '停止', clear: '清数据', disable: '禁用', enable: '启用', uninstall: '卸载',
  }
  // 破坏性确认
  if (kind === 'uninstall' && !confirm(`确定要卸载 ${pkg} 吗？`)) return
  if (kind === 'clear' && !confirm(`清空 ${pkg} 的全部数据？`)) return
  busy.value = `${labels[kind]}中…`
  try {
    if (kind === 'launch') await device.value.app.launch(pkg)
    else if (kind === 'stop') await device.value.app.stop(pkg)
    else if (kind === 'clear') await device.value.app.clear(pkg)
    else if (kind === 'disable') await device.value.app.disable(pkg)
    else if (kind === 'enable') await device.value.app.enable(pkg)
    else if (kind === 'uninstall') await device.value.app.uninstall(pkg)
    chat.push('system', `✓ ${labels[kind]} ${pkg}`)
    if (kind === 'uninstall') {
      pkgs.value = pkgs.value.filter((p) => p !== pkg)
      selected.value = pkgs.value[0] ?? null
    } else if (kind === 'disable' || kind === 'enable') {
      // 刷新单个 info
      delete infoMap.value[pkg]
      await ensureInfo(pkg)
      infoMap.value = { ...infoMap.value }
    }
  } catch (err) {
    chat.push('system', `✖ ${labels[kind]} ${pkg} 失败：${(err as Error).message}`)
  } finally {
    busy.value = null
  }
}

function copyPkgName() {
  if (!selected.value) return
  navigator.clipboard?.writeText(selected.value).catch(() => {})
}

function fmtTs(ms?: number) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

onBeforeUnmount(() => {})
</script>

<template>
  <div class="packages">
    <!-- ===== Toolbar ===== -->
    <header class="toolbar">
      <div class="filter-seg">
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ active: filter === 'thirdParty' }" @click="filter = 'thirdParty'">第三方</button>
        <button :class="{ active: filter === 'system' }" @click="filter = 'system'">系统</button>
        <button :class="{ active: filter === 'disabled' }" @click="filter = 'disabled'">已禁用</button>
      </div>
      <input v-model="query" class="search" placeholder="搜索包名 / 应用名…" />
      <button class="icon-btn" @click="loadList" title="刷新" :disabled="loading">⟳</button>
      <span class="count">{{ visible.length }} / {{ pkgs.length }}</span>
    </header>

    <div class="body">
      <!-- ===== List ===== -->
      <aside class="list">
        <div v-if="error" class="hint err">{{ error }}</div>
        <div v-else-if="loading" class="hint">加载中…</div>
        <div v-else-if="!visible.length" class="hint">无匹配</div>
        <button
          v-for="p in visible"
          :key="p"
          class="row"
          :class="{ active: p === selected, disabled: infoMap[p]?.enabled === false }"
          @click="selected = p"
          :title="p"
        >
          <span class="pkg-icon">{{ infoMap[p]?.isSystem ? '⚙' : '📦' }}</span>
          <span class="pkg-label">{{ infoMap[p]?.label ?? p.split('.').pop() }}</span>
          <span class="pkg-name">{{ p }}</span>
          <span v-if="infoMap[p]?.enabled === false" class="badge">停</span>
        </button>
      </aside>

      <!-- ===== Detail ===== -->
      <section class="detail">
        <div v-if="!selected" class="hint center">选择左侧一项</div>
        <template v-else>
          <div class="detail-head">
            <div class="icon-big">{{ selectedInfo?.isSystem ? '⚙' : '📦' }}</div>
            <div class="meta">
              <div class="pkg">{{ selected }}</div>
              <div class="ver">
                v{{ selectedInfo?.versionName ?? '—' }}
                <span v-if="selectedInfo?.versionCode">({{ selectedInfo.versionCode }})</span>
                <span v-if="selectedInfo?.isSystem" class="tag sys">SYSTEM</span>
                <span v-if="selectedInfo?.enabled === false" class="tag warn">DISABLED</span>
              </div>
            </div>
            <button class="icon-btn" @click="copyPkgName" title="复制包名">⧉</button>
          </div>

          <div class="actions">
            <button class="btn primary" @click="op('launch', selected)" :disabled="!!busy">▶ 启动</button>
            <button class="btn" @click="op('stop', selected)" :disabled="!!busy">■ 停止</button>
            <button class="btn" @click="op('clear', selected)" :disabled="!!busy">♻ 清数据</button>
            <button v-if="selectedInfo?.enabled === false" class="btn" @click="op('enable', selected)" :disabled="!!busy">启用</button>
            <button v-else class="btn" @click="op('disable', selected)" :disabled="!!busy || selectedInfo?.isSystem">禁用</button>
            <button class="btn danger" @click="op('uninstall', selected)" :disabled="!!busy || selectedInfo?.isSystem">🗑 卸载</button>
          </div>

          <div v-if="busy" class="busy">{{ busy }}</div>

          <div class="props" v-if="selectedInfo">
            <div class="prop"><span>codePath</span><code>{{ selectedInfo.codePath ?? '—' }}</code></div>
            <div class="prop"><span>installer</span><code>{{ selectedInfo.installer ?? '—' }}</code></div>
            <div class="prop"><span>target / min SDK</span><code>{{ selectedInfo.targetSdk ?? '?' }} / {{ selectedInfo.minSdk ?? '?' }}</code></div>
            <div class="prop"><span>UID</span><code>{{ selectedInfo.uid ?? '—' }}</code></div>
            <div class="prop"><span>首次安装</span><code>{{ fmtTs(selectedInfo.firstInstallTime) }}</code></div>
            <div class="prop"><span>最后更新</span><code>{{ fmtTs(selectedInfo.lastUpdateTime) }}</code></div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.packages { display: flex; flex-direction: column; height: 100%; background: var(--surface-1); color: var(--fg-1); font-family: system-ui, -apple-system, sans-serif; }

.toolbar {
  display: flex; gap: 10px; align-items: center;
  padding: 8px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.filter-seg { display: inline-flex; background: var(--surface-3); border-radius: 5px; padding: 2px; gap: 2px; }
.filter-seg button {
  border: none; background: transparent;
  color: var(--fg-3); font-size: 11.5px;
  padding: 3px 10px; border-radius: 3px; cursor: pointer;
}
.filter-seg button:hover { color: var(--fg-1); }
.filter-seg button.active { background: var(--surface-1); color: var(--fg-1); box-shadow: 0 1px 2px rgba(0,0,0,0.3); }

.search {
  flex: 1;
  background: var(--surface-3);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 5px; color: var(--fg-1);
  padding: 3px 10px; font-size: 12px; height: 26px;
}
.search:focus { outline: none; border-color: rgba(99,163,255,0.45); }

.icon-btn {
  width: 26px; height: 26px; border: none;
  background: transparent; color: var(--fg-2);
  border-radius: 5px; cursor: pointer; font-size: 13px;
}
.icon-btn:hover { background: rgba(255,255,255,0.08); color: var(--fg-1); }
.icon-btn:disabled { opacity: 0.4; }

.count { font-size: 10.5px; color: var(--fg-3); margin-left: 4px; }

.body { flex: 1; display: flex; min-height: 0; }

.list {
  width: 320px; flex-shrink: 0;
  overflow-y: auto;
  background: var(--surface-2);
  border-right: 1px solid rgba(255,255,255,0.06);
  padding: 4px 0;
}
.hint { padding: 14px; font-size: 11.5px; color: var(--fg-3); text-align: center; }
.hint.err { color: #f87171; }
.hint.center { padding: 40px; }

.row {
  display: flex; align-items: center; gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: none; background: transparent;
  color: var(--fg-1); cursor: pointer;
  text-align: left;
  border-radius: 0;
}
.row:hover { background: rgba(255,255,255,0.04); }
.row.active { background: rgba(99,163,255,0.22); }
.row.disabled .pkg-label, .row.disabled .pkg-name { opacity: 0.55; }
.pkg-icon { font-size: 13px; width: 18px; text-align: center; }
.pkg-label { font-size: 12.5px; flex-shrink: 0; }
.pkg-name {
  font-size: 10.5px; color: var(--fg-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; font-family: ui-monospace, 'SF Mono', monospace;
}
.badge {
  font-size: 9px;
  background: rgba(255, 170, 80, 0.25);
  color: #ffc77a;
  padding: 1px 5px;
  border-radius: 3px;
}

.detail { flex: 1; min-width: 0; padding: 18px 20px; overflow-y: auto; }
.detail-head { display: flex; gap: 14px; align-items: center; }
.icon-big { font-size: 40px; }
.meta .pkg {
  font-size: 13px; font-weight: 500;
  font-family: ui-monospace, 'SF Mono', monospace;
  word-break: break-all;
}
.meta .ver { font-size: 11px; color: var(--fg-3); margin-top: 4px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.tag {
  font-size: 9px; padding: 1px 5px; border-radius: 3px;
  letter-spacing: 0.3px;
}
.tag.sys { background: rgba(155, 155, 255, 0.22); color: #bdbbff; }
.tag.warn { background: rgba(255, 170, 80, 0.22); color: #ffc77a; }

.actions {
  display: flex; gap: 6px; flex-wrap: wrap;
  margin-top: 18px;
}
.btn {
  padding: 5px 12px;
  border: 1px solid rgba(255,255,255,0.08);
  background: var(--surface-3);
  color: var(--fg-1);
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
}
.btn:hover { background: var(--surface-4); }
.btn.primary {
  background: rgba(99, 163, 255, 0.28);
  border-color: rgba(99, 163, 255, 0.4);
}
.btn.primary:hover { background: rgba(99, 163, 255, 0.42); }
.btn.danger {
  background: rgba(255, 100, 100, 0.18);
  border-color: rgba(255, 100, 100, 0.3);
  color: #ffbabe;
}
.btn.danger:hover { background: rgba(255, 100, 100, 0.32); }
.btn:disabled { opacity: 0.35; cursor: not-allowed; }

.busy { margin-top: 14px; color: var(--fg-3); font-size: 11.5px; }

.props {
  margin-top: 22px;
  display: grid;
  grid-template-columns: 140px 1fr;
  row-gap: 8px;
  column-gap: 14px;
  font-size: 11.5px;
}
.prop { display: contents; }
.prop span { color: var(--fg-3); }
.prop code {
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 11px;
  color: var(--fg-1);
  word-break: break-all;
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 3px;
}
</style>
