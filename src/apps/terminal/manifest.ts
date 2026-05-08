import type { AppManifest } from '@/types'
import Window from './Window.vue'

export const terminalManifest: AppManifest = {
  id: 'terminal',
  name: 'Terminal',
  icon: '⌨',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 680, height: 420, resizable: true, minWidth: 400, minHeight: 220 },
  // shell.exec 已由 inspector 统一提供（系统工具聚合 app）。
  // terminal 是交互式 pty，不在 manifest 里暴露一次性 exec tool。
  // 对话时可通过 appController 的 `runCommand` / `newTab` / `sigint` 等事件驱动当前 UI。
  tools: [],
}
