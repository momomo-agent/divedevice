import type { AppManifest } from '@/types'
import { getDevice } from '@/device'
import Window from './Window.vue'

export const screencastManifest: AppManifest = {
  id: 'screencast',
  name: 'Screencast',
  icon: '📱',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 380, height: 720, resizable: true, minWidth: 280, minHeight: 420 },
  tools: [
    {
      name: 'input.tap',
      description: '在 Android 设备屏幕上点击坐标 (x, y)。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
        },
        required: ['x', 'y'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.tap(Number(args.x), Number(args.y))
        return { ok: true }
      },
    },
    {
      name: 'input.swipe',
      description: '在 Android 设备屏幕上滑动。',
      parameters: {
        type: 'object',
        properties: {
          x1: { type: 'number' }, y1: { type: 'number' },
          x2: { type: 'number' }, y2: { type: 'number' },
          durationMs: { type: 'number' },
        },
        required: ['x1', 'y1', 'x2', 'y2'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.swipe(
          Number(args.x1), Number(args.y1),
          Number(args.x2), Number(args.y2),
          args.durationMs ? Number(args.durationMs) : undefined,
        )
        return { ok: true }
      },
    },
    {
      name: 'input.key',
      description: '在 Android 设备上发送按键事件。常用：KEYCODE_HOME / KEYCODE_BACK / KEYCODE_APP_SWITCH / KEYCODE_ENTER / KEYCODE_DEL / KEYCODE_POWER / KEYCODE_VOLUME_UP / KEYCODE_VOLUME_DOWN',
      parameters: {
        type: 'object',
        properties: { keycode: { type: 'string' } },
        required: ['keycode'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.key(String(args.keycode))
        return { ok: true }
      },
    },
    {
      name: 'screen.capture',
      description: '截取 Android 设备当前屏幕，返回 PNG 的 base64 字符串。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const png = await d.screen.capture()
        let bin = ''
        for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i])
        return { pngBase64: btoa(bin), size: png.length }
      },
    },
  ],
}
