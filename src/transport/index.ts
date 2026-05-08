/**
 * L1 Transport —— 唯一碰 WebADB 的层
 *
 * 向上只暴露 AdbConnection + TransportManager，
 * L2 不需要知道是 USB 还是 WebSocket。
 */

import { Adb, AdbDaemonTransport } from '@yume-chan/adb'
import { AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb'
import type { AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb'
import { credentialStore } from './credential-store'
import type { DeviceInfo } from '@/types'

/**
 * AdbConnection —— 对 L2 暴露的最小门面。
 */
export interface AdbConnection {
  readonly info: DeviceInfo
  readonly adb: Adb
  close(): Promise<void>
}

class UsbAdbConnection implements AdbConnection {
  constructor(
    public readonly info: DeviceInfo,
    public readonly adb: Adb,
  ) {}

  async close(): Promise<void> {
    await this.adb.close()
  }
}

// ============ TransportManager ============

class TransportManager {
  private connections = new Map<string, AdbConnection>()
  private listeners = new Set<(conns: AdbConnection[]) => void>()

  get webUsbSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator
  }

  async listUsbDevices(): Promise<AdbDaemonWebUsbDevice[]> {
    if (!this.webUsbSupported) return []
    const mgr = AdbDaemonWebUsbDeviceManager.BROWSER
    if (!mgr) return []
    return mgr.getDevices()
  }

  async requestUsbDevice(): Promise<AdbConnection | null> {
    if (!this.webUsbSupported) {
      throw new Error('WebUSB 不受支持。请使用 Chrome / Edge 浏览器。')
    }
    const mgr = AdbDaemonWebUsbDeviceManager.BROWSER
    if (!mgr) throw new Error('WebUSB 不可用')

    const device = await mgr.requestDevice()
    if (!device) return null
    return this.connectUsb(device)
  }

  /** 启动时自动再连浏览器记住授权的设备 */
  async autoReconnectAuthorized(): Promise<AdbConnection[]> {
    if (!this.webUsbSupported) return []
    const mgr = AdbDaemonWebUsbDeviceManager.BROWSER
    if (!mgr) return []
    const devs = await mgr.getDevices().catch(() => [] as AdbDaemonWebUsbDevice[])
    const ok: AdbConnection[] = []
    for (const d of devs) {
      try {
        ok.push(await this.connectUsb(d))
      } catch (err) {
        console.warn('[transport] autoReconnect skip', d.serial, err)
      }
    }
    return ok
  }

  private async connectUsb(device: AdbDaemonWebUsbDevice): Promise<AdbConnection> {
    const connection = await device.connect()

    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore,
    })

    const adb = new Adb(transport)

    const serial = device.serial
    const shortSerial = serial.slice(-4) || serial
    const bannerModel = transport.banner.model
    const bannerProduct = transport.banner.product

    // banner.model/product 在部分 ROM 上会回 serial（大小写差异/纯数字型号）或为空，
    // 那样拿不到真正的机型名。此时走 getprop。
    const looksLikeSerial = (s: string | undefined): boolean => {
      if (!s) return true
      if (s.toLowerCase() === serial.toLowerCase()) return true
      // 纯大写字母+数字且 >= 8 位（典型小米/OPPO 的 serial 形状，如 24129PN74C）
      if (/^[A-Z0-9]{8,}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s)) return true
      return false
    }

    let prettyModel = !looksLikeSerial(bannerModel) ? bannerModel : ''
    if (!prettyModel && !looksLikeSerial(bannerProduct)) prettyModel = bannerProduct
    if (!prettyModel) {
      try {
        const m = (await adb.subprocess.noneProtocol.spawnWaitText(['getprop', 'ro.product.model'])).trim()
        if (m && !looksLikeSerial(m)) prettyModel = m
      } catch {}
    }
    if (!prettyModel) {
      try {
        const brand = (await adb.subprocess.noneProtocol.spawnWaitText(['getprop', 'ro.product.manufacturer'])).trim()
        if (brand && !looksLikeSerial(brand)) prettyModel = brand
      } catch {}
    }
    // 些 Redmi/小米 ro.product.model 就是 serial，试 ro.product.marketname / ro.vendor.oplus.market.name
    if (!prettyModel) {
      for (const key of [
        'ro.product.marketname',
        'ro.vendor.oplus.market.name',
        'ro.product.odm.marketname',
        'ro.product.vendor.marketname',
      ]) {
        try {
          const m = (await adb.subprocess.noneProtocol.spawnWaitText(['getprop', key])).trim()
          if (m && !looksLikeSerial(m)) { prettyModel = m; break }
        } catch {}
      }
    }
    if (!prettyModel) prettyModel = 'Android'

    const displayName = shortSerial && shortSerial !== prettyModel
      ? `${prettyModel} (${shortSerial})`
      : prettyModel

    const info: DeviceInfo = {
      id: `usb:${serial}`,
      serial,
      name: displayName,
      model: prettyModel,
      transport: 'usb',
      connected: true,
    }

    const conn = new UsbAdbConnection(info, adb)
    this.connections.set(info.id, conn)
    this.emit()

    transport.disconnected
      .then(() => {
        this.connections.delete(info.id)
        this.emit()
      })
      .catch(() => {})

    return conn
  }

  get(id: string): AdbConnection | undefined {
    return this.connections.get(id)
  }

  list(): AdbConnection[] {
    return [...this.connections.values()]
  }

  async disconnect(id: string): Promise<void> {
    const c = this.connections.get(id)
    if (!c) return
    await c.close().catch(() => {})
    this.connections.delete(id)
    this.emit()
  }

  onChange(listener: (conns: AdbConnection[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const snapshot = this.list()
    for (const l of this.listeners) {
      try { l(snapshot) } catch (err) { console.error('[transport]', err) }
    }
  }
}

export const transportManager = new TransportManager()
