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
      description: 'SurfaceFlinger 全局 layer 概览（总数/可见数/名称列表）。大多数场景应优先用 sys.appLayers 看某个 app 的 layer。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.layers()
      },
    },
    {
      name: 'sys.appLayers',
      description: '某个 app（默认前台）在 SurfaceFlinger 中的 layer：包含所有属于该 pkg 的 layer 与其可见性。常用于 “当前应用有多少个 layer” 这种问题。',
      parameters: {
        type: 'object',
        properties: { pkg: { type: 'string', description: '目标包名；留空自动取前台包' } },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.layersForPackage(args.pkg ? String(args.pkg) : undefined)
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

    // ========== 新增：覆盖 adb 完整能力 ==========

    {
      name: 'shell.exec',
      description: '运行任意 shell 命令并返回 stdout/stderr/exitCode。备用逗号——先找专用 tool。',
      parameters: {
        type: 'object',
        properties: { cmd: { type: 'string' } },
        required: ['cmd'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.shell.exec(String(args.cmd))
      },
    },
    {
      name: 'sys.summary',
      description: '设备总览：型号/品牌/厂商/SN/SDK/Android 版本/ABI/分辨率/密度/启动时长。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.summary()
      },
    },
    {
      name: 'sys.dumpsys',
      description: 'dumpsys <service>（+ 可选 args）原文。',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
        },
        required: ['service'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.dumpsys(String(args.service), (args.args as string[]) ?? [])
      },
    },
    {
      name: 'sys.services',
      description: '已注册的 binder service 列表。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.system.services()
      },
    },
    {
      name: 'am.start',
      description: '用 intent 启动 Activity 。extras 接受 { key: stringNumberBoolean } 或 { key: { type, value } }。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          data: { type: 'string' },
          mime: { type: 'string' },
          component: { type: 'string', description: 'pkg/FullActivity' },
          pkg: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          flags: { type: 'number' },
          extras: { type: 'object' },
          wait: { type: 'boolean' },
          user: { type: 'number' },
        },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const { wait, user, ...intent } = args as Record<string, unknown>
        return d.am.start(intent as Parameters<typeof d.am.start>[0], {
          waitForLaunch: Boolean(wait),
          user: user as number | undefined,
        })
      },
    },
    {
      name: 'am.broadcast',
      description: '发送 broadcast intent 。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          data: { type: 'string' },
          mime: { type: 'string' },
          component: { type: 'string' },
          pkg: { type: 'string' },
          categories: { type: 'array', items: { type: 'string' } },
          extras: { type: 'object' },
        },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.am.broadcast(args as Parameters<typeof d.am.broadcast>[0])
      },
    },
    {
      name: 'am.forceStop',
      description: 'am force-stop，手动杀掉前台/后台包。',
      parameters: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.am.forceStop(String(args.pkg))
        return { ok: true }
      },
    },
    {
      name: 'app.list',
      description: 'pm list packages：传 thirdParty=true 只要三方 app。',
      parameters: {
        type: 'object',
        properties: { thirdParty: { type: 'boolean' }, system: { type: 'boolean' }, user: { type: 'number' } },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.app.list(args as Parameters<typeof d.app.list>[0])
      },
    },
    {
      name: 'app.info',
      description: '某包的 version / installer / system 与否 / 权限概览 等元信息。',
      parameters: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.app.info(String(args.pkg))
      },
    },
    {
      name: 'app.components',
      description: '某包的 activities/services/receivers/providers。',
      parameters: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.app.components(String(args.pkg))
      },
    },
    {
      name: 'app.permissions',
      description: '某包当前授权状态。',
      parameters: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.app.permissions(String(args.pkg))
      },
    },
    {
      name: 'app.launch',
      description: '启动某包的主 Activity。',
      parameters: { type: 'object', properties: { pkg: { type: 'string' } }, required: ['pkg'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.app.launch(String(args.pkg))
        return { ok: true }
      },
    },
    // input.tap / input.swipe / input.key 由 Screencast 提供（投屏交互是他的本职）。
    // Inspector 只保留 input.text（输入文本，与投屏无关，排故时常用）。
    {
      name: 'input.text',
      description: 'adb shell input text 。',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.text(String(args.text))
        return { ok: true }
      },
    },
    {
      name: 'settings.get',
      description: 'settings get <system|secure|global> <key>。',
      parameters: {
        type: 'object',
        properties: {
          ns: { type: 'string', enum: ['system', 'secure', 'global'] },
          key: { type: 'string' },
        },
        required: ['ns', 'key'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.settings.get(args.ns as 'system' | 'secure' | 'global', String(args.key))
      },
    },
    {
      name: 'settings.put',
      description: 'settings put <system|secure|global> <key> <value>。',
      parameters: {
        type: 'object',
        properties: {
          ns: { type: 'string', enum: ['system', 'secure', 'global'] },
          key: { type: 'string' }, value: { type: 'string' },
        },
        required: ['ns', 'key', 'value'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.settings.put(args.ns as 'system' | 'secure' | 'global', String(args.key), String(args.value))
        return { ok: true }
      },
    },
    {
      name: 'svc.wifi',
      description: '开关 WiFi。',
      parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.svc.wifi(Boolean(args.on))
        return { ok: true }
      },
    },
    {
      name: 'svc.data',
      description: '开关移动网络流量。',
      parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.svc.data(Boolean(args.on))
        return { ok: true }
      },
    },
    {
      name: 'svc.bluetooth',
      description: '开关蓝牙。',
      parameters: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.svc.bluetooth(Boolean(args.on))
        return { ok: true }
      },
    },
    {
      name: 'wm.size',
      description: '读当前屏幕物理/覆盖分辨率。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.wm.size()
      },
    },
    {
      name: 'wm.density',
      description: '读当前屏幕密度。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.wm.density()
      },
    },
    {
      name: 'power.wake',
      description: '唪醒屏幕。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.power.wake()
        return { ok: true }
      },
    },
    {
      name: 'power.lock',
      description: '锁屏。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.power.lock()
        return { ok: true }
      },
    },
    {
      name: 'power.isInteractive',
      description: '屏幕是否交流中（亮）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.power.isInteractive()
      },
    },
    {
      name: 'log.tail',
      description: 'logcat -d（一次性 dump）取最后 N 行，支持 pid / filter / buffer 过滤。',
      parameters: {
        type: 'object',
        properties: {
          lines: { type: 'number' },
          pid: { type: 'number' },
          buffer: { type: 'string', enum: ['main', 'system', 'crash', 'events', 'radio', 'all'] },
          filters: { type: 'array', items: { type: 'string' } },
          format: { type: 'string' },
        },
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.log.tail(args as Parameters<typeof d.log.tail>[0])
      },
    },
    {
      name: 'net.interfaces',
      description: '网络接口列表（ip/mac/mtu/up）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.net.interfaces()
      },
    },
    {
      name: 'net.ping',
      description: '从设备 ping 某个 host。',
      parameters: {
        type: 'object',
        properties: { host: { type: 'string' }, count: { type: 'number' } },
        required: ['host'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.net.ping(String(args.host), args.count ? Number(args.count) : undefined)
      },
    },
    {
      name: 'media.volume',
      description: '音量控制：up / down / mute 或指定 stream 和值。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['up', 'down', 'mute', 'play', 'pause', 'next', 'prev', 'set'] },
          stream: { type: 'string', enum: ['ring', 'music', 'alarm', 'voice_call', 'notification', 'system'] },
          value: { type: 'number' },
        },
        required: ['action'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const a = String(args.action)
        switch (a) {
          case 'up': await d.media.volumeUp(); break
          case 'down': await d.media.volumeDown(); break
          case 'mute': await d.media.mute(); break
          case 'play': await d.media.play(); break
          case 'pause': await d.media.pause(); break
          case 'next': await d.media.next(); break
          case 'prev': await d.media.prev(); break
          case 'set': {
            if (!args.stream || args.value === undefined) throw new Error('set 需要 stream + value')
            await d.media.setMediaVolume(
              args.stream as 'ring' | 'music' | 'alarm' | 'voice_call' | 'notification' | 'system',
              Number(args.value),
            )
            break
          }
          default: throw new Error(`unknown action: ${a}`)
        }
        return { ok: true }
      },
    },
    {
      name: 'pm.features',
      description: 'pm list features。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.pm.features()
      },
    },
    {
      name: 'pm.users',
      description: 'pm list users。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        return d.pm.users()
      },
    },
  ],
}
