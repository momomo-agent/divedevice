import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

export const finderManifest: AppManifest = {
  id: 'finder',
  name: 'Finder',
  icon: '📁',
  component: Window,
  requiresDevice: true,
  windowDefaults: {
    width: 620,
    height: 440,
    resizable: true,
    minWidth: 380,
    minHeight: 240,
  },
  tools: [
    {
      name: 'fs.ls',
      description: '列出 Android 设备上指定目录的文件。需要已连接的设备。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '绝对路径，如 /sdcard' },
        },
        required: ['path'],
      },
      async execute(args, ctx) {
        const device = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!device) throw new Error('未绑定设备')
        const entries = await device.fs.ls(String(args.path))
        return entries.map((e) => ({
          name: e.name,
          path: e.path,
          isDir: e.isDir,
          size: e.size,
        }))
      },
    },
  ],
}
