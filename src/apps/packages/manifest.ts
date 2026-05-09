import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'
import { triggerDownload, buildStoreZip } from './apk-export'

export const packagesManifest: AppManifest = {
  id: 'packages',
  name: 'Packages',
  icon: '📦',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 920, height: 600, resizable: true, minWidth: 560, minHeight: 360 },
  tools: [
    {
      name: 'pkg.install',
      description: '安装 APK 到设备。支持从设备路径安装（已 push 到设备的 apk）或从本地文件安装（通过 base64）。默认 -r 覆盖安装 + -g 授权。',
      parameters: {
        type: 'object',
        properties: {
          devicePath: { type: 'string', description: '设备上已有的 APK 路径（优先）' },
          replace: { type: 'boolean', description: '覆盖安装，默认 true' },
          downgrade: { type: 'boolean', description: '允许降级' },
          grantAll: { type: 'boolean', description: '授予全部权限，默认 true' },
        },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const opts = {
          replace: args.replace !== false,
          downgrade: !!args.downgrade,
          grantAll: args.grantAll !== false,
        }
        if (args.devicePath) {
          await d.app.install({ devicePath: String(args.devicePath) }, opts)
          return { ok: true, source: 'device', path: args.devicePath }
        }
        throw new Error('请提供 devicePath（设备上的 APK 路径）')
      },
    },
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
      name: 'pkg.export',
      description: '从设备导出指定包的 APK 到浏览器下载目录。默认只导 base.apk；includeSplits=true 时会打包所有 split APK 为 zip。',
      parameters: {
        type: 'object',
        properties: {
          pkg: { type: 'string' },
          includeSplits: { type: 'boolean', description: '同时导出 split APKs，打包为 zip' },
        },
        required: ['pkg'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const pkg = String(args.pkg)
        const includeSplits = !!args.includeSplits
        const apks = await d.app.exportApk(pkg, { includeSplits })
        if (apks.length === 1) {
          triggerDownload(`${pkg}.apk`, apks[0].data, 'application/vnd.android.package-archive')
          return { ok: true, files: [{ name: apks[0].name, size: apks[0].data.length }] }
        }
        const zipped = buildStoreZip(apks.map(a => ({ name: a.name, data: a.data })))
        triggerDownload(`${pkg}.apks.zip`, zipped, 'application/zip')
        return { ok: true, files: apks.map(a => ({ name: a.name, size: a.data.length })) }
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
