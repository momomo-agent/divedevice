import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import { triggerDownload } from '@/services'
import Window from './Window.vue'

const IMAGE_EXT = /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|3gp|avi|webm)$/i
const DEFAULT_ALBUM_ROOTS = [
  '/sdcard/DCIM',
  '/sdcard/Pictures',
  '/sdcard/Download',
  '/sdcard/Movies',
]

function requireDevice(ctx: { deviceId?: string }) {
  const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
  if (!d) throw new Error('未绑定设备')
  return d
}

function mimeFor(path: string): string {
  if (/\.jpg$|\.jpeg$/i.test(path)) return 'image/jpeg'
  if (/\.png$/i.test(path)) return 'image/png'
  if (/\.webp$/i.test(path)) return 'image/webp'
  if (/\.gif$/i.test(path)) return 'image/gif'
  if (/\.heic$|\.heif$/i.test(path)) return 'image/heic'
  if (/\.bmp$/i.test(path)) return 'image/bmp'
  if (/\.mp4$|\.m4v$/i.test(path)) return 'video/mp4'
  if (/\.mov$/i.test(path)) return 'video/quicktime'
  if (/\.webm$/i.test(path)) return 'video/webm'
  return 'application/octet-stream'
}

export const photosManifest: AppManifest = {
  id: 'photos',
  name: 'Photos',
  icon: '🖼',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 960, height: 640, resizable: true, minWidth: 520, minHeight: 360 },
  tools: [
    {
      name: 'photos.albums',
      description: '列出设备上的相册目录（DCIM/Camera、Pictures、Screenshots 等），附每个相册的照片数。',
      parameters: {
        type: 'object',
        properties: {
          roots: {
            type: 'array',
            items: { type: 'string' },
            description: '扫描的根目录，默认 /sdcard/DCIM、/sdcard/Pictures、/sdcard/Download、/sdcard/Movies',
          },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const roots = Array.isArray(args.roots) ? (args.roots as string[]) : DEFAULT_ALBUM_ROOTS
        const albums: Array<{ name: string; path: string; count: number }> = []
        for (const root of roots) {
          try {
            const st = await d.fs.stat(root)
            if (!st?.isDir) continue
            const entries = await d.fs.ls(root)
            // 根目录本身含图 → 一个"<name>"虚拟相册
            const topMedia = entries.filter((e) => !e.isDir && (IMAGE_EXT.test(e.name) || VIDEO_EXT.test(e.name)))
            if (topMedia.length) albums.push({ name: root.split('/').pop() || root, path: root, count: topMedia.length })
            // 子目录当独立相册
            for (const e of entries) {
              if (!e.isDir) continue
              try {
                const items = await d.fs.ls(e.path)
                const media = items.filter((it) => !it.isDir && (IMAGE_EXT.test(it.name) || VIDEO_EXT.test(it.name)))
                if (media.length) albums.push({ name: e.name, path: e.path, count: media.length })
              } catch { /* 跳过不可访问的 */ }
            }
          } catch { /* 跳过不存在的 root */ }
        }
        return { albums }
      },
    },
    {
      name: 'photos.list',
      description: '列出某相册目录里的照片/视频（按 mtime 倒序）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相册目录绝对路径' },
          limit: { type: 'number', description: '最多返回多少，默认 100' },
          includeVideos: { type: 'boolean', description: '是否包含视频，默认 true' },
        },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const entries = await d.fs.ls(String(args.path))
        const includeVideos = args.includeVideos !== false
        let media = entries.filter((e) => !e.isDir && (IMAGE_EXT.test(e.name) || (includeVideos && VIDEO_EXT.test(e.name))))
        media.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        const limit = Number(args.limit ?? 100)
        media = media.slice(0, limit)
        return {
          count: media.length,
          items: media.map((e) => ({
            name: e.name,
            path: e.path,
            size: e.size,
            mtime: e.mtime,
            kind: VIDEO_EXT.test(e.name) ? 'video' : 'image',
          })),
        }
      },
    },
    {
      name: 'photos.download',
      description: '把设备上某张照片/视频下载到本地（触发浏览器下载）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const p = String(args.path)
        const data = await d.fs.read(p)
        const name = p.split('/').pop() || 'photo'
        triggerDownload(name, data, mimeFor(p))
        return { ok: true, size: data.length, saveAs: name }
      },
    },
    {
      name: 'photos.delete',
      description: '删除设备上某张照片/视频（破坏性，不可恢复）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        await d.fs.rm(String(args.path), false)
        return { ok: true }
      },
    },
  ],
}
