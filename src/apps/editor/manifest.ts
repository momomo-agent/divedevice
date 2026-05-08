import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import { windowManager, eventBus } from '@/services'
import Window from './Window.vue'

export const editorManifest: AppManifest = {
  id: 'editor',
  name: 'Editor',
  icon: '✍',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 780, height: 520, resizable: true, minWidth: 420, minHeight: 260 },
  tools: [
    {
      name: 'editor.open',
      description: '在 Editor 中打开设备上指定路径的文件。如果没有 Editor 窗口会自动打开一个。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async execute(args, ctx) {
        const path = String(args.path)
        const deviceId = ctx.deviceId
        if (!deviceId) throw new Error('未绑定设备')
        // 确认文件存在
        const d = getDevice(deviceId)
        if (!d) throw new Error('设备不可用')
        const stat = await d.fs.stat(path)
        if (!stat || stat.isDir) throw new Error(`不是文件: ${path}`)
        // 找已有 editor 窗口
        const existing = windowManager.windows.find(
          (w) => w.appId === 'editor' && w.deviceId === deviceId,
        )
        if (existing) {
          windowManager.focus(existing.id)
        } else {
          windowManager.open({
            appId: 'editor',
            deviceId,
            props: { openPath: path },
          })
          return { opened: true, path }
        }
        // 已有窗口 → 通过 eventbus 让窗口内 openFile
        eventBus.emit('finder.openFile', { deviceId, path })
        return { opened: true, path }
      },
    },
  ],
}
