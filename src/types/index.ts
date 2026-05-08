/**
 * 核心类型定义
 * 跨层共享的 interface 都放这里。
 */

// ============ 设备 ============

export interface DeviceInfo {
  id: string              // 内部 id，transport 生成
  serial: string          // adb serial
  name: string            // 用户可读名称（model + serial 尾四位）
  model?: string
  transport: 'usb' | 'ws'
  connected: boolean
}

// ============ 窗口 ============

export type WindowState = 'normal' | 'minimized' | 'maximized'

export interface WindowFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowInstance {
  id: string              // 运行时 id
  appId: string           // 对应 AppManifest.id
  deviceId: string | null // 绑定的设备，null = 无需设备
  title: string           // 显示标题（app 可动态更新）
  frame: WindowFrame
  state: WindowState
  zIndex: number
  props?: Record<string, unknown>  // 传给 Window 组件的初始 props
  createdAt: number
}

// ============ App Manifest ============

import type { Component } from 'vue'

export interface WindowDefaults {
  width: number
  height: number
  resizable?: boolean
  minWidth?: number
  minHeight?: number
}

export interface AppManifest {
  id: string                  // 全局唯一，如 'finder' / 'editor'
  name: string
  icon: string                // emoji 或 URL，先 emoji
  component: Component        // Window 组件
  windowDefaults: WindowDefaults
  requiresDevice: boolean
  tools?: ToolDefinition[]
}

// ============ Tools（Agent 层） ============

export interface ToolParamSchema {
  type: string
  description?: string
  enum?: string[]
  /** type === 'array' 时的元素 schema */
  items?: ToolParamSchema
  /** type === 'object' 时的字段 schema（可选） */
  properties?: Record<string, ToolParamSchema>
  required?: string[]
}

export interface ToolDefinition {
  name: string                // 命名空间：'fs.ls' / 'editor.open'
  description: string
  // JSON Schema 子集，足够描述参数即可
  parameters: {
    type: 'object'
    properties: Record<string, ToolParamSchema>
    required?: string[]
  }
  // 由运行时填入 context 后执行
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>
}

export interface ToolContext {
  deviceId?: string           // 如果适用
  windowId?: string           // 调用来源窗口（可选）
}

// ============ 事件 ============

export interface EventMap {
  'device.connected': { device: DeviceInfo }
  'device.disconnected': { deviceId: string }
  'window.opened': { window: WindowInstance }
  'window.closed': { windowId: string }
  'window.focused': { windowId: string }
  'finder.openFile': { deviceId: string; path: string }
}
