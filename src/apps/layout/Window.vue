<script setup lang="ts">
/**
 * Layout Inspector — View Hierarchy + 屏幕信息 + bounds 高亮
 * 左侧：节点树（可折叠）
 * 右侧：截图 + 选中节点 bounds 叠加高亮 + 属性面板
 */
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useDevice, useWindow } from '@/composables'

const { window: win } = useWindow()
const device = useDevice()

interface ViewNode {
  class: string
  pkg: string
  text: string
  resourceId: string
  contentDesc: string
  bounds: { x: number; y: number; w: number; h: number } | null
  children: ViewNode[]
  depth: number
}

const loading = ref(false)
const error = ref<string | null>(null)
const tree = ref<ViewNode[]>([])
const selected = ref<ViewNode | null>(null)
const screenshotUrl = ref<string | null>(null)
const screenW = ref(1080)
const screenH = ref(2400)

// 屏幕信息
const displayInfo = ref<{
  physicalSize: { w: number; h: number } | null
  overrideSize: { w: number; h: number } | null
  physicalDensity: number | null
  overrideDensity: number | null
  refreshRate: number | null
} | null>(null)

// 设备 preset
const PRESETS = [
  { label: 'Pixel 7', w: 1080, h: 2400, dpi: 420 },
  { label: 'Pixel Fold', w: 2208, h: 1840, dpi: 420 },
  { label: 'Galaxy S24', w: 1080, h: 2340, dpi: 450 },
  { label: 'Galaxy Z Fold', w: 1812, h: 2176, dpi: 420 },
  { label: 'Tablet 10"', w: 1200, h: 1920, dpi: 240 },
  { label: 'Small (720p)', w: 720, h: 1280, dpi: 320 },
] as const

async function applyPreset(p: typeof PRESETS[number]) {
  if (!device.value) return
  await device.value.shell.exec(`wm size ${p.w}x${p.h}`)
  await device.value.shell.exec(`wm density ${p.dpi}`)
  await refreshDisplayInfo()
}

async function resetDisplay() {
  if (!device.value) return
  await device.value.shell.exec('wm size reset')
  await device.value.shell.exec('wm density reset')
  await refreshDisplayInfo()
}

async function refreshDisplayInfo() {
  if (!device.value) return
  displayInfo.value = await device.value.system.displayInfo()
  const sz = displayInfo.value.overrideSize ?? displayInfo.value.physicalSize
  if (sz) { screenW.value = sz.w; screenH.value = sz.h }
}

// 展开状态
const expanded = ref(new Set<ViewNode>())

function parseXml(xml: string): ViewNode[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')
  const root = doc.querySelector('hierarchy')
  if (!root) return []

  function parseBounds(s: string): { x: number; y: number; w: number; h: number } | null {
    const m = s.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    if (!m) return null
    const x1 = Number(m[1]), y1 = Number(m[2]), x2 = Number(m[3]), y2 = Number(m[4])
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
  }

  function walk(el: Element, depth: number): ViewNode {
    const node: ViewNode = {
      class: el.getAttribute('class') || '',
      pkg: el.getAttribute('package') || '',
      text: el.getAttribute('text') || '',
      resourceId: el.getAttribute('resource-id') || '',
      contentDesc: el.getAttribute('content-desc') || '',
      bounds: parseBounds(el.getAttribute('bounds') || ''),
      children: [],
      depth,
    }
    for (const child of el.children) {
      node.children.push(walk(child, depth + 1))
    }
    return node
  }

  const nodes: ViewNode[] = []
  for (const child of root.children) {
    nodes.push(walk(child, 0))
  }
  return nodes
}

