import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

function requireDevice(ctx: { deviceId?: string }) {
  const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
  if (!d) throw new Error('未绑定设备')
  return d
}

export const layoutManifest: AppManifest = {
  id: 'layout',
  name: 'Layout',
  icon: '🔍',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 1100, height: 700, resizable: true, minWidth: 700, minHeight: 450 },
  tools: [
    {
      name: 'layout.dump',
      description: '获取当前屏幕的 View Hierarchy（uiautomator dump）。返回解析后的节点树（class/bounds/text/resource-id/content-desc）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = requireDevice(ctx)
        const xml = await d.system.viewHierarchy()
        return { xml }
      },
    },
    {
      name: 'layout.displayInfo',
      description: '获取屏幕信息：物理/覆盖分辨率、物理/覆盖密度、刷新率。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = requireDevice(ctx)
        return d.system.displayInfo()
      },
    },
    {
      name: 'layout.setSize',
      description: '设置屏幕分辨率覆盖（wm size WxH）。传 reset=true 恢复物理分辨率。',
      parameters: {
        type: 'object',
        properties: {
          width: { type: 'number' },
          height: { type: 'number' },
          reset: { type: 'boolean' },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        if (args.reset) {
          await d.shell.exec('wm size reset')
          return { ok: true, action: 'reset' }
        }
        if (!args.width || !args.height) throw new Error('需要 width + height 或 reset=true')
        await d.shell.exec(`wm size ${args.width}x${args.height}`)
        return { ok: true, size: `${args.width}x${args.height}` }
      },
    },
    {
      name: 'layout.setDensity',
      description: '设置屏幕密度覆盖（wm density N）。传 reset=true 恢复物理密度。',
      parameters: {
        type: 'object',
        properties: {
          dpi: { type: 'number' },
          reset: { type: 'boolean' },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        if (args.reset) {
          await d.shell.exec('wm density reset')
          return { ok: true, action: 'reset' }
        }
        if (!args.dpi) throw new Error('需要 dpi 或 reset=true')
        await d.shell.exec(`wm density ${args.dpi}`)
        return { ok: true, dpi: args.dpi }
      },
    },
  ],
}
