/**
 * L2 Device API —— POSIX 风格门面
 *
 * 业务层（apps/tools）只依赖这层，
 * 看不到 adb/WebUSB 任何细节。
 * 未来想支持"本地 shell mode" → 实现同样接口即可。
 */

import type { AdbConnection } from '@/transport'
import { ReadableStream } from '@yume-chan/stream-extra'
import type {
  ReadableStream as RS,
  WritableStream as WS,
} from '@yume-chan/stream-extra'
import { LinuxFileType } from '@yume-chan/adb'

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime?: number
  mode?: number
}

export interface SpawnedProcess {
  stdin: WS<Uint8Array>
  stdout: RS<Uint8Array>
  stderr: RS<Uint8Array>
  exit: Promise<number>
  kill(): Promise<void>
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface TopActivity {
  packageName: string
  activityName: string
  pid?: number
  displayId?: number
}

export interface ActivityTask {
  taskId: number
  topActivity?: string
  origActivity?: string
  realActivity?: string
  numActivities?: number
}

export interface ProcessInfo {
  user: string
  pid: number
  ppid: number
  vsz: number
  rss: number
  name: string
}

export interface LayerInfo {
  total: number
  visible: number
  layers: Array<{ name: string; visible: boolean; crop?: string; z?: number }>
}

export interface BatteryInfo {
  level?: number
  scale?: number
  status?: string
  health?: string
  plugged?: string
  temperature?: number
  voltage?: number
  technology?: string
  present?: boolean
  [k: string]: unknown
}

export interface NetworkInfo {
  wifi: { ssid?: string; ip?: string; bssid?: string }
  mobile: { operator?: string; type?: string }
  ipAddrs: Array<{ iface: string; ipv4?: string; ipv6?: string }>
}

export interface CpuInfo {
  load1?: number
  load5?: number
  load15?: number
  cpuPercent?: number
  cores?: number
}

export interface PackageInfo {
  packageName: string
  /** 应用名称（如 label）——能拿到再填 */
  label?: string
  versionName?: string
  versionCode?: number
  /** 安装来源的 installer 包名 */
  installer?: string
  /** 如果是 system app */
  isSystem: boolean
  /** apk 路径 */
  codePath?: string
  /** targetSdk / minSdk */
  targetSdk?: number
  minSdk?: number
  /** uid */
  uid?: number
  firstInstallTime?: number
  lastUpdateTime?: number
  /** 是否已禁用 */
  enabled?: boolean
}

export interface DeviceAPI {
  readonly id: string

  fs: {
    ls(path: string): Promise<FileEntry[]>
    read(path: string): Promise<Uint8Array>
    readText(path: string, encoding?: string): Promise<string>
    write(path: string, data: Uint8Array | string): Promise<void>
    stat(path: string): Promise<FileEntry | null>
    mkdir(path: string, recursive?: boolean): Promise<void>
    rm(path: string, recursive?: boolean): Promise<void>
  }

  shell: {
    exec(cmd: string): Promise<ExecResult>
    spawn(cmd: string): Promise<SpawnedProcess>
  }

  input: {
    tap(x: number, y: number): Promise<void>
    swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number): Promise<void>
    text(s: string): Promise<void>
    key(keycode: number | string): Promise<void>
  }

  screen: {
    capture(): Promise<Uint8Array>
    /** 直传 raw framebuffer（RGBA8888 或设备原生格式），用于实时投屏跳过 PNG encode */
    frame(): Promise<{
      width: number
      height: number
      data: Uint8Array
      redOffset: number; redLength: number
      greenOffset: number; greenLength: number
      blueOffset: number; blueLength: number
      alphaOffset: number; alphaLength: number
    }>
  }