async function capture() {
  if (!device.value) { error.value = '未连接设备'; return }
  loading.value = true
  error.value = null
  try {
    const [xml, png, info] = await Promise.all([
      device.value.system.viewHierarchy(),
      device.value.screen.capture(),
      device.value.system.displayInfo(),
    ])
    tree.value = parseXml(xml)
    displayInfo.value = info

    // 截图 → objectURL
    if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value)
    screenshotUrl.value = URL.createObjectURL(new Blob([png], { type: 'image/png' }))

    // 推断屏幕尺寸
    const sz = info.overrideSize ?? info.physicalSize
    if (sz) { screenW.value = sz.w; screenH.value = sz.h }

    // 默认展开第一层
    expanded.value = new Set(tree.value)
    selected.value = null
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch(() => win.value.deviceId, () => { tree.value = []; capture() }, { immediate: true })

function toggle(node: ViewNode) {
  if (expanded.value.has(node)) expanded.value.delete(node)
  else expanded.value.add(node)
  expanded.value = new Set(expanded.value)
}

function selectNode(node: ViewNode) {
  selected.value = node
}

function shortClass(cls: string) {
  const parts = cls.split('.')
  return parts[parts.length - 1] || cls
}

// 扁平化可见节点（用于虚拟列表）
const flatNodes = computed(() => {
  const out: ViewNode[] = []
  function walk(nodes: ViewNode[]) {
    for (const n of nodes) {
      out.push(n)
      if (expanded.value.has(n) && n.children.length) walk(n.children)
    }
  }
  walk(tree.value)
  return out
})

// bounds 叠加样式
const boundsStyle = computed(() => {
  if (!selected.value?.bounds) return null
  const b = selected.value.bounds
  const scaleX = 100 / screenW.value
  const scaleY = 100 / screenH.value
  return {
    left: `${b.x * scaleX}%`,
    top: `${b.y * scaleY}%`,
    width: `${b.w * scaleX}%`,
    height: `${b.h * scaleY}%`,
  }
})

onBeforeUnmount(() => {
  if (screenshotUrl.value) URL.revokeObjectURL(screenshotUrl.value)
})
</script>

<template>
  <div class="layout-inspector">
    <header class="toolbar">
      <button class="btn primary" @click="capture" :disabled="loading">{{ loading ? '抓取中…' : '⟳ 抓取' }}</button>
      <div v-if="displayInfo" class="display-info">
        <span>{{ (displayInfo.overrideSize ?? displayInfo.physicalSize)?.w }}×{{ (displayInfo.overrideSize ?? displayInfo.physicalSize)?.h }}</span>
        <span>{{ displayInfo.overrideDensity ?? displayInfo.physicalDensity }}dpi</span>
        <span v-if="displayInfo.refreshRate">{{ displayInfo.refreshRate }}Hz</span>
        <span v-if="displayInfo.overrideSize" class="tag">override</span>
      </div>
      <div class="presets">
        <button v-for="p in PRESETS" :key="p.label" class="preset-btn" @click="applyPreset(p)" :title="`${p.w}×${p.h} @ ${p.dpi}dpi`">{{ p.label }}</button>
        <button class="preset-btn reset" @click="resetDisplay">↩ Reset</button>
      </div>
      <div v-if="error" class="err">{{ error }}</div>
    </header>

    <div class="body">
      <!-- 左侧：节点树 -->
      <aside class="tree-panel">
        <div v-if="!flatNodes.length" class="hint">点击「抓取」获取 View 层级</div>
        <div
          v-for="(node, i) in flatNodes"
          :key="i"
          class="tree-row"
          :class="{ selected: node === selected }"
          :style="{ paddingLeft: `${node.depth * 16 + 8}px` }"
          @click="selectNode(node)"
        >
          <span
            class="toggle"
            :class="{ leaf: !node.children.length }"
            @click.stop="toggle(node)"
          >{{ node.children.length ? (expanded.has(node) ? '▾' : '▸') : ' ' }}</span>
          <span class="cls">{{ shortClass(node.class) }}</span>
          <span v-if="node.resourceId" class="rid">{{ node.resourceId.split('/').pop() }}</span>
          <span v-if="node.text" class="txt">"{{ node.text.slice(0, 30) }}"</span>
        </div>
      </aside>

      <!-- 右侧：截图 + 属性 -->
      <section class="preview-panel">
        <div class="screenshot-wrap" v-if="screenshotUrl">
          <img :src="screenshotUrl" class="screenshot" />
          <div v-if="boundsStyle" class="bounds-overlay" :style="boundsStyle" />
        </div>
        <div v-else class="hint center">等待抓取</div>

        <!-- 属性面板 -->
        <div v-if="selected" class="props">
          <div class="prop"><span>class</span><code>{{ selected.class }}</code></div>
          <div class="prop"><span>resource-id</span><code>{{ selected.resourceId || '—' }}</code></div>
          <div class="prop"><span>text</span><code>{{ selected.text || '—' }}</code></div>
          <div class="prop"><span>content-desc</span><code>{{ selected.contentDesc || '—' }}</code></div>
          <div class="prop"><span>bounds</span><code v-if="selected.bounds">[{{ selected.bounds.x }},{{ selected.bounds.y }}][{{ selected.bounds.x + selected.bounds.w }},{{ selected.bounds.y + selected.bounds.h }}] ({{ selected.bounds.w }}×{{ selected.bounds.h }})</code><code v-else>—</code></div>
          <div class="prop"><span>package</span><code>{{ selected.pkg || '—' }}</code></div>
          <div class="prop"><span>children</span><code>{{ selected.children.length }}</code></div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.layout-inspector { display: flex; flex-direction: column; height: 100%; background: var(--surface-1); color: var(--fg-1); }

.toolbar {
  display: flex; gap: 12px; align-items: center;
  padding: 8px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.btn { padding: 4px 12px; border: 1px solid rgba(255,255,255,0.08); background: var(--surface-3); color: var(--fg-1); border-radius: 5px; font-size: 12px; cursor: pointer; }
.btn:hover { background: var(--surface-4); }
.btn.primary { background: rgba(99,163,255,0.28); border-color: rgba(99,163,255,0.4); }
.btn.primary:hover { background: rgba(99,163,255,0.42); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.display-info { display: flex; gap: 10px; font-size: 11.5px; color: var(--fg-2); }
.display-info .tag { background: rgba(255,170,80,0.22); color: #ffc77a; padding: 1px 5px; border-radius: 3px; font-size: 9px; }
.err { color: #f87171; font-size: 11.5px; }

.presets { display: flex; gap: 4px; flex-wrap: wrap; margin-left: auto; }
.preset-btn {
  padding: 2px 8px; border: 1px solid rgba(255,255,255,0.08);
  background: var(--surface-3); color: var(--fg-2);
  border-radius: 4px; font-size: 10.5px; cursor: pointer;
}
.preset-btn:hover { background: var(--surface-4); color: var(--fg-1); }
.preset-btn.reset { border-color: rgba(255,170,80,0.3); color: #ffc77a; }

.body { flex: 1; display: flex; min-height: 0; }

.tree-panel {
  width: 420px; flex-shrink: 0;
  overflow: auto;
  background: var(--surface-2);
  border-right: 1px solid rgba(255,255,255,0.06);
  font-size: 11.5px;
  font-family: ui-monospace, 'SF Mono', monospace;
}
.hint { padding: 20px; color: var(--fg-3); text-align: center; }
.hint.center { display: flex; align-items: center; justify-content: center; height: 100%; }

.tree-row {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; cursor: pointer;
  white-space: nowrap;
}
.tree-row:hover { background: rgba(255,255,255,0.04); }
.tree-row.selected { background: rgba(99,163,255,0.22); }
.toggle { width: 12px; font-size: 10px; color: var(--fg-3); cursor: pointer; text-align: center; }
.toggle.leaf { cursor: default; }
.cls { color: var(--fg-1); font-weight: 500; }
.rid { color: #7dd3fc; margin-left: 4px; }
.txt { color: var(--fg-3); margin-left: 4px; font-style: italic; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }

.preview-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: auto; }

.screenshot-wrap {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  min-height: 0;
}
.screenshot {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.bounds-overlay {
  position: absolute;
  border: 2px solid #ff5f57;
  background: rgba(255, 95, 87, 0.12);
  pointer-events: none;
  border-radius: 2px;
}

.props {
  padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.06);
  display: grid;
  grid-template-columns: 100px 1fr;
  row-gap: 6px;
  font-size: 11.5px;
}
.prop { display: contents; }
.prop span { color: var(--fg-3); }
.prop code {
  font-family: ui-monospace, 'SF Mono', monospace;
  font-size: 11px; color: var(--fg-1);
  word-break: break-all;
  background: var(--surface-2);
  padding: 1px 6px; border-radius: 3px;
}
</style>
