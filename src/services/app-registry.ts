/**
 * App Registry —— 统一注册中心
 * 支持静态注册（启动）+ 运行时动态注册（未来插件）。
 */
import type { AppManifest } from '@/types'
import { toolbus } from './toolbus'

class AppRegistry {
  private apps = new Map<string, AppManifest>()
  private listeners = new Set<() => void>()

  register(manifest: AppManifest): void {
    if (this.apps.has(manifest.id)) {
      throw new Error(`App id conflict: ${manifest.id}`)
    }
    this.apps.set(manifest.id, manifest)

    // app 声明的 tools 自动汇入 toolbus
    if (manifest.tools?.length) {
      for (const tool of manifest.tools) {
        toolbus.register(tool, manifest.id)
      }
    }

    this.emit()
  }

  unregister(id: string): void {
    const m = this.apps.get(id)
    if (!m) return
    this.apps.delete(id)
    if (m.tools?.length) {
      for (const tool of m.tools) toolbus.unregister(tool.name)
    }
    this.emit()
  }

  get(id: string): AppManifest | undefined {
    return this.apps.get(id)
  }

  list(): AppManifest[] {
    return [...this.apps.values()]
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

export const appRegistry = new AppRegistry()