  app: {
    /** 包名数组（含 system apps） */
    list(opts?: { system?: boolean; thirdParty?: boolean }): Promise<string[]>
    /** 包名 + 版本/installer/名称 等元信息 */
    info(pkg: string): Promise<PackageInfo | null>
    /** 批量拉元信息（并发控制） */
    infoBatch(pkgs: string[], concurrency?: number): Promise<Array<PackageInfo | null>>
    /** 启动应用主界面 */
    launch(pkg: string): Promise<void>
    /** 停止应用（force-stop） */
    stop(pkg: string): Promise<void>
    /** 清除应用数据 */
    clear(pkg: string): Promise<void>
    /** 卸载 */
    uninstall(pkg: string, keepData?: boolean): Promise<void>
    /** 禁用/启用 */
    disable(pkg: string): Promise<void>
    enable(pkg: string): Promise<void>
    /** 授予授权 */
    grant(pkg: string, permission: string): Promise<void>
    revoke(pkg: string, permission: string): Promise<void>
  }

  /** 系统 / 调试查询（dumpsys / 属性 / 进程） */
  system: {
    /** 属性读写 */
    getProps(): Promise<Record<string, string>>
    setProp(key: string, value: string): Promise<void>

    /** 前台 activity 信息（resumed） */
    topActivity(): Promise<TopActivity | null>
    /** 所有 task stack */
    tasks(): Promise<ActivityTask[]>
    /** 进程列表（ps） */
    processes(): Promise<ProcessInfo[]>
    /** SurfaceFlinger layers */
    layers(): Promise<LayerInfo>
    /** gfxinfo 渲染统计 */
    gfxinfo(pkg?: string): Promise<string>
    /** meminfo 全局 */
    meminfo(): Promise<string>
    /** 电池信息 */
    battery(): Promise<BatteryInfo>
    /** 网络状态 */
    network(): Promise<NetworkInfo>
    /** CPU 负载 */
    cpuinfo(): Promise<CpuInfo>
    /** 当前 IME */
    currentIme(): Promise<string | null>
    /** kill 进程（需 root） */
    killPid(pid: number): Promise<void>
  }

  logcat(filter?: string): Promise<SpawnedProcess>
}

// ============ 实现：基于 adb connection ============

class AdbDeviceAPI implements DeviceAPI {
  readonly id: string
  constructor(private conn: AdbConnection) {
    this.id = conn.info.id
  }

  // ---- helpers ----

