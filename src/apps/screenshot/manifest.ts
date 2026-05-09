import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import { triggerDownload, bytesToBase64 } from '@/services'
import Window from './Window.vue'

function requireDevice(ctx: { deviceId?: string }) {
  const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
  if (!d) throw new Error('未绑定设备')
  return d
}

async function saveToDevicePath(d: ReturnType<typeof requireDevice>, png: Uint8Array, path: string) {
  await d.fs.write(path, png)
}

export const screenshotManifest: AppManifest = {
  id: 'screenshot',
  name: 'Screenshot',
  icon: '📸',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 420, height: 600, resizable: true, minWidth: 280, minHeight: 360 },
  tools: [
    {
      name: 'screenshot.capture',
      description: '截取设备当前画面。默认既让模型在下一步能看到图（vision attachment），也向聊天里推一个缩略图。可选把 PNG 写到设备上或下载到本地。',
      parameters: {
        type: 'object',
        properties: {
          saveToDevice: { type: 'string', description: '同时把 PNG 写到设备上的该路径（例如 /sdcard/DCIM/Screenshots/shot-001.png）' },
          download: { type: 'boolean', description: '是否触发本地下载，默认 false' },
          filename: { type: 'string', description: '本地下载文件名，默认 screenshot-<ts>.png' },
          attachToModel: { type: 'boolean', description: '是否把截图作为 vision attachment 给模型，默认 true' },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const png = await d.screen.capture()

        // 设备端存档
        if (args.saveToDevice) await saveToDevicePath(d, png, String(args.saveToDevice))

        // 本地下载
        if (args.download) {
          const name = String(args.filename || `screenshot-${Date.now()}.png`)
          triggerDownload(name, png, 'image/png')
        }

        // chat 预览 + 模型附件（默认开）
        const b64 = bytesToBase64(png)
        const attach = args.attachToModel !== false
        if (attach) {
          try {
            const mod = await import('@/services/chat')
            mod.chat.push('assistant', '[screen capture]', {
              images: [{ preview: `data:image/png;base64,${b64}`, media_type: 'image/png' }],
            })
          } catch {}
        }
        return {
          ok: true,
          size: png.length,
          savedToDevice: args.saveToDevice ?? null,
          downloaded: !!args.download,
          note: attach ? 'Screenshot attached. Look at it to verify UI state.' : 'Screenshot captured.',
          _images: attach ? [{ media_type: 'image/png', data: b64 }] : undefined,
        }
      },
    },
    {
      name: 'screenshot.burst',
      description: '连拍：按间隔连续截 N 张（PNG），打包到设备上的一个目录或本地下载。不作为 vision attachment，只返回路径列表。',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: '截几张，默认 5，上限 30' },
          intervalMs: { type: 'number', description: '每张间隔毫秒，默认 500' },
          saveDir: { type: 'string', description: '设备目录，默认 /sdcard/Pictures/Dive-burst-<ts>' },
          download: { type: 'boolean', description: '是否也下载到本地（合并为 zip? 目前直接一张张下载）', },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const count = Math.min(Math.max(Number(args.count ?? 5), 1), 30)
        const interval = Math.max(Number(args.intervalMs ?? 500), 0)
        const dir = String(args.saveDir || `/sdcard/Pictures/Dive-burst-${Date.now()}`)
        await d.fs.mkdir(dir, true)
        const files: string[] = []
        for (let i = 0; i < count; i++) {
          const png = await d.screen.capture()
          const name = `shot-${String(i + 1).padStart(3, '0')}.png`
          const p = `${dir}/${name}`
          await d.fs.write(p, png)
          files.push(p)
          if (args.download) triggerDownload(name, png, 'image/png')
          if (i < count - 1 && interval > 0) await new Promise((r) => setTimeout(r, interval))
        }
        return { ok: true, dir, count: files.length, files }
      },
    },
    {
      name: 'screenshot.region',
      description: '截图并裁剪到指定矩形区域。坐标单位为屏幕像素。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
          download: { type: 'boolean' },
          filename: { type: 'string' },
          attachToModel: { type: 'boolean', description: '默认 true' },
        },
        required: ['x', 'y', 'w', 'h'],
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const png = await d.screen.capture()
        // 用 createImageBitmap 裁剪
        const bmp = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
        const sx = Math.max(0, Math.floor(Number(args.x)))
        const sy = Math.max(0, Math.floor(Number(args.y)))
        const sw = Math.max(1, Math.floor(Number(args.w)))
        const sh = Math.max(1, Math.floor(Number(args.h)))
        const canvas = document.createElement('canvas')
        canvas.width = sw
        canvas.height = sh
        const c2d = canvas.getContext('2d')!
        c2d.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
        bmp.close()
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png'))
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (args.download) {
          const name = String(args.filename || `region-${Date.now()}.png`)
          triggerDownload(name, bytes, 'image/png')
        }
        const attach = args.attachToModel !== false
        const b64 = attach ? bytesToBase64(bytes) : ''
        if (attach) {
          try {
            const mod = await import('@/services/chat')
            mod.chat.push('assistant', '[screen region]', {
              images: [{ preview: `data:image/png;base64,${b64}`, media_type: 'image/png' }],
            })
          } catch {}
        }
        return {
          ok: true,
          size: bytes.length,
          region: { x: sx, y: sy, w: sw, h: sh },
          _images: attach ? [{ media_type: 'image/png', data: b64 }] : undefined,
        }
      },
    },
  ],
}
