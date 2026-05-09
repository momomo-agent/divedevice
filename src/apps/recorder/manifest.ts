import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import { triggerDownload } from '@/services'
import Window from './Window.vue'

function requireDevice(ctx: { deviceId?: string }) {
  const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
  if (!d) throw new Error('未绑定设备')
  return d
}

type RecordSession = Awaited<ReturnType<typeof dummy>>
// 拿到 screen.record 的返回类型
async function dummy() { return {} as { path: string; stop: () => Promise<void>; pull: () => Promise<Uint8Array> } }

// 每个 deviceId 最多同时一个录制会话（Android screenrecord 并发行为不稳定）
const sessions = new Map<string, { session: RecordSession; startedAt: number; opts: Record<string, unknown> }>()

export const recorderManifest: AppManifest = {
  id: 'recorder',
  name: 'Recorder',
  icon: '⏺',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 520, height: 520, resizable: true, minWidth: 360, minHeight: 320 },
  tools: [
    {
      name: 'record.start',
      description: '使用设备原生 screenrecord 开始屏幕录制，生成 mp4（存在 /sdcard）。通过 record.stop 停止并拉回。同一设备同时只允许一个会话。',
      parameters: {
        type: 'object',
        properties: {
          size: { type: 'string', description: '分辨率，例如 "720x1280"，留空使用设备默认' },
          bitRate: { type: 'number', description: '码率 Kbps，例如 4000' },
          timeLimitSec: { type: 'number', description: '最大时长（秒），screenrecord 上限约 180s' },
          remotePath: { type: 'string', description: '设备上存放 mp4 的路径，默认 /sdcard/screenrecord-<ts>.mp4' },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        if (sessions.has(d.id)) throw new Error('已有一个正在进行的录制，先 record.stop')
        const opts = {
          size: args.size ? String(args.size) : undefined,
          bitRate: args.bitRate != null ? Number(args.bitRate) : undefined,
          timeLimitSec: args.timeLimitSec != null ? Number(args.timeLimitSec) : undefined,
          remotePath: args.remotePath ? String(args.remotePath) : undefined,
        }
        const session = await d.screen.record(opts)
        sessions.set(d.id, { session, startedAt: Date.now(), opts: opts as Record<string, unknown> })
        return { ok: true, path: session.path, startedAt: Date.now() }
      },
    },
    {
      name: 'record.status',
      description: '查询当前设备是否正在录制，以及录制了多久。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = requireDevice(ctx)
        const s = sessions.get(d.id)
        if (!s) return { recording: false }
        return {
          recording: true,
          path: s.session.path,
          elapsedMs: Date.now() - s.startedAt,
          opts: s.opts,
        }
      },
    },
    {
      name: 'record.stop',
      description: '停止当前设备的录制，将生成的 mp4 下载到本地（默认）。',
      parameters: {
        type: 'object',
        properties: {
          download: { type: 'boolean', description: '是否触发浏览器下载，默认 true' },
          keepOnDevice: { type: 'boolean', description: '下载后是否保留设备上的 mp4，默认 false' },
        },
      },
      async execute(args, ctx) {
        const d = requireDevice(ctx)
        const s = sessions.get(d.id)
        if (!s) throw new Error('当前没有正在进行的录制')
        await s.session.stop()
        const data = await s.session.pull()
        const saveName = (s.session.path.split('/').pop() || 'screenrecord.mp4')
        if (args.download !== false) {
          triggerDownload(saveName, data, 'video/mp4')
        }
        if (!args.keepOnDevice) {
          try { await d.fs.rm(s.session.path, false) } catch { /* 忽略清理失败 */ }
        }
        sessions.delete(d.id)
        return {
          ok: true,
          size: data.length,
          saveAs: saveName,
          durationMs: Date.now() - s.startedAt,
        }
      },
    },
  ],
}
