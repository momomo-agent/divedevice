import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import { triggerDownload } from '@/services'
import Window from './Window.vue'

function requireDevice(ctx: { deviceId?: string }) {
  const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
  if (!d) throw new Error('未绑定设备')
  return d
}

export const finderManifest: AppManifest = {
  id: 'finder',
  name: 'Finder',
  icon: '📁',
  component: Window,
  requiresDevice: true,
  windowDefaults: {
    width: 880,
    height: 560,
    resizable: true,
    minWidth: 560,
    minHeight: 340,
  },
  tools: [
    {
      name: 'fs.ls',
      description: '列出 Android 设备上指定目录的文件。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '绝对路径，如 /sdcard' } },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const entries = await d.fs.ls(String(args.path))
        return entries.map((e) => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size, mtime: e.mtime, mode: e.mode }))
      },
    },
    {
      name: 'fs.stat',
      description: '查看单个文件或目录的元信息（大小 / mtime / 是否目录）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        return (await d.fs.stat(String(args.path))) ?? { error: 'not found' }
      },
    },
    {
      name: 'fs.readText',
      description: '读取文本文件内容（默认 UTF-8）。不适合读二进制文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string', description: 'utf-8 / gbk / latin1 …' },
          maxBytes: { type: 'number', description: '上限字节数（>上限会截断），默认 262144 (256KB)' },
        },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const limit = Number(args.maxBytes ?? 262144)
        const buf = await d.fs.read(String(args.path))
        const truncated = buf.length > limit
        const data = truncated ? buf.subarray(0, limit) : buf
        const text = new TextDecoder(String(args.encoding ?? 'utf-8')).decode(data)
        return { path: args.path, size: buf.length, truncated, text }
      },
    },
    {
      name: 'fs.writeText',
      description: '把文本写入设备上的文件（覆盖）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['path', 'text'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        await d.fs.write(String(args.path), String(args.text))
        return { ok: true }
      },
    },
    {
      name: 'fs.mkdir',
      description: '创建目录（mkdir -p）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean', description: '是否创建父目录，默认 true' },
        },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        await d.fs.mkdir(String(args.path), args.recursive !== false)
        return { ok: true }
      },
    },
    {
      name: 'fs.rm',
      description: '删除文件或目录（破坏性）。目录要传 recursive: true。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          recursive: { type: 'boolean' },
        },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        await d.fs.rm(String(args.path), !!args.recursive)
        return { ok: true }
      },
    },
    {
      name: 'fs.rename',
      description: '重命名或移动（相当于 mv）。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        await d.fs.rename(String(args.from), String(args.to))
        return { ok: true }
      },
    },
    {
      name: 'fs.copy',
      description: '复制文件或目录（相当于 cp -a）。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        await d.fs.copy(String(args.from), String(args.to))
        return { ok: true }
      },
    },
    {
      name: 'fs.download',
      description: '把设备上的文件 pull 下来，触发浏览器下载到本地。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          filename: { type: 'string', description: '保存为的文件名，留空则用设备路径末段' },
        },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const p = String(args.path)
        const data = await d.fs.read(p)
        const name = String(args.filename || p.split('/').pop() || 'download.bin')
        triggerDownload(name, data, 'application/octet-stream')
        return { ok: true, size: data.length, saveAs: name }
      },
    },
    {
      name: 'fs.diskUsage',
      description: '查某路径所在分区的磁盘用量（total / used / avail，字节）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '默认 /sdcard' } },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        return d.fs.diskUsage(String(args.path ?? '/sdcard'))
      },
    },
    {
      name: 'fs.dirSize',
      description: '递归统计目录总大小（字节）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const bytes = await d.fs.dirSize(String(args.path))
        return { path: args.path, bytes }
      },
    },
  ],
}
