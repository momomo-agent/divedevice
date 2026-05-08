/**
 * App Controllers —— 每个 app 的 Window 组件在 mount 时注册自己的控制接口：
 *   - send(event, payload)  让外部（desktop.send tool）触发应用内动作
 *   - getState()            暴露窗口内部当前状态（Editor 当前 tab / Inspector 当前 panel / Finder 路径 …）
 *
 * 用 windowId 作 key，窗口 close 时解注册。
 *
 * 这层存在的理由：
 * - eventbus 是强类型（EventMap 硬编码），不适合 app 内私有事件
 * - manifest 只描述"如何启动"，运行时交互要另一套
 * - Controller 生命周期 = window 生命周期，内存安全
 */

export interface AppController {
  windowId: string
  appId: string
  /** 被动接收外部指令（desktop.send 调用） */
  send?: (event: string, payload?: unknown) => unknown | Promise<unknown>
  /** 暴露窗口内部状态（desktop.snapshot 调用） */
  getState?: () => unknown
  /** 自描述：该 app 接受哪些 event（文档用，列到 snapshot/system prompt 让模型知道能做什么）*/
  describe?: () => { events: Array<{ name: string; description: string }> }
}

class AppControllerRegistry {
  private byWindow = new Map<string, AppController>()

  register(c: AppController): () => void {
    this.byWindow.set(c.windowId, c)
    return () => this.byWindow.delete(c.windowId)
  }

  unregister(windowId: string) {
    this.byWindow.delete(windowId)
  }

  get(windowId: string): AppController | undefined {
    return this.byWindow.get(windowId)
  }

  listByApp(appId: string): AppController[] {
    const out: AppController[] = []
    for (const c of this.byWindow.values()) if (c.appId === appId) out.push(c)
    return out
  }

  all(): AppController[] {
    return [...this.byWindow.values()]
  }
}

export const appControllers = new AppControllerRegistry()
