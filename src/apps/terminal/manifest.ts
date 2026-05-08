import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

export const terminalManifest: AppManifest = {
  id: 'terminal',
  name: 'Terminal',
  icon: '⌨',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 680, height: 420, resizable: true, minWidth: 400, minHeight: 220 },
  tools: [
    {
      name: 'shell.exec',
      description: '在 Android 设备上执行 shell 命令，返回 stdout/stderr/exitCode。',
      parameters: {
        type: 'object',
        properties: { cmd: { type: 'string', description: 'shell 命令' } },
        required: ['cmd'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.shell.exec(String(args.cmd))
      },
    },
  ],
}
