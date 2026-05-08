/**
 * useComposingLock — 中文/日文/韩文 IME 输入法保护
 *
 * 问题：textarea/input 在 IME 候选拼字阶段按 Enter 是"上屏"，
 * 但 @keydown.enter 会照样触发，导致消息提前发送。
 * 其他键（方向键、空格、数字）在候选框里也是候选操作，不应被应用层捕获。
 *
 * 用法：
 *   const { composing, onCompositionStart, onCompositionEnd } = useComposingLock()
 *   <textarea
 *     @compositionstart="onCompositionStart"
 *     @compositionend="onCompositionEnd"
 *     @keydown.enter.exact.prevent="composing ? null : onSend()"
 *   />
 *
 * 或用辅助：
 *   <textarea v-bind="composingBindings" @keydown.enter.exact.prevent="handle($event)" />
 *   function handle(e) { if (composing.value) return; onSend() }
 *
 * 也可以 guard(fn) 包一层：
 *   const safeSend = guard(onSend)  // IME 中调用直接 no-op
 */
import { ref, computed } from 'vue'

export function useComposingLock() {
  const composing = ref(false)

  function onCompositionStart() {
    composing.value = true
  }

  function onCompositionEnd(e?: CompositionEvent) {
    // Chrome 上 compositionend 之后 keydown 偶发先到，微延迟让 keydown 先读到 composing=true
    // 用微任务足够（nextTick / queueMicrotask）
    // 注：Vue v-model 本身已在 compositionend 后同步模型
    queueMicrotask(() => { composing.value = false })
    void e
  }

  // 给 <input/textarea> 直接展开绑定
  const composingBindings = computed(() => ({
    onCompositionstart: onCompositionStart,
    onCompositionend: onCompositionEnd,
  }))

  /** 包一层，IME 中直接 no-op；其他时候照常跑 */
  function guard<T extends (...args: any[]) => any>(fn: T) {
    return ((...args: Parameters<T>) => {
      if (composing.value) return undefined
      return fn(...args)
    }) as T
  }

  /** 事件守卫：IME 中阻止默认行为再返回，非 IME 继续 */
  function blockIfComposing(e: KeyboardEvent): boolean {
    if (!composing.value) return false
    // 有些浏览器 IME keydown 的 key === 'Process' / keyCode === 229，IME 中所有按键都吞掉默认
    e.stopPropagation()
    return true
  }

  return {
    composing,
    onCompositionStart,
    onCompositionEnd,
    composingBindings,
    guard,
    blockIfComposing,
  }
}

/**
 * 判断一个 KeyboardEvent 是否属于 IME composition。
 * 浏览器统一约定 keyCode 229 = IME 处理中，key === 'Process' 也是。
 * e.isComposing 最权威（所有现代浏览器都有）。
 */
export function isImeKeydown(e: KeyboardEvent): boolean {
  return (
    e.isComposing === true ||
    e.keyCode === 229 ||
    e.which === 229 ||
    e.key === 'Process'
  )
}
