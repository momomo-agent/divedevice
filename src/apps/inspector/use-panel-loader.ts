import { inject, onMounted, ref, watch, type Ref } from 'vue'

/**
 * Inspector panel 共享的数据加载 helper。
 *
 * - 首次挂载时自动 load（等价于原来的 onMounted 调用）
 * - 当父 Window 发出 refreshTick（手动按 ⟳ 或 auto-refresh）时重新 load
 * - 组件 **不卸载**，所以 panel 内部所有 ref / input / scroll 位置全部保留
 *
 * ```ts
 * const { data, loading, error, reload } = usePanelLoader(async () => {
 *   return await props.device!.system.layers()
 * }, () => props.device)
 * ```
 *
 * 第二个参数是 "依赖"：当它变化时也会触发 reload（比如 device 换了）。
 * 可以传 getter 函数，内部 watch 会自动跟踪。
 */
export function usePanelLoader<T>(
  fetcher: () => Promise<T>,
  depGetter?: () => unknown,
): {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload: () => Promise<void>
} {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(true)
  const error = ref<string | null>(null)
  const tick = inject<Ref<number>>('inspector:refreshTick')

  let runId = 0
  async function reload() {
    const my = ++runId
    loading.value = true
    error.value = null
    try {
      const res = await fetcher()
      if (my !== runId) return // 被更新的请求 superseded
      data.value = res
    } catch (err) {
      if (my !== runId) return
      error.value = (err as Error).message
    } finally {
      if (my === runId) loading.value = false
    }
  }

  onMounted(reload)
  if (tick) watch(tick, reload)
  if (depGetter) watch(depGetter, reload)

  return { data, loading, error, reload }
}
