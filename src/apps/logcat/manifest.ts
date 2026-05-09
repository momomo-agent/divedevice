import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

function requireDevice(ctx: { deviceId?: string }) {
  const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
  if (!d) throw new Error('未绑定设备')
  return d
}

export const logcatManifest: AppManifest = {
  id: 'logcat',
  name: 'Logcat',
  icon: '🪵',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 720, height: 420, resizable: true, minWidth: 420, minHeight: 240 },
  tools: [
    {
      name: 'log.tail',
      description: 'Android logcat 最近 N 行（不常驻）。支持 tag 过滤（如 "ActivityManager:I *:S" 只看 ActivityManager 的 info+）。',
      parameters: {
        type: 'object',
        properties: {
          lines: { type: 'number', description: '最近多少行，默认 200，上限 5000' },
          filters: {
            type: 'array',
            items: { type: 'string' },
            description: 'logcat filter spec，例如 ["ActivityManager:I", "*:S"]',
          },
          pid: { type: 'number', description: '只看某个 pid' },
          buffer: {
            type: 'string',
            enum: ['main', 'system', 'crash', 'events', 'radio', 'all'],
            description: '日志 buffer，默认 main',
          },
          format: { type: 'string', description: 'brief/process/tag/thread/time/threadtime/long' },
          grep: { type: 'string', description: '拉回后本地 substring 过滤' },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const lines = Math.min(Math.max(Number(args.lines ?? 200), 1), 5000)
        const raw = await d.log.tail({
          filters: Array.isArray(args.filters) ? args.filters as string[] : undefined,
          pid: args.pid != null ? Number(args.pid) : undefined,
          buffer: args.buffer ? String(args.buffer) : undefined,
          format: args.format ? String(args.format) : undefined,
          lines,
        })
        const grep = args.grep ? String(args.grep) : ''
        const out = grep
          ? raw.split('\n').filter((l) => l.includes(grep)).join('\n')
          : raw
        return { path: 'logcat', lines: out.split('\n').length, text: out }
      },
    },
    {
      name: 'log.clear',
      description: '清空 logcat buffer（相当于 logcat -c）。破坏性（历史日志会丢）。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = requireDevice(ctx)
        await d.log.clear()
        return { ok: true }
      },
    },
    {
      name: 'log.bufferSize',
      description: '查询或设置 logcat ring buffer 大小（KB）。不传 kb 为查询。',
      parameters: {
        type: 'object',
        properties: { kb: { type: 'number', description: '设置为多少 KB，比如 4096' } },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const info = await d.log.bufferSize(args.kb != null ? Number(args.kb) : undefined)
        return { info }
      },
    },
    {
      name: 'log.crashes',
      description: 'crash buffer 最近 N 行（ANR / native crash / tombstone 引用等）。',
      parameters: {
        type: 'object',
        properties: { lines: { type: 'number', description: '默认 200' } },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const lines = Math.min(Math.max(Number(args.lines ?? 200), 1), 5000)
        const text = await d.log.tail({ buffer: 'crash', lines })
        return { text, lines: text.split('\n').length }
      },
    },
  ],
}