  private async readAll(stream: RS<Uint8Array>): Promise<Uint8Array> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        total += value.length
      }
    }
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      out.set(c, off)
      off += c.length
    }
    return out
  }

  // ---- fs ----

  fs = {
    ls: async (path: string): Promise<FileEntry[]> => {
      const sync = await this.conn.adb.sync()
      try {
        const entries: FileEntry[] = []
        for await (const item of sync.opendir(path)) {
          // 跳过 . 和 ..
          if (item.name === '.' || item.name === '..') continue
          entries.push({
            name: item.name,
            path: path.endsWith('/') ? `${path}${item.name}` : `${path}/${item.name}`,
            isDir: item.type === LinuxFileType.Directory,
            size: Number(item.size ?? 0),
            mtime: Number(item.mtime ?? 0),
            mode: Number(item.mode ?? 0),
          })
        }
        return entries
      } finally {
        await sync.dispose()
      }
    },

    read: async (path: string): Promise<Uint8Array> => {
      const sync = await this.conn.adb.sync()
      try {
        const stream = sync.read(path)
        return await this.readAll(stream)
      } finally {
        await sync.dispose()
      }
    },

    readText: async (path: string, encoding = 'utf-8'): Promise<string> => {
      return new TextDecoder(encoding).decode(await this.fs.read(path))
    },

    write: async (path: string, data: Uint8Array | string): Promise<void> => {
      const sync = await this.conn.adb.sync()
      try {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
        const source = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        })
        await sync.write({ filename: path, file: source })
      } finally {
        await sync.dispose()
      }
    },

    stat: async (path: string): Promise<FileEntry | null> => {
      const sync = await this.conn.adb.sync()
      try {
        const s = await sync.lstat(path)
        if (Number(s.mode) === 0) return null
        const name = path.split('/').filter(Boolean).pop() ?? path
        return {
          name,
          path,
          isDir: s.type === LinuxFileType.Directory,
          size: Number(s.size ?? 0),
          mtime: Number(s.mtime ?? 0),
          mode: Number(s.mode ?? 0),
        }
      } finally {
        await sync.dispose()
      }
    },

    mkdir: async (path: string, recursive = true) => {
      const flag = recursive ? '-p ' : ''
      await this.shell.exec(`mkdir ${flag}${shellQuote(path)}`)
    },

    rm: async (path: string, recursive = false) => {
      const flag = recursive ? '-rf' : '-f'
      await this.shell.exec(`rm ${flag} ${shellQuote(path)}`)
    },
  }

  // ---- shell ----

  shell = {
    exec: async (cmd: string): Promise<ExecResult> => {
      const sp = this.conn.adb.subprocess.shellProtocol
      if (sp) {
        const result = await sp.spawnWaitText(cmd)
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        }
      }
      // 老设备：合并 stdout+stderr，exitCode 用 $? 包装
      const stdout = await this.conn.adb.subprocess.noneProtocol.spawnWaitText(cmd)
      return { stdout, stderr: '', exitCode: 0 }
    },

    spawn: async (cmd: string): Promise<SpawnedProcess> => {
      const sp = this.conn.adb.subprocess.shellProtocol
      if (sp) {
        const proc = await sp.spawn(cmd)
        return {
          stdin: proc.stdin as unknown as WS<Uint8Array>,
          stdout: proc.stdout as unknown as RS<Uint8Array>,
          stderr: proc.stderr as unknown as RS<Uint8Array>,
          exit: proc.exited,
          kill: async () => { await proc.kill() },
        }
      }
      // 回退到 none protocol（stdout/stderr 合并）
      const proc = await this.conn.adb.subprocess.noneProtocol.spawn(cmd)
      const empty = new ReadableStream<Uint8Array>({
        start(c) { c.close() },
      })
      return {
        stdin: proc.stdin as unknown as WS<Uint8Array>,
        stdout: proc.output as unknown as RS<Uint8Array>,
        stderr: empty,
        exit: proc.exited.then(() => 0),
        kill: async () => { await proc.kill() },
      }
    },
  }

  // ---- input ----

  input = {
    tap: async (x: number, y: number) => {
      await this.shell.exec(`input tap ${x} ${y}`)
    },
    swipe: async (x1: number, y1: number, x2: number, y2: number, duration = 300) => {
      await this.shell.exec(`input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`)
    },
    text: async (s: string) => {
      const safe = s.replace(/ /g, '%s').replace(/"/g, '\\"')
      await this.shell.exec(`input text "${safe}"`)
    },
    key: async (keycode: number | string) => {
      await this.shell.exec(`input keyevent ${keycode}`)
    },
  }

  // ---- screen ----

  screen = {
    capture: async (): Promise<Uint8Array> => {
      const proc = await this.conn.adb.subprocess.noneProtocol.spawn('screencap -p')
      return this.readAll(proc.output as unknown as RS<Uint8Array>)
    },
    frame: async () => {
      const fb = await this.conn.adb.framebuffer()
      return {
        width: fb.width,
        height: fb.height,
        data: fb.data,
        redOffset: fb.red_offset,
        redLength: fb.red_length,
        greenOffset: fb.green_offset,
        greenLength: fb.green_length,
        blueOffset: fb.blue_offset,
        blueLength: fb.blue_length,
        alphaOffset: fb.alpha_offset,
        alphaLength: fb.alpha_length,
      }
    },
  }

  // ---- app ----

  app = {
    list: async (opts?: { system?: boolean; thirdParty?: boolean }): Promise<string[]> => {
      let flag = ''
      if (opts?.thirdParty) flag = ' -3'
      else if (opts?.system) flag = ' -s'
      const { stdout } = await this.shell.exec(`pm list packages${flag}`)
      return stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('package:'))
        .map((l) => l.slice('package:'.length))
        .sort()
    },

    info: async (pkg: string): Promise<PackageInfo | null> => {
      const { stdout, exitCode } = await this.shell.exec(`dumpsys package ${shellQuote(pkg)}`)
      if (exitCode !== 0 || !stdout) return null
      return parsePackageDumpsys(pkg, stdout)
    },

    infoBatch: async (pkgs: string[], concurrency = 4): Promise<Array<PackageInfo | null>> => {
      const out: Array<PackageInfo | null> = new Array(pkgs.length).fill(null)
      let cursor = 0
      const workers = Array.from({ length: Math.min(concurrency, pkgs.length) }, async () => {
        while (true) {
          const i = cursor++
          if (i >= pkgs.length) return
          out[i] = await this.app.info(pkgs[i])
        }
      })
      await Promise.all(workers)
      return out
    },

    launch: async (pkg: string) => {
      await this.shell.exec(`monkey -p ${shellQuote(pkg)} -c android.intent.category.LAUNCHER 1`)
    },
    stop: async (pkg: string) => {
      await this.shell.exec(`am force-stop ${shellQuote(pkg)}`)
    },
    clear: async (pkg: string) => {
      await this.shell.exec(`pm clear ${shellQuote(pkg)}`)
    },
    uninstall: async (pkg: string, keepData = false) => {
      const flag = keepData ? '-k ' : ''
      const { exitCode, stdout, stderr } = await this.shell.exec(`pm uninstall ${flag}${shellQuote(pkg)}`)
      if (exitCode !== 0 || /Failure|not installed/i.test(stdout + stderr)) {
        throw new Error(`uninstall 失败：${stdout || stderr}`)
      }
    },
    disable: async (pkg: string) => {
      await this.shell.exec(`pm disable-user --user 0 ${shellQuote(pkg)}`)
    },
    enable: async (pkg: string) => {
      await this.shell.exec(`pm enable ${shellQuote(pkg)}`)
    },
    grant: async (pkg: string, permission: string) => {
      await this.shell.exec(`pm grant ${shellQuote(pkg)} ${shellQuote(permission)}`)
    },
    revoke: async (pkg: string, permission: string) => {
      await this.shell.exec(`pm revoke ${shellQuote(pkg)} ${shellQuote(permission)}`)
    },
  }

  // ---- system ----

  system = {
    getProps: async (): Promise<Record<string, string>> => {
      const { stdout } = await this.shell.exec('getprop')
      const out: Record<string, string> = {}
      for (const line of stdout.split('\n')) {
        const m = line.match(/^\[([^\]]+)\]:\s*\[([^\]]*)\]/)
        if (m) out[m[1]] = m[2]
      }
      return out
    },
    setProp: async (key: string, value: string) => {
      await this.shell.exec(`setprop ${shellQuote(key)} ${shellQuote(value)}`)
    },

    topActivity: async (): Promise<TopActivity | null> => {
      const { stdout } = await this.shell.exec('dumpsys activity activities')
      // mResumedActivity: ActivityRecord{abc u0 com.foo/.Main t123}
      const m = stdout.match(/mResumedActivity:[^\n]*\{[^ ]+ u\d+ ([^ /]+)\/([^ }]+)/)
        ?? stdout.match(/ResumedActivity:[^\n]*\{[^ ]+ u\d+ ([^ /]+)\/([^ }]+)/)
      if (!m) return null
      const packageName = m[1]
      let activityName = m[2]
      if (activityName.startsWith('.')) activityName = packageName + activityName
      return { packageName, activityName }
    },

    tasks: async (): Promise<ActivityTask[]> => {
      const { stdout } = await this.shell.exec('dumpsys activity recents')
      const tasks: ActivityTask[] = []
      const re = /Recent #\d+:[\s\S]*?(?=Recent #\d+:|$)/g
      const blocks = stdout.match(re) ?? []
      for (const blk of blocks) {
        const id = blk.match(/\btaskId=(\d+)/)?.[1]
        if (!id) continue
        tasks.push({
          taskId: Number(id),
          topActivity: blk.match(/topActivity[=:]\s*[^ ]*\{[^ ]+ ([^ }]+)/)?.[1]
            ?? blk.match(/topActivity[=:]\s*([^\s,]+)/)?.[1],
          origActivity: blk.match(/origActivity[=:]\s*([^\s,]+)/)?.[1],
          realActivity: blk.match(/realActivity[=:]\s*([^\s,]+)/)?.[1],
          numActivities: Number(blk.match(/numActivities=(\d+)/)?.[1] ?? '0') || undefined,
        })
      }
      return tasks
    },

    processes: async (): Promise<ProcessInfo[]> => {
      const { stdout } = await this.shell.exec('ps -A -o USER,PID,PPID,VSZ,RSS,NAME')
      const lines = stdout.split('\n').slice(1).filter(Boolean)
      const procs: ProcessInfo[] = []
      for (const line of lines) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 6) continue
        procs.push({
          user: parts[0],
          pid: Number(parts[1]) || 0,
          ppid: Number(parts[2]) || 0,
          vsz: Number(parts[3]) || 0,
          rss: Number(parts[4]) || 0,
          name: parts.slice(5).join(' '),
        })
      }
      return procs
    },

    layers: async (): Promise<LayerInfo> => {
      const { stdout } = await this.shell.exec('dumpsys SurfaceFlinger --list')
      const names = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
      // 默认 --list 不含 visibility，单购额外拉 dumpsys SurfaceFlinger 解析 visible
      const { stdout: full } = await this.shell.exec('dumpsys SurfaceFlinger')
      const visibleNames = new Set<string>()
      // heuristic：section header 开头的 "+ XxxLayer (name)" 通常是活跃 layer
      for (const line of full.split('\n')) {
        const m = line.match(/^\s*\+\s*(?:BufferLayer|ColorLayer|ContainerLayer|EffectLayer|Layer)\s+\S+\s+\(([^)]+)\)/)
        if (m) visibleNames.add(m[1])
      }
      return {
        total: names.length,
        visible: visibleNames.size,
        layers: names.map((name) => ({ name, visible: visibleNames.has(name) })),
      }
    },

    gfxinfo: async (pkg?: string): Promise<string> => {
      const target = pkg ? shellQuote(pkg) : ''
      const { stdout } = await this.shell.exec(`dumpsys gfxinfo ${target}`)
      return stdout
    },

    meminfo: async (): Promise<string> => {
      const { stdout } = await this.shell.exec('dumpsys meminfo')
      return stdout
    },

    battery: async (): Promise<BatteryInfo> => {
      const { stdout } = await this.shell.exec('dumpsys battery')
      const get = (re: RegExp): string | undefined => stdout.match(re)?.[1]?.trim()
      const info: BatteryInfo = {}
      const level = get(/^\s*level:\s*(\d+)/m); if (level) info.level = Number(level)
      const scale = get(/^\s*scale:\s*(\d+)/m); if (scale) info.scale = Number(scale)
      info.status = mapBatteryStatus(get(/^\s*status:\s*(\d+)/m))
      info.health = mapBatteryHealth(get(/^\s*health:\s*(\d+)/m))
      info.plugged = mapBatteryPlugged(get(/^\s*plugged:\s*(-?\d+)/m))
      const t = get(/^\s*temperature:\s*(\d+)/m); if (t) info.temperature = Number(t) / 10
      const v = get(/^\s*voltage:\s*(\d+)/m); if (v) info.voltage = Number(v)
      info.technology = get(/^\s*technology:\s*(.*)$/m)
      const p = get(/^\s*present:\s*(true|false)/m); if (p) info.present = p === 'true'
      return info
    },

    network: async (): Promise<NetworkInfo> => {
      const [wifi, ip] = await Promise.all([
        this.shell.exec('dumpsys wifi | head -n 60').catch(() => ({ stdout: '' })),
        this.shell.exec('ip -o addr').catch(() => ({ stdout: '' })),
      ])
      const info: NetworkInfo = { wifi: {}, mobile: {}, ipAddrs: [] }
      info.wifi.ssid = wifi.stdout.match(/mWifiInfo\s+SSID:\s*"?([^",\n]+)"?/)?.[1]
        ?? wifi.stdout.match(/\bSSID:\s*"?([^",\n]+)"?/)?.[1]
      // ip -o addr 解析
      const byIface: Record<string, { ipv4?: string; ipv6?: string }> = {}
      for (const line of ip.stdout.split('\n')) {
        const m = line.match(/^\d+:\s+(\S+)\s+inet6?\s+([0-9a-f:.]+)/i)
        if (!m) continue
        const [, iface, addr] = m
        if (!byIface[iface]) byIface[iface] = {}
        if (addr.includes(':')) byIface[iface].ipv6 = addr.split('/')[0]
        else byIface[iface].ipv4 = addr.split('/')[0]
      }
      info.ipAddrs = Object.entries(byIface).map(([iface, v]) => ({ iface, ...v }))
      info.wifi.ip = byIface.wlan0?.ipv4
      return info
    },

    cpuinfo: async (): Promise<CpuInfo> => {
      const { stdout } = await this.shell.exec('cat /proc/loadavg; nproc')
      const lines = stdout.trim().split('\n')
      const info: CpuInfo = {}
      if (lines[0]) {
        const parts = lines[0].split(/\s+/)
        if (parts[0]) info.load1 = Number(parts[0])
        if (parts[1]) info.load5 = Number(parts[1])
        if (parts[2]) info.load15 = Number(parts[2])
      }
      if (lines[1]) info.cores = Number(lines[1].trim()) || undefined
      return info
    },

    currentIme: async (): Promise<string | null> => {
      const { stdout } = await this.shell.exec('settings get secure default_input_method')
      const ime = stdout.trim()
      return ime && ime !== 'null' ? ime : null
    },

    killPid: async (pid: number) => {
      await this.shell.exec(`kill ${pid}`)
    },
  }

  async logcat(filter?: string): Promise<SpawnedProcess> {
    const cmd = filter ? `logcat ${filter}` : 'logcat'
    return this.shell.spawn(cmd)
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\''`)}'`
}

