import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

export const packagesManifest: AppManifest = {
  id: 'packages',
  name: 'Packages',
  icon: '📦',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 920, height: 600, resizable: true, minWidth: 560, minHeight: 360 },
  tools: [
    {
      name: 'pkg.list',
      description: '列出 Android 设备上已安装的应用包名。可过滤第三方 / 系统。',
      parameters: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: ['all', 'thirdParty', 'system'],
            description: 'all 全部 / thirdParty 仅第三方 / system 仅系统',
          },
        },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const filter = (args.filter as string) ?? 'all'
        const opts = filter === 'thirdParty' ? { thirdParty: true }
          : filter === 'system' ? { system: true } : undefined
        return d.app.list(opts)
      },
    },
    {
      name: 'pkg.info',
      description: '查询单个应用的版本、安装时间、codePath、targetSdk 等元信息。',
      parameters: {
        type: 'object',
        properties: { pkg: { type: 'string', description: '包名，如 com.example.app' } },
        required: ['pkg'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const info = await d.app.info(String(args.pkg))
        return info ?? { error: 'package not found' }
      },
    },
    {
      name: 'pkg.launch',
      description: '启动应用（打开主 activity）。',
      parameters: {
        type: 'object',
        properties: { pkg: { type: 'string' } },
        required: ['pkg'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.app.launch(String(args.pkg))
        return { ok: true }
      },
    },
    {
      name: 'pkg.stop',
      description: 'force-stop 应用。',
      parameters: {
        type: 'object',
        properties: { pkg: { type: 'string' } },
        required: ['pkg'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.app.stop(String(args.pkg))
        return { ok: true }
      },
    },
    {
      name: 'pkg.clear',
      description: '清除应用的全部数据（pm clear）。破坏性操作。',
      parameters: {
        type: 'object',
        properties: { pkg: { type: 'string' } },
        required: ['pkg'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.app.clear(String(args.pkg))
        return { ok: true }
      },
    },
    {
      name: 'pkg.uninstall',
      description: '卸载应用（破坏性）。系统 app 无法卸载。',
      parameters: {
        type: 'object',
        properties: {
          pkg: { type: 'string' },
          keepData: { type: 'boolean', description: '保留数据目录（-k）' },
        },
        required: ['pkg'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.app.uninstall(String(args.pkg), !!args.keepData)
        return { ok: true }
      },
    },
  ],
}
