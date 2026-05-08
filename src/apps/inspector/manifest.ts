import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

export const inspectorManifest: AppManifest = {
  id: 'inspector',
  name: 'Inspector',
  icon: '🔬',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 1000, height: 640, resizable: true, minWidth: 600, minHeight: 400 },
  tools: [
    {
      name: 'sys.topActivity',
      description: '查询当前前台 Activity（包名 + activity 名）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return (await d.system.topActivity()) ?? { error: 'no resumed activity' }
      },
    },
    {
      name: 'sys.tasks',
      description: '当前 recent task stack 列表。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.tasks()
      },
    },
    {
      name: 'sys.processes',
      description: '当前所有进程列表（pid/ppid/user/rss/vsz/name）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.processes()
      },
    },
    {
      name: 'sys.layers',
      description: 'SurfaceFlinger layer 数量 / 可见数 / 名称列表（调试 UI 分层用）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.layers()
      },
    },
    {
      name: 'sys.gfxinfo',
      description: 'dumpsys gfxinfo：帧率/jank/90th/99th 分位（可选包名）。',
      parameters: {
        type: 'object',
        properties: { pkg: { type: 'string', description: '目标包名，留空则全局' } },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const text = await d.system.gfxinfo(args.pkg ? String(args.pkg) : undefined)
        // 只摘关键指标回传，避免把几千行全灌给模型
        const lines = text.split('\n').filter((l) =>
          /Total frames|Janky|percentile|Number Missed|HISTOGRAM/.test(l))
        return lines.join('\n') || '(未抽到关键指标，可能应用未运行)'
      },
    },
    {
      name: 'sys.battery',
      description: '电量/充电状态/温度/电压/健康。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.battery()
      },
    },
    {
      name: 'sys.network',
      description: 'Wi-Fi SSID / 接口 IP 列表。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.network()
      },
    },
    {
      name: 'sys.cpuinfo',
      description: 'CPU load average + 核心数。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.cpuinfo()
      },
    },
    {
      name: 'sys.getprops',
      description: '查询 getprop。可选 prefix 过滤（如 ro.build）。',
      parameters: {
        type: 'object',
        properties: { prefix: { type: 'string' } },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const all = await d.system.getProps()
        const prefix = args.prefix ? String(args.prefix) : ''
        if (!prefix) return all
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith(prefix)) out[k] = v
        }
        return out
      },
    },
    {
      name: 'sys.setprop',
      description: 'setprop 写属性（部分属性需 root）。',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.system.setProp(String(args.key), String(args.value))
        return { ok: true }
      },
    },
  ],
}
