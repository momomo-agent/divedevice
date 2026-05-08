/**
 * agentic-store Vue 适配层
 * - 把 UMD 的 AgenticStore.createStore 包装成 ES 模块
 * - 提供 `usePersistedState()` 让 Vue 组件一行代码绑定一个持久化 ref
 *
 * sql.js WASM 在首次调用时异步初始化（写入 IndexedDB）；失败会 fallback 到 localStorage 再到内存。
 */
import { ref, watch, type Ref } from 'vue'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — UMD 文件没 d.ts
import '../vendor/agentic-store.js'

type Store = {
  get: (k: string) => Promise<unknown>
  set: (k: string, v: unknown) => Promise<void>
  delete: (k: string) => Promise<void>
  keys: () => Promise<string[]>
  clear: () => Promise<void>
  has: (k: string) => Promise<boolean>
  flush?: () => Promise<void>
  close?: () => Promise<void>
  backend: string
}

declare global {
  // eslint-disable-next-line no-var
  var AgenticStore: {
    createStore: (name: string, opts?: { backend?: string }) => Promise<Store>
  }
}

const stores = new Map<string, Promise<Store>>()

/**
 * 获取一个命名的 store。相同 namespace 共享同一个 Promise。
 * 浏览器里是 IndexedDB-backed SQLite WASM，fallback 到 localStorage/内存。
 */
export function getStore(namespace: string): Promise<Store> {
  let p = stores.get(namespace)
  if (!p) {
    p = globalThis.AgenticStore.createStore(namespace)
    stores.set(namespace, p)
  }
  return p
}

/**
 * 绑定一个 reactive ref 到持久化 store。
 *
 * - 首次从 store 读，如果没有就用 fallback
 * - 每次 ref 变就 debounce 写回
 * - 返回 { state, ready, reset }
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

  getStore(namespace).then(async (store) => {
    try {
      const saved = await store.get(key)
      if (saved !== undefined && saved !== null) {
        suppressNextWrite = true // 水合时不写回
        state.value = saved as T
      }
    } catch (err) {
      console.warn('[persist]', namespace, key, 'load failed', err)
    }
    ready.value = true
  })

  watch(state, (v) => {
    if (!ready.value) return
    if (suppressNextWrite) { suppressNextWrite = false; return }
    if (timer) clearTimeout(timer)
    timer = window.setTimeout(async () => {
      try {
        const store = await getStore(namespace)
        await store.set(key, v as unknown)
      } catch (err) {
        console.warn('[persist]', namespace, key, 'save failed', err)
      }
    }, debounceMs)
  }, { deep: true })

  function reset() {
    state.value = fallback
    getStore(namespace).then((s) => s.delete(key)).catch(() => {})
  }

  return { state, ready, reset }
}