/**
 * 解析 `dumpsys package <pkg>` 输出。歗不全面但覆盖常用字段。
 */
function parsePackageDumpsys(pkg: string, out: string): PackageInfo {
  const get = (re: RegExp): string | undefined => out.match(re)?.[1]?.trim()
  const info: PackageInfo = { packageName: pkg, isSystem: false }
  info.versionName = get(/\bversionName=([^\s]+)/)
  const vc = get(/\bversionCode=(\d+)/)
  if (vc) info.versionCode = Number(vc)
  info.installer = get(/\binstallerPackageName=([^\s]+)/)
  info.codePath = get(/\bcodePath=([^\s]+)/)
  const tsdk = get(/\btargetSdk=(\d+)/); if (tsdk) info.targetSdk = Number(tsdk)
  const msdk = get(/\bminSdk=(\d+)/); if (msdk) info.minSdk = Number(msdk)
  const uid = get(/\buserId=(\d+)/); if (uid) info.uid = Number(uid)
  info.firstInstallTime = parseDateMs(get(/\bfirstInstallTime=([^\n]+)/))
  info.lastUpdateTime = parseDateMs(get(/\blastUpdateTime=([^\n]+)/))
  if (info.codePath && /^\/system\//.test(info.codePath)) info.isSystem = true
  if (/\bflags=\[[^\]]*\bSYSTEM\b/i.test(out)) info.isSystem = true
  const en = get(/\benabled=(\d+)/)
  info.enabled = en !== undefined ? en !== '0' : true
  return info
}

function parseDateMs(s: string | undefined): number | undefined {
  if (!s) return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

function mapBatteryStatus(code: string | undefined): string | undefined {
  if (!code) return undefined
  return ({
    '1': 'Unknown', '2': 'Charging', '3': 'Discharging',
    '4': 'Not charging', '5': 'Full',
  } as Record<string, string>)[code] ?? code
}

function mapBatteryHealth(code: string | undefined): string | undefined {
  if (!code) return undefined
  return ({
    '1': 'Unknown', '2': 'Good', '3': 'Overheat', '4': 'Dead',
    '5': 'Over voltage', '6': 'Unspecified failure', '7': 'Cold',
  } as Record<string, string>)[code] ?? code
}

function mapBatteryPlugged(code: string | undefined): string | undefined {
  if (!code) return undefined
  return ({ '0': 'None', '1': 'AC', '2': 'USB', '4': 'Wireless' } as Record<string, string>)[code] ?? code
}

// ============ 工厂 + 注册表 ============

const deviceApis = new Map<string, DeviceAPI>()

export function getOrCreateDevice(conn: AdbConnection): DeviceAPI {
  let api = deviceApis.get(conn.info.id)
  if (!api) {
    api = new AdbDeviceAPI(conn)
    deviceApis.set(conn.info.id, api)
  }
  return api
}

export function removeDevice(id: string) {
  deviceApis.delete(id)
}

export function getDevice(id: string): DeviceAPI | undefined {
  return deviceApis.get(id)
}
