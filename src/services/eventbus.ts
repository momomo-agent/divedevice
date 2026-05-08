/**
 * 类型安全的 EventBus（app 间 pub/sub）
 */
import type { EventMap } from '@/types'

type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void

class EventBus {
  private listeners: { [K in keyof EventMap]?: Set<Listener<K>> } = {}

  on<K extends keyof EventMap>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners[event] as Set<Listener<K>> | undefined
    if (!set) {
      set = new Set()
      this.listeners[event] = set as EventBus['listeners'][K]
    }
    set.add(fn)
    return () => set!.delete(fn)
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = this.listeners[event] as Set<Listener<K>> | undefined
    if (!set) return
    for (const fn of set) {
      try { fn(payload) } catch (err) { console.error('[eventbus]', err) }
    }
  }
}

export const eventBus = new EventBus()
