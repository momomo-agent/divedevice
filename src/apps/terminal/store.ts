/**
 * Terminal 本地状态：命令历史 + snippets 库。
 * 存 localStorage，跨 session/window/device 共享。
 */
import { reactive, watch } from 'vue'

const HIST_KEY = 'divedevice.terminal.history'
const SNIP_KEY = 'divedevice.terminal.snippets'
const HIST_MAX = 200

export interface Snippet {
  id: string
  label: string
  cmd: string
  /** 置顶 */
  pinned?: boolean
  /** 最近使用次数，用于排序 */
  uses?: number
}

interface TerminalStore {
  history: string[]                 // 最近命令（去重、最新在末尾）
  snippets: Snippet[]
}

const defaultSnippets: Snippet[] = [
  { id: 'ls-sdcard',  label: 'ls /sdcard',         cmd: 'ls -lah /sdcard',                 pinned: true },
  { id: 'dmesg-tail', label: 'dmesg tail',         cmd: 'dmesg | tail -n 40',              pinned: true },
  { id: 'pm-3rd',     label: 'pm list 三方 app',   cmd: 'pm list packages -3',             pinned: true },
  { id: 'top-activity', label: 'top activity',     cmd: 'dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -n 3' },
  { id: 'battery',    label: 'battery',            cmd: 'dumpsys battery' },
  { id: 'df',         label: 'df -h',              cmd: 'df -h' },
  { id: 'free',       label: 'free -m',            cmd: 'free -m' },
  { id: 'ifconfig',   label: 'ip addr',            cmd: 'ip -o addr' },
  { id: 'top',        label: 'top -n 1',           cmd: 'top -n 1 -b | head -n 25' },
  { id: 'getprop-brand', label: '机型',            cmd: 'getprop ro.product.model && getprop ro.product.brand' },
  { id: 'wm-size',    label: 'wm size',            cmd: 'wm size && wm density' },
  { id: 'screencap',  label: 'screencap → base64', cmd: 'screencap -p | base64 | head -c 100' },
  { id: 'services',   label: 'service list',       cmd: 'service list | head -n 30' },
  { id: 'sysroot',    label: 'ls /system',         cmd: 'ls /system' },
]

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const terminalStore = reactive<TerminalStore>({
  history: load<string[]>(HIST_KEY, []),
  snippets: load<Snippet[]>(SNIP_KEY, defaultSnippets),
})

watch(
  () => terminalStore.history,
  (v) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(v)) } catch {} },
  { deep: true },
)
watch(
  () => terminalStore.snippets,
  (v) => { try { localStorage.setItem(SNIP_KEY, JSON.stringify(v)) } catch {} },
  { deep: true },
)

/** 追加一条历史命令，自动去重（如果和最后一条相同则跳过），并截断到最大条数 */
export function recordCommand(cmd: string) {
  const t = cmd.trim()
  if (!t) return
  const h = terminalStore.history
  if (h.length && h[h.length - 1] === t) return
  h.push(t)
  if (h.length > HIST_MAX) h.splice(0, h.length - HIST_MAX)
}

export function bumpSnippet(id: string) {
  const s = terminalStore.snippets.find((x) => x.id === id)
  if (s) s.uses = (s.uses ?? 0) + 1
}

export function addSnippet(label: string, cmd: string): Snippet {
  const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const snip: Snippet = { id, label: label || cmd.slice(0, 32), cmd }
  terminalStore.snippets.unshift(snip)
  return snip
}

export function removeSnippet(id: string) {
  const i = terminalStore.snippets.findIndex((x) => x.id === id)
  if (i >= 0) terminalStore.snippets.splice(i, 1)
}

export function togglePin(id: string) {
  const s = terminalStore.snippets.find((x) => x.id === id)
  if (s) s.pinned = !s.pinned
}
