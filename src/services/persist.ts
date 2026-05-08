/**
 * 持久化 helper：通过 agentic 胶水层 → agentic-store。
 *
 * 不直接调 agentic-store.createStore，走 `new Agentic()` 的 save/load/has/keys/deleteKey。
 * 这样以后换 backend 或升级都由胶水层统一管，调用方不用动。
 *
 * Vendor 层加载顺序（UMD 自注册 global，靠 import 副作用触发）：
 *   1. agentic-store.js  → window.AgenticStore
 *   2. agentic.js        → window.Agentic；其内部 load('agentic-store') 会找到 window.AgenticStore
 */
import { ref, watch, type Ref } from 'vue'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — UMD 文件无 .d.ts
import '../vendor/agentic-store.js'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import '../vendor/agentic.js'

interface AgenticInstance {
  save: (key: string, value: unknown) => Promise<void>
  load: (key: string) => Promise<unknown>
  has: (key: string) => Promise<boolean>
  keys: () => Promise<string[]>
  deleteKey: (key: string) => Promise<void>
  dispose?: () => void
}

interface AgenticGlobal {
  Agentic: new (opts?: Record<string, unknown>) => AgenticInstance
  ai: AgenticInstance
}

declare global {
  // eslint-disable-next-line no-var
  var Agentic: AgenticGlobal | undefined
}

// 每个 namespace 一个独立的 Agentic 实例（共享同一个底层 agentic-store backend）
// 这样不同 namespace 的 key 互不冲突
const instances = new Map<string, AgenticInstance>()

function getAgentic(namespace: string): AgenticInstance {
  let inst = instances.get(namespace)
  if (!inst) {
    const G = globalThis.Agentic
    if (!G) throw new Error('[persist] agentic global not loaded')
    // store.name 是 agentic-store 的 namespace
    inst = new G.Agentic({ store: { name: namespace } })
    instances.set(namespace, inst)
  }
  return inst
}

/**
 * 绑定一个 reactive ref 到持久化 store。
 *
 * - 首次从 store 读，没有就用 fallback
 * - ref 变化 debounce 80ms 写回
 * - store 不可用时依然返回可用 ref（只是不持久）
 *
 * ```ts
 * const { state: chatPos, ready } = usePersistedState('shell', 'chatPos', 'right')
 * ```
 */
export function usePersistedState<T>(
  namespace: string,
  key: string,
  fallback: T,
  opts: { debounceMs?: number } = {},
): { state: Ref<T>; ready: Ref<boolean>; reset: () => void } {
  const state = ref(fallback) as Ref<T>
  const ready = ref(false)
  const debounceMs = opts.debounceMs ?? 80

  let timer: number | null = null
  let suppressNextWrite = false

  ;(async () => {
    try {
      const ai = getAgentic(namespace)
      const saved = await ai.load(key)
      if (saved !== undefined && saved !== null) {
        suppressNextWrite = true
        state.value = saved as T
      }
    } catch (err) {
      console.warn('[persist]', namespace, key, 'load failed', err)
    }
    ready.value = true
  })()

  watch(state, (v) => {
    if (!ready.value) return
    if (suppressNextWrite) { suppressNextWrite = false; return }
    if (timer) clearTimeout(timer)
    timer = window.setTimeout(async () => {
      try {
        const ai = getAgentic(namespace)
        await ai.save(key, v as unknown)
      } catch (err) {
        console.warn('[persist]', namespace, key, 'save failed', err)
      }
    }, debounceMs)
  }, { deep: true })

  function reset() {
    state.value = fallback
    try { getAgentic(namespace).deleteKey(key).catch(() => {}) } catch {}
  }

  return { state, ready, reset }
}
