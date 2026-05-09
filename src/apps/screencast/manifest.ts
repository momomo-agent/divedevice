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
      description: 'Take a screenshot of the device. Returns a vision attachment that YOU (the model) can see in the next turn, and the user also sees a thumbnail in chat. Use this to verify UI state after actions (taps, swipes, app launches). Do NOT call it repeatedly without reason — one capture per verification step is usually enough.',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const png = await d.screen.capture()
        let bin = ''
        for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i])
        const b64 = btoa(bin)
        // 把截得的图直接推入 chat，用户立即能看到缩略图
        try {
          const mod = await import('@/services/chat')
          mod.chat.push('assistant', '[screen capture]', {
            images: [{ preview: `data:image/png;base64,${b64}`, media_type: 'image/png' }],
          })
        } catch {}
        // _images 字段会被 agent wrapper 透传给模型（走 Anthropic tool_result multimodal）
        return {
          ok: true,
          size: png.length,
          note: 'Screenshot attached below. Look at it to verify the UI state.',
          _images: [{ media_type: 'image/png', data: b64 }],
        }
      },
    },
    {
      name: 'input.text',
      description: '在当前焦点输入文本（支持中文/英文/特殊字符）。先 tap 输入框再调用。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '要输入的文本' } },
        required: ['text'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.text(String(args.text))
        return { ok: true, text: args.text }
      },
    },
    {
      name: 'input.longPress',
      description: '长按屏幕指定坐标（默认 1000ms）。用于触发长按菜单、拖拽等。',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          durationMs: { type: 'number', description: '长按时长（ms），默认 1000' },
        },
        required: ['x', 'y'],
      },
      async execute(args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        const dur = Number(args.durationMs) || 1000
        // long press = swipe from (x,y) to (x,y) with duration
        await d.input.swipe(Number(args.x), Number(args.y), Number(args.x), Number(args.y), dur)
        return { ok: true, x: args.x, y: args.y, durationMs: dur }
      },
    },
    {
      name: 'input.back',
      description: '按返回键。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.key('KEYCODE_BACK')
        return { ok: true }
      },
    },
    {
      name: 'input.home',
      description: '按 Home 键回到主屏幕。',
      parameters: { type: 'object', properties: {} },
      async execute(_args, ctx) {
        const d = ctx.deviceId ? getDevice(ctx.deviceId) : undefined
        if (!d) throw new Error('未绑定设备')
        await d.input.key('KEYCODE_HOME')
        return { ok: true }
      },
    },
  ],
}
