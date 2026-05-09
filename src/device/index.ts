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

export type SettingsNamespace = 'system' | 'secure' | 'global'

export interface ForwardSpec {
  local: string   // 如 'tcp:6100'
  remote: string  // 如 'tcp:7000' / 'localabstract:foo' / 'jdwp:1234'
}

export interface InstallOptions {
  /** -r 覆盖安装 */
  replace?: boolean
  /** -d 允许降级 */
  downgrade?: boolean
  /** -t 允许测试 apk */
  test?: boolean
  /** -g 授予全部 runtime 权限 */
  grantAll?: boolean
  /** --user <id> */
  user?: number
  /** 额外标志 */
  extra?: string[]
}

export interface IntentSpec {
  /** -a ACTION */
  action?: string
  /** -d DATA_URI */
  data?: string
  /** -t MIME */
  mime?: string
  /** -c CATEGORY（可多） */
  categories?: string[]
  /** 目标 pkg/Component */
  component?: string  // 'pkg/.Activity' or 'pkg/full.Activity'
  /** 包名 */
  pkg?: string
  /** --es / --ei / --ez / --el / --ef / --eu key=value */
  extras?: Record<string, string | number | boolean | { type: 'uri' | 'string' | 'int' | 'long' | 'float' | 'bool'; value: string | number | boolean }>
  /** -f FLAG（十进制 int，多个 通过 |） */
  flags?: number
  /** 原始更多参数（不解析） */
  raw?: string[]
}

export interface LogcatOptions {
  /** priority filter tag：Tag:V|D|I|W|E|F|S，多个用数组；或直接传 filterSpec 字符串 */
  filters?: string[]
  /** 只拉某个 pid */
  pid?: number
  /** 日志 buffer：main/system/crash/events/radio/all */
  buffer?: 'main' | 'system' | 'crash' | 'events' | 'radio' | 'all' | string
  /** 格式：brief/process/tag/thread/time/threadtime/long */
  format?: string
  /** 只拉最后 N 行后退出 */
  tail?: number
}

export interface DeviceAPI {
  readonly id: string

  fs: {
    ls(path: string): Promise<FileEntry[]>
    read(path: string): Promise<Uint8Array>
    readText(path: string, encoding?: string): Promise<string>
    write(path: string, data: Uint8Array | string): Promise<void>
    /** 分块写入，用于大文仸拖拽上传；返回可抹的 progress stream */
    writeStream(path: string, size: number): Promise<{
      write(chunk: Uint8Array): Promise<void>
      close(): Promise<void>
      abort(): Promise<void>
    }>
    stat(path: string): Promise<FileEntry | null>
    mkdir(path: string, recursive?: boolean): Promise<void>
    rm(path: string, recursive?: boolean): Promise<void>
    /** 重命名 / 移动（mv） */
    rename(from: string, to: string): Promise<void>
    /** 复制文件或目录（cp -a） */
    copy(from: string, to: string): Promise<void>
    /** 目录总大小（字节）；du -s 结果×1024 */
    dirSize(path: string): Promise<number>
    /** 简单的磁盘统计（/sdcard 所在分区的 df -k） */
    diskUsage(path: string): Promise<{ totalBytes: number; usedBytes: number; availBytes: number }>
  }

  shell: {
    /**
     * 一次性运行 shell 命令并等它退出。stdout/stderr/exitCode 一起返。
     * 默认使用 shell v2 protocol；老设备 fallback v1。
     */
    exec(cmd: string): Promise<ExecResult>
    /** 启动一个 long-running process，返 stdin/stdout/stderr/exit/kill */
    spawn(cmd: string): Promise<SpawnedProcess>
    /** 换一个顺手的 run 形式：只拿 stdout。失败就抛，不用手动查 exitCode。 */
    run(cmd: string): Promise<string>
    /** 执行并反序列化为 JSON（stdout trim + parse）。失败抛。 */
    json<T = unknown>(cmd: string): Promise<T>
    /** su -c wrapper，有 root 用。不能 root 设备会抛。 */
    su(cmd: string): Promise<ExecResult>
  }

  input: {
    tap(x: number, y: number): Promise<void>
    swipe(x1: number, y1: number, x2: number, y2: number, durationMs?: number): Promise<void>
    text(s: string): Promise<void>
    key(keycode: number | string): Promise<void>
    /** 长按 */
    longPress(x: number, y: number, durationMs?: number): Promise<void>
    /** 连续按键（例如导航几次倒退） */
    keys(codes: Array<number | string>, intervalMs?: number): Promise<void>
    /** sendevent raw event（高级） */
    sendevent(device: string, type: number, code: number, value: number): Promise<void>
    /** 获取所有输入设备 */
    devices(): Promise<Array<{ path: string; name: string }>>
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
    /** 屏幕录制，返回可关闭的 session；size 如 '720x1280'，rate bitrate kbit/s */
    record(opts?: { size?: string; bitRate?: number; timeLimitSec?: number; remotePath?: string }): Promise<{
      /** 设备上的录制路径（默认 /sdcard/screenrecord-<ts>.mp4） */
      path: string
      stop(): Promise<void>
      /** 停后从设备拉回为 Uint8Array */
      pull(): Promise<Uint8Array>
    }>
    /** 显示开关 */
    wakeUp(): Promise<void>
    sleep(): Promise<void>
    /** 当前亮度 0-100 */
    getBrightness(): Promise<number | null>
    setBrightness(percent: number): Promise<void>
    /** 旋转 0/90/180/270 */
    setRotation(degrees: 0 | 90 | 180 | 270): Promise<void>
    /** 延迟灭屏时长（毫秒）读与写 */
    getOffTimeout(): Promise<number>
    setOffTimeout(ms: number): Promise<void>
  }

  app: {
    /** 包名数组（含 system apps） */
    list(opts?: { system?: boolean; thirdParty?: boolean; user?: number }): Promise<string[]>
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
    /** 安装 apk。支持 Uint8Array/Blob/path 三种输入；后者走设备上已在的路径直接 pm install */
    install(source: Uint8Array | Blob | { devicePath: string }, opts?: InstallOptions): Promise<void>
    /** split APKs（install-multiple） */
    installMulti(sources: Array<Uint8Array | Blob | { devicePath: string }>, opts?: InstallOptions): Promise<void>
    /** 某包当前 permission 状态 */
    permissions(pkg: string): Promise<Array<{ name: string; granted: boolean }>>
    /** 某包的 activities / services / receivers / providers 列表 */
    components(pkg: string): Promise<{
      activities: string[]
      services: string[]
      receivers: string[]
      providers: string[]
    }>
    /** 应用默认 launch intent 组件（方便用于 am start） */
    launcherComponent(pkg: string): Promise<string | null>
    /** 解析与某个 intent 匹配的组件（pm resolve） */
    resolve(intent: IntentSpec): Promise<string[]>
    /** 清掉应用 cache（不抹 data） */
    trimCache(pkg: string): Promise<void>
    /** pm path <pkg>：查 apk 路径（方便 pull） */
    apkPaths(pkg: string): Promise<string[]>
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
    /** 当前包/任意包的 layer 分组视图 */
    layersForPackage(pkg?: string): Promise<{ pkg: string; matched: number; visible: number; layers: LayerInfo['layers'] }>
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

    /** 审计 dumpsys service 列表 */
    services(): Promise<string[]>
    /** dumpsys <service> 原文 */
    dumpsys(service: string, args?: string[]): Promise<string>
    /** 执行 logcat（可过滤），返 spawned process */
    logcat(opts?: LogcatOptions | string): Promise<SpawnedProcess>
    /** getevent raw event stream */
    getevent(devicePath?: string): Promise<SpawnedProcess>
    /** 设备型号/SN/abi/SDK 通用快查 */
    summary(): Promise<{
      model?: string; brand?: string; manufacturer?: string; serial?: string
      sdk?: number; androidVersion?: string; abis?: string[]; density?: number
      displaySize?: { width: number; height: number }
      bootId?: string; uptime?: number
    }>
    /** 上电时长 uptime 秒 */
    uptime(): Promise<number>
  }

  /** am 系列。intent 组合器 + 常见 shortcut */
  am: {
    /** am start -n pkg/.Activity + intent */
    start(intent: IntentSpec, opts?: { waitForLaunch?: boolean; user?: number }): Promise<ExecResult>
    /** am startservice */
    startService(intent: IntentSpec): Promise<ExecResult>
    /** am broadcast */
    broadcast(intent: IntentSpec): Promise<ExecResult>
    /** am kill / kill-all，支持包名 */
    kill(pkg: string): Promise<void>
    killAll(): Promise<void>
    /** am force-stop */
    forceStop(pkg: string): Promise<void>
    /** am crash 制造崩溃 */
    crash(pkg: string): Promise<void>
    /** am to-uri（绝大多时候用不到，保留） */
    toUri(intent: IntentSpec): Promise<string>
    /** am set-standby-bucket */
    setStandby(pkg: string, bucket: 'active' | 'working_set' | 'frequent' | 'rare' | 'restricted'): Promise<void>
    /** am monitor 监听 crash/anr（long-running） */
    monitor(): Promise<SpawnedProcess>
  }

  /** pm 系列。与 app 不重复的 low-level 操作 */
  pm: {
    /** pm list features */
    features(): Promise<string[]>
    /** pm list libraries */
    libraries(): Promise<string[]>
    /** pm list instrumentation */
    instrumentations(): Promise<Array<{ target: string; component: string }>>
    /** pm list users */
    users(): Promise<Array<{ id: number; name: string; flags: string }>>
    /** pm get-max-users */
    maxUsers(): Promise<number>
    /** pm path <pkg>（第一个 apk） */
    path(pkg: string): Promise<string | null>
    /** pm dump <pkg> 原文 */
    dump(pkg: string): Promise<string>
  }

  /** settings system|secure|global 读写 */
  settings: {
    get(ns: SettingsNamespace, key: string): Promise<string | null>
    put(ns: SettingsNamespace, key: string, value: string): Promise<void>
    delete(ns: SettingsNamespace, key: string): Promise<void>
    list(ns: SettingsNamespace): Promise<Record<string, string>>
  }

  /** getprop / setprop 单独托管 */
  prop: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    all(): Promise<Record<string, string>>
  }

  /** wm: WindowManager */
  wm: {
    size(): Promise<{ width: number; height: number; override?: { width: number; height: number } }>
    setSize(width: number, height: number): Promise<void>
    resetSize(): Promise<void>
    density(): Promise<{ physical: number; override?: number }>
    setDensity(dpi: number): Promise<void>
    resetDensity(): Promise<void>
    overscan(left: number, top: number, right: number, bottom: number): Promise<void>
    resetOverscan(): Promise<void>
    /** wm user-rotation lock/unlock */
    setUserRotation(mode: 'lock' | 'free', degrees?: 0 | 1 | 2 | 3): Promise<void>
  }

  /** content provider CRUD */
  content: {
    query(uri: string, opts?: { projection?: string[]; where?: string; sort?: string; user?: number }): Promise<string>
    insert(uri: string, values: Record<string, string | number | boolean | null>, opts?: { user?: number }): Promise<string>
    update(uri: string, values: Record<string, string | number | boolean | null>, opts?: { where?: string; user?: number }): Promise<string>
    delete(uri: string, opts?: { where?: string; user?: number }): Promise<string>
    call(uri: string, method: string, arg?: string, extras?: Record<string, string | number | boolean>): Promise<string>
  }

  /** svc: 系统服务开关（wifi / data / bluetooth / usb / nfc 等） */
  svc: {
    wifi(on: boolean): Promise<void>
    data(on: boolean): Promise<void>
    bluetooth(on: boolean): Promise<void>
    nfc(on: boolean): Promise<void>
    /** svc power stayon true|usb|ac|wireless|false */
    stayOn(mode: boolean | 'usb' | 'ac' | 'wireless'): Promise<void>
    /** svc power reboot [mode] */
    reboot(mode?: 'recovery' | 'bootloader' | 'sideload' | 'fastboot'): Promise<void>
  }

  /** 网络相关：socket connect / reverse / 接口 */
  net: {
    /**
     * 打开一个 ADB socket，等价于 `adb forward` 动态版本。
     * WebUSB 宅景下不需要 forward list/add：每个 socket 本来就是直接对 device 开。
     */
    connect(service: string): Promise<{
      readable: RS<Uint8Array>
      writable: WS<Uint8Array>
      close(): Promise<void>
    }>
    /** 现有 reverse tunnel 列表 */
    reverseList(): Promise<Array<{ local: string; remote: string }>>
    /**
     * 添加 reverse tunnel：device 上某 port 连入时，回调 handler，
     * handler 拿到的是一个类流的 socket 对象。
     */
    reverse(deviceAddress: string, handler: (socket: {
      readable: RS<Uint8Array>
      writable: WS<Uint8Array>
      close(): Promise<void>
    }) => void | Promise<void>, localAddress?: string): Promise<string>
    reverseRemove(deviceAddress: string): Promise<void>
    reverseRemoveAll(): Promise<void>
    /** ifconfig / ip link 打包：接口列表 */
    interfaces(): Promise<Array<{ name: string; ipv4?: string; ipv6?: string; mac?: string; mtu?: number; up: boolean }>>
    /** ping */
    ping(host: string, count?: number): Promise<{ transmitted: number; received: number; avgMs?: number; raw: string }>
    /** netstat */
    netstat(flags?: string): Promise<string>
  }

  /** 电源 / 结屏 等 */
  power: {
    /** 重启（如 mode 传 bootloader/recovery） */
    reboot(mode?: 'recovery' | 'bootloader' | 'sideload' | 'fastboot'): Promise<void>
    /** 关机 */
    shutdown(): Promise<void>
    /** 锁屏 */
    lock(): Promise<void>
    /** 唪醒 */
    wake(): Promise<void>
    /** 是否交流充电 */
    isInteractive(): Promise<boolean>
    /** 设备打开充电模拟 */
    setCharging(plugged: boolean): Promise<void>
    /** 电池模拟 reset */
    resetBattery(): Promise<void>
  }

  /** logcat 单独接口（精细版本） */
  log: {
    spawn(opts?: LogcatOptions): Promise<SpawnedProcess>
    /** 仅取最后 N 行，不常驻 */
    tail(opts?: LogcatOptions & { lines?: number }): Promise<string>
    /** 清空日志 buffer */
    clear(): Promise<void>
    /** buffer 治理：查/设 size */
    bufferSize(kb?: number): Promise<string>
  }

  /** 多媒体测试便捷 */
  media: {
    volumeUp(): Promise<void>
    volumeDown(): Promise<void>
    mute(): Promise<void>
    play(): Promise<void>
    pause(): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    setMediaVolume(stream: 'ring' | 'music' | 'alarm' | 'voice_call' | 'notification' | 'system', value: number): Promise<void>
  }

  /**
   * 逃生舱 / 扩展点：业务层想这个封装没盖到的能力，
   * 拿到原生 connection、原生 adb、动态 socket / sync 也能自己来。
   * 不要为“只为了快”绕过封装 —— 只在真的缺能力时用；下一次应该回流到封装层。
   */
  raw: {
    /** 工原生 transport connection（含 DeviceInfo） */
    readonly connection: AdbConnection
    /** @yume-chan/adb 原生对象 */
    readonly adb: AdbConnection['adb']
    /** 打开一个任意 ADB socket（service 如 'shell:cat /proc/meminfo' / 'tcp:9999'） */
    createSocket(service: string): Promise<{
      readable: RS<Uint8Array>
      writable: WS<Uint8Array>
      close(): Promise<void>
    }>
    /** 直接开 sync session（调用完一定要 dispose） */
    openSync(): Promise<{
      read(path: string): RS<Uint8Array>
      write(args: { filename: string; file: RS<Uint8Array>; mode?: number; mtime?: number }): Promise<void>
      opendir(path: string): AsyncIterable<unknown>
      lstat(path: string): Promise<unknown>
      dispose(): Promise<void>
    }>
  }

  /**
   * 添加自定义命名空间 / 自定义方法。返回注入的对象；下次 `device.<name>` 即可用。
   * 例子：
   *   device.extend('scrcpy', (d) => ({
   *     start: () => d.shell.spawn('scrcpy ...'),
   *   }))
   *   await device.scrcpy.start()
   */
  extend<T extends object>(name: string, factory: (device: DeviceAPI) => T): T

  /** 历史兼容 shortcut：等价于 `log.spawn()` */
  logcat(filter?: string | LogcatOptions): Promise<SpawnedProcess>
}

// ============ 实现：基于 adb connection ============

class AdbDeviceAPI implements DeviceAPI {
  readonly id: string
  readonly raw!: DeviceAPI['raw']
  constructor(private conn: AdbConnection) {
    this.id = conn.info.id
    // raw 必须在构造函数里初始化：ES2022 + useDefineForClassFields=true 下，
    // 类字段初始化器会先于 `private conn` 参数属性赋值执行，
    // 那时 `this.conn` 还是 undefined，放在字段初始化器里会炸。
    const c = conn
    ;(this as { raw: DeviceAPI['raw'] }).raw = {
      connection: c,
      adb: c.adb,
      createSocket: async (service: string) => {
        const socket = await c.adb.createSocket(service)
        return {
          readable: socket.readable as unknown as RS<Uint8Array>,
          writable: socket.writable as unknown as WS<Uint8Array>,
          close: async () => { await socket.close() },
        }
      },
      openSync: async () => {
        const sync = await c.adb.sync()
        return sync as unknown as {
          read(path: string): RS<Uint8Array>
          write(args: { filename: string; file: RS<Uint8Array>; mode?: number; mtime?: number }): Promise<void>
          opendir(path: string): AsyncIterable<unknown>
          lstat(path: string): Promise<unknown>
          dispose(): Promise<void>
        }
      },
    }
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

    writeStream: async (path: string, _size: number) => {
      const sync = await this.conn.adb.sync()
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const source = new ReadableStream<Uint8Array>({
        start(c) { controller = c },
      })
      // sync.write 返回的是 Promise（流关闭才 resolve），并行跑
      const writePromise = sync.write({ filename: path, file: source })
        .catch((err: unknown) => { throw err })
      let closed = false
      return {
        async write(chunk: Uint8Array) {
          controller.enqueue(chunk)
        },
        close: async () => {
          if (closed) return
          closed = true
          controller.close()
          await writePromise
          await sync.dispose()
        },
        abort: async () => {
          if (closed) return
          closed = true
          try { controller.error(new Error('aborted')) } catch { /* ignore */ }
          try { await writePromise } catch { /* ignore */ }
          await sync.dispose()
        },
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

    rename: async (from: string, to: string) => {
      const res = await this.shell.exec(`mv ${shellQuote(from)} ${shellQuote(to)}`)
      if (res.exitCode !== 0) throw new Error(res.stderr || `mv failed (exit ${res.exitCode})`)
    },

    copy: async (from: string, to: string) => {
      // -a 保留属性 + 递归；-T 避免在目标已存在时作为子目录
      const res = await this.shell.exec(`cp -a ${shellQuote(from)} ${shellQuote(to)}`)
      if (res.exitCode !== 0) throw new Error(res.stderr || `cp failed (exit ${res.exitCode})`)
    },

    dirSize: async (path: string): Promise<number> => {
      // du -sk 输出是 KB
      const { stdout, exitCode } = await this.shell.exec(`du -sk ${shellQuote(path)}`)
      if (exitCode !== 0) return 0
      const m = stdout.trim().match(/^(\d+)/)
      return m ? parseInt(m[1], 10) * 1024 : 0
    },

    diskUsage: async (path: string) => {
      const { stdout } = await this.shell.exec(`df -k ${shellQuote(path)}`)
      // Output: Filesystem 1K-blocks Used Avail Use% Mounted on
      const lines = stdout.trim().split('\n')
      const data = lines[lines.length - 1] || ''
      const cols = data.split(/\s+/)
      // Android df: <fs> <total> <used> <avail> <use%> <mount>
      const total = parseInt(cols[1], 10) || 0
      const used = parseInt(cols[2], 10) || 0
      const avail = parseInt(cols[3], 10) || 0
      return { totalBytes: total * 1024, usedBytes: used * 1024, availBytes: avail * 1024 }
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

    run: async (cmd: string): Promise<string> => {
      const { stdout, stderr, exitCode } = await this.shell.exec(cmd)
      if (exitCode !== 0) throw new Error(`[$${exitCode}] ${cmd}\n${stderr || stdout}`)
      return stdout
    },

    json: async <T = unknown>(cmd: string): Promise<T> => {
      const text = await this.shell.run(cmd)
      return JSON.parse(text.trim()) as T
    },

    su: async (cmd: string): Promise<ExecResult> => {
      const { stdout, stderr, exitCode } = await this.shell.exec(`su -c ${shellQuote(cmd)}`)
      if (/inaccessible or not found|Permission denied|su: not found/i.test(stderr + stdout)) {
        throw new Error('设备不支持 su / 未 root')
      }
      return { stdout, stderr, exitCode }
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
    longPress: async (x: number, y: number, durationMs = 600) => {
      await this.shell.exec(`input swipe ${x} ${y} ${x} ${y} ${durationMs}`)
    },
    keys: async (codes: Array<number | string>, intervalMs = 80) => {
      for (let i = 0; i < codes.length; i++) {
        await this.shell.exec(`input keyevent ${codes[i]}`)
        if (i < codes.length - 1 && intervalMs > 0) {
          await new Promise((r) => setTimeout(r, intervalMs))
        }
      }
    },
    sendevent: async (device: string, type: number, code: number, value: number) => {
      await this.shell.exec(`sendevent ${shellQuote(device)} ${type} ${code} ${value}`)
    },
    devices: async (): Promise<Array<{ path: string; name: string }>> => {
      const { stdout } = await this.shell.exec('getevent -p')
      const out: Array<{ path: string; name: string }> = []
      for (const block of stdout.split(/(?=^add device)/m)) {
        const path = block.match(/^add device \d+: (\S+)/m)?.[1]
        const name = block.match(/\s+name:\s+"([^"]+)"/)?.[1]
        if (path) out.push({ path, name: name ?? path })
      }
      return out
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
    record: async (opts?: { size?: string; bitRate?: number; timeLimitSec?: number; remotePath?: string }) => {
      const remotePath = opts?.remotePath ?? `/sdcard/screenrecord-${Date.now()}.mp4`
      const parts = ['screenrecord']
      if (opts?.size) parts.push('--size', opts.size)
      if (opts?.bitRate) parts.push('--bit-rate', String(opts.bitRate * 1000))
      if (opts?.timeLimitSec) parts.push('--time-limit', String(opts.timeLimitSec))
      parts.push(shellQuote(remotePath))
      const proc = await this.shell.spawn(parts.join(' '))
      let stopped = false
      return {
        path: remotePath,
        stop: async () => {
          if (stopped) return
          stopped = true
          try { await proc.kill() } catch { /* ignore */ }
          try { await proc.exit } catch { /* ignore */ }
          // 给 muxer 回写点时间
          await new Promise((r) => setTimeout(r, 800))
        },
        pull: async () => {
          const bytes = await this.fs.read(remotePath)
          return bytes
        },
      }
    },
    wakeUp: async () => { await this.shell.exec('input keyevent KEYCODE_WAKEUP') },
    sleep: async () => { await this.shell.exec('input keyevent KEYCODE_SLEEP') },
    getBrightness: async () => {
      const v = await this.settings.get('system', 'screen_brightness')
      if (!v) return null
      const n = Number(v)
      return Number.isFinite(n) ? Math.round(n / 255 * 100) : null
    },
    setBrightness: async (percent: number) => {
      const pct = Math.max(0, Math.min(100, percent))
      const raw = Math.round(pct / 100 * 255)
      await this.settings.put('system', 'screen_brightness_mode', '0') // 手动模式
      await this.settings.put('system', 'screen_brightness', String(raw))
    },
    setRotation: async (deg: 0 | 90 | 180 | 270) => {
      const map = { 0: 0, 90: 1, 180: 2, 270: 3 } as const
      await this.settings.put('system', 'accelerometer_rotation', '0')
      await this.settings.put('system', 'user_rotation', String(map[deg]))
    },
    getOffTimeout: async () => {
      const v = await this.settings.get('system', 'screen_off_timeout')
      return v ? Number(v) || 0 : 0
    },
    setOffTimeout: async (ms: number) => {
      await this.settings.put('system', 'screen_off_timeout', String(Math.max(0, Math.floor(ms))))
    },
  }

  // ---- app ----

  app = {
    list: async (opts?: { system?: boolean; thirdParty?: boolean; user?: number }): Promise<string[]> => {
      const flags: string[] = []
      if (opts?.thirdParty) flags.push('-3')
      else if (opts?.system) flags.push('-s')
      if (opts?.user !== undefined) flags.push(`--user ${opts.user}`)
      const { stdout } = await this.shell.exec(`pm list packages ${flags.join(' ')}`.trim())
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

    install: async (source: Uint8Array | Blob | { devicePath: string }, opts?: InstallOptions) => {
      const flags = buildInstallFlags(opts)
      // 三种输入形式
      if ((source as { devicePath: string }).devicePath) {
        const { devicePath } = source as { devicePath: string }
        const res = await this.shell.exec(`pm install ${flags} ${shellQuote(devicePath)}`)
        if (!/Success/.test(res.stdout) || res.exitCode !== 0) {
          throw new Error(res.stdout + res.stderr || 'pm install 失败')
        }
        return
      }
      const bytes = source instanceof Uint8Array
        ? source
        : new Uint8Array(await (source as Blob).arrayBuffer())
      // 先 push 到 /data/local/tmp，再 pm install。比 exec-in stdin 稳（很多驱动在 WebUSB 下立 dead）
      const tmp = `/data/local/tmp/dive-install-${Date.now()}.apk`
      await this.fs.write(tmp, bytes)
      try {
        const res = await this.shell.exec(`pm install ${flags} ${shellQuote(tmp)}`)
        if (!/Success/.test(res.stdout) || res.exitCode !== 0) {
          throw new Error(res.stdout + res.stderr || 'pm install 失败')
        }
      } finally {
        await this.fs.rm(tmp).catch(() => { /* ignore */ })
      }
    },

    installMulti: async (sources: Array<Uint8Array | Blob | { devicePath: string }>, opts?: InstallOptions) => {
      const flags = buildInstallFlags(opts)
      // 在设备端准备 session 上传
      const sizes: number[] = []
      const devicePaths: string[] = []
      const tmpsToClean: string[] = []
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]
        if ((src as { devicePath: string }).devicePath) {
          devicePaths.push((src as { devicePath: string }).devicePath)
          continue
        }
        const bytes = src instanceof Uint8Array
          ? src
          : new Uint8Array(await (src as Blob).arrayBuffer())
        const p = `/data/local/tmp/dive-install-${Date.now()}-${i}.apk`
        await this.fs.write(p, bytes)
        devicePaths.push(p)
        tmpsToClean.push(p)
        sizes.push(bytes.byteLength)
      }
      try {
        // pm install-create / install-write / install-commit
        const create = await this.shell.exec(`pm install-create ${flags}`)
        const sessionId = create.stdout.match(/\[(\d+)\]/)?.[1]
        if (!sessionId) throw new Error(`install-create 失败: ${create.stdout}${create.stderr}`)
        for (let i = 0; i < devicePaths.length; i++) {
          const sz = sizes[i] ?? 0
          const name = `split_${i}.apk`
          const writeCmd = sz
            ? `pm install-write -S ${sz} ${sessionId} ${name} ${shellQuote(devicePaths[i])}`
            : `pm install-write ${sessionId} ${name} ${shellQuote(devicePaths[i])}`
          const w = await this.shell.exec(writeCmd)
          if (w.exitCode !== 0) {
            await this.shell.exec(`pm install-abandon ${sessionId}`).catch(() => { /* ignore */ })
            throw new Error(`install-write 失败: ${w.stdout}${w.stderr}`)
          }
        }
        const commit = await this.shell.exec(`pm install-commit ${sessionId}`)
        if (!/Success/.test(commit.stdout) || commit.exitCode !== 0) {
          throw new Error(`install-commit 失败: ${commit.stdout}${commit.stderr}`)
        }
      } finally {
        for (const p of tmpsToClean) await this.fs.rm(p).catch(() => { /* ignore */ })
      }
    },

    permissions: async (pkg: string): Promise<Array<{ name: string; granted: boolean }>> => {
      const out = await this.pm.dump(pkg)
      const perms: Array<{ name: string; granted: boolean }> = []
      // install permissions:
      //   android.permission.INTERNET: granted=true
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*(android\.permission\.[\w.]+|com\.[\w.]+\.permission\.[\w.]+):\s*granted=(true|false)/)
        if (m) perms.push({ name: m[1], granted: m[2] === 'true' })
      }
      return perms
    },

    components: async (pkg: string) => {
      const out = await this.pm.dump(pkg)
      const section = (head: string): string[] => {
        const re = new RegExp(`${head}:[\\s\\S]*?(?=\\n\\s{2}[A-Za-z ]+:|$)`, 'g')
        const m = out.match(re)?.[0] ?? ''
        const names = new Set<string>()
        // "    <component>com.pkg/.Main</component>" 或 "    Action: … Component: com.pkg/.Main"
        for (const line of m.split('\n')) {
          const c = line.match(/(\w[\w.]*\/[\w.$]+)/)?.[1]
          if (c) names.add(c)
        }
        return [...names]
      }
      return {
        activities: section('Activity Resolver Table'),
        services: section('Service Resolver Table'),
        receivers: section('Receiver Resolver Table'),
        providers: section('Provider Resolver Table'),
      }
    },

    launcherComponent: async (pkg: string): Promise<string | null> => {
      const { stdout } = await this.shell.exec(
        `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${shellQuote(pkg)}`,
      )
      const m = stdout.match(/^[\w.]+\/[\w.$]+$/m)
      return m ? m[0] : null
    },

    resolve: async (intent: IntentSpec): Promise<string[]> => {
      const args = buildIntentArgs(intent)
      const { stdout } = await this.shell.exec(`cmd package resolve-activity --brief ${args}`)
      return stdout.split('\n').map((l) => l.trim()).filter((l) => /^[\w.]+\/[\w.$]+$/.test(l))
    },

    trimCache: async (pkg: string) => {
      await this.shell.exec(`pm trim-caches 512M`)
      await this.shell.exec(`pm clear-cached ${shellQuote(pkg)}`).catch(() => { /* ignore 老版本 */ })
    },

    apkPaths: async (pkg: string): Promise<string[]> => {
      const { stdout } = await this.shell.exec(`pm path ${shellQuote(pkg)}`)
      return stdout.split('\n').map((l) => l.trim())
        .filter((l) => l.startsWith('package:'))
        .map((l) => l.slice('package:'.length))
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
      // SurfaceFlinger 的 layer 树新版 (Android 14+ trunk_stable) 里一大堆是 RequestedLayerState
      // 无 buffer 的内部 container，真正 "用户看得到" 的是 WindowManager 维护的 window。
      // 所以：total 还是用 SurfaceFlinger（全部 layer 节点），visible 通过 `dumpsys window windows` 里
      // isOnScreen / mHasSurface / canBeImeTarget 等维度夹计。
      const [list, full, windows] = await Promise.all([
        this.shell.exec('dumpsys SurfaceFlinger --list').catch(() => ({ stdout: '' })),
        this.shell.exec('dumpsys SurfaceFlinger').catch(() => ({ stdout: '' })),
        this.shell.exec('dumpsys window windows').catch(() => ({ stdout: '' })),
      ])

      const names = list.stdout.split('\n').map((l) => l.trim()).filter(Boolean)

      // --- 1) 新版 trunk_stable：在完整 dumpsys 里搜 "isVisible=true" / "flags=0 ... visible" 等 ---
      // 新版的 “RequestedLayerState{<hash> <name>#<id>}” 形式，对应的输出里会有
      //    name=StatusBar ... isVisible=true
      // 或
      //    Layer { … name="X" … visible=true … }
      // 旧版（A13-）：+ BufferLayer 0x… (NAME)
      const visibleNames = new Set<string>()

      // 旧版 heuristic
      for (const line of full.stdout.split('\n')) {
        const m = line.match(/^\s*\+\s*(?:BufferLayer|ColorLayer|ContainerLayer|EffectLayer|Layer)\s+\S+\s+\(([^)]+)\)/)
        if (m) visibleNames.add(m[1])
      }

      // --- 2) WindowManager 视角：真正 onscreen 的 window ---
      // 一段样本：
      //   Window #5 Window{abc 0 com.baidu.searchbox/com.baidu.….MainActivity}:
      //     mDisplayId=0 ...
      //     mHasSurface=true mShownAlpha=1.0 alpha=1.0 transformation=Identity
      //     isOnScreen=true isVisible=true
      const winRegex = /Window #\d+ Window\{[^}]*\s+([^\s}]+)\}:([\s\S]*?)(?=\nWindow #|\n\s*mGlobalConfiguration|\n  mLastWakeLockHoldingWindow|\Z)/g
      let match: RegExpExecArray | null
      const winVisible = new Set<string>()
      while ((match = winRegex.exec(windows.stdout)) !== null) {
        const title = match[1]
        const body = match[2]
        const hasSurface = /mHasSurface=true/.test(body)
        const onScreen = /isOnScreen=true/.test(body)
        const isVis = /isVisible=true/.test(body)
        if ((hasSurface && onScreen) || isVis) {
          winVisible.add(title)
        }
      }

      // --- 3) 新版 SurfaceFlinger 输出里，name= 或 (name) 标记为 visible ---
      //   例："Layer name=StatusBar ... isVisible=true"
      //   在一段块中找 isVisible=true
      const sfBlocks = full.stdout.split(/^Layer\s+/m)
      for (const b of sfBlocks) {
        if (!/isVisible=true/.test(b)) continue
        const nm = b.match(/name="([^"]+)"/)?.[1] ?? b.match(/name=(\S+)/)?.[1]
        if (nm) visibleNames.add(nm)
      }

      // --- 融合认定：visibleNames 或 WindowManager 视角匹配 ---
      const layersOut = names.map((rawName) => {
        // 从 "RequestedLayerState{f9df1d7 DynamicIslandWindow#131 parentId=130}" 中抽取人可读名字
        const parsed = parseLayerName(rawName)
        const visible = visibleNames.has(rawName)
          || visibleNames.has(parsed)
          || winVisible.has(parsed)
          // WindowManager 里存的往往是 "pkg/Activity"，模糊包含匹配
          || [...winVisible].some((w) => parsed.includes(w) || w.includes(parsed))
        return { name: rawName, visible }
      })

      return {
        total: names.length,
        visible: layersOut.filter((l) => l.visible).length,
        layers: layersOut,
      }
    },

    layersForPackage: async (pkg?: string) => {
      const target = pkg || (await this.system.topActivity().catch(() => null))?.packageName
      if (!target) return { pkg: '', matched: 0, visible: 0, layers: [] }
      const all = await this.system.layers()
      // pkg 在 layer name 里出现的两种形式：
      //   1) 整串 "com.x.y" 出现（包名/类名）
      //   2) 最后一段 "y" （Activity 短名 如 Settings$SubSettings）
      const last = target.split('.').pop() ?? target
      const filtered = all.layers.filter((l) => l.name.includes(target) || l.name.includes(last))
      return {
        pkg: target,
        matched: filtered.length,
        visible: filtered.filter((l) => l.visible).length,
        layers: filtered,
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

    services: async (): Promise<string[]> => {
      const { stdout } = await this.shell.exec('service list')
      const svcs: string[] = []
      for (const line of stdout.split('\n')) {
        const m = line.match(/^\s*\d+\s+([\w.\-]+):/)
        if (m) svcs.push(m[1])
      }
      return svcs
    },
    dumpsys: async (service: string, args: string[] = []): Promise<string> => {
      const cmd = `dumpsys ${shellQuote(service)} ${args.map(shellQuote).join(' ')}`.trim()
      const { stdout } = await this.shell.exec(cmd)
      return stdout
    },
    logcat: async (opts?: LogcatOptions | string): Promise<SpawnedProcess> => {
      return this.log.spawn(typeof opts === 'string' ? { filters: [opts] } : opts)
    },
    getevent: async (devicePath?: string): Promise<SpawnedProcess> => {
      const cmd = devicePath ? `getevent -l ${shellQuote(devicePath)}` : 'getevent -l'
      return this.shell.spawn(cmd)
    },
    summary: async () => {
      const [props, disp, up] = await Promise.all([
        this.prop.all(),
        this.shell.exec('wm size; wm density').catch(() => ({ stdout: '' })),
        this.system.uptime().catch(() => 0),
      ])
      const abis = (props['ro.product.cpu.abilist'] ?? props['ro.product.cpu.abi'] ?? '')
        .split(',').map((s) => s.trim()).filter(Boolean)
      const sdk = Number(props['ro.build.version.sdk']) || undefined
      const size = disp.stdout.match(/(?:Override|Physical) size:\s*(\d+)x(\d+)/)
      const dens = disp.stdout.match(/(?:Override|Physical) density:\s*(\d+)/)
      return {
        model: props['ro.product.model'],
        brand: props['ro.product.brand'],
        manufacturer: props['ro.product.manufacturer'],
        serial: props['ro.serialno'],
        sdk,
        androidVersion: props['ro.build.version.release'],
        abis,
        density: dens ? Number(dens[1]) : undefined,
        displaySize: size ? { width: Number(size[1]), height: Number(size[2]) } : undefined,
        bootId: props['ro.boot.bootid'] ?? props['ro.boot.boot_id'],
        uptime: up,
      }
    },
    uptime: async (): Promise<number> => {
      const { stdout } = await this.shell.exec('cat /proc/uptime')
      return Number(stdout.trim().split(/\s+/)[0]) || 0
    },
  }

  // ---- am ----

  am = {
    start: async (intent: IntentSpec, opts?: { waitForLaunch?: boolean; user?: number }) => {
      const flags: string[] = []
      if (opts?.waitForLaunch) flags.push('-W')
      if (opts?.user !== undefined) flags.push(`--user ${opts.user}`)
      return this.shell.exec(`am start ${flags.join(' ')} ${buildIntentArgs(intent)}`.trim())
    },
    startService: async (intent: IntentSpec) =>
      this.shell.exec(`am start-foreground-service ${buildIntentArgs(intent)}`.trim()),
    broadcast: async (intent: IntentSpec) =>
      this.shell.exec(`am broadcast ${buildIntentArgs(intent)}`.trim()),
    kill: async (pkg: string) => { await this.shell.exec(`am kill ${shellQuote(pkg)}`) },
    killAll: async () => { await this.shell.exec('am kill-all') },
    forceStop: async (pkg: string) => { await this.shell.exec(`am force-stop ${shellQuote(pkg)}`) },
    crash: async (pkg: string) => { await this.shell.exec(`am crash ${shellQuote(pkg)}`) },
    toUri: async (intent: IntentSpec): Promise<string> => {
      const { stdout } = await this.shell.exec(`am to-uri ${buildIntentArgs(intent)}`.trim())
      return stdout.trim()
    },
    setStandby: async (pkg: string, bucket: 'active' | 'working_set' | 'frequent' | 'rare' | 'restricted') => {
      await this.shell.exec(`am set-standby-bucket ${shellQuote(pkg)} ${bucket}`)
    },
    monitor: async (): Promise<SpawnedProcess> => this.shell.spawn('am monitor'),
  }

  // ---- pm ----

  pm = {
    features: async (): Promise<string[]> => {
      const { stdout } = await this.shell.exec('pm list features')
      return stdout.split('\n').filter((l) => l.startsWith('feature:'))
        .map((l) => l.slice('feature:'.length).trim())
    },
    libraries: async (): Promise<string[]> => {
      const { stdout } = await this.shell.exec('pm list libraries')
      return stdout.split('\n').filter((l) => l.startsWith('library:'))
        .map((l) => l.slice('library:'.length).trim())
    },
    instrumentations: async () => {
      const { stdout } = await this.shell.exec('pm list instrumentation')
      const out: Array<{ target: string; component: string }> = []
      // instrumentation:pkg/runner (target=pkg)
      for (const line of stdout.split('\n')) {
        const m = line.match(/^instrumentation:([\w.]+\/[\w.$]+)\s*\(target=([\w.]+)\)/)
        if (m) out.push({ component: m[1], target: m[2] })
      }
      return out
    },
    users: async () => {
      const { stdout } = await this.shell.exec('pm list users')
      const out: Array<{ id: number; name: string; flags: string }> = []
      for (const line of stdout.split('\n')) {
        const m = line.match(/UserInfo\{(\d+):([^:]+):([\dA-Fa-fxX]+)\}/)
        if (m) out.push({ id: Number(m[1]), name: m[2], flags: m[3] })
      }
      return out
    },
    maxUsers: async (): Promise<number> => {
      const { stdout } = await this.shell.exec('pm get-max-users')
      return Number(stdout.match(/\d+/)?.[0] ?? '0')
    },
    path: async (pkg: string): Promise<string | null> => {
      const all = await this.app.apkPaths(pkg)
      return all[0] ?? null
    },
    dump: async (pkg: string): Promise<string> => {
      const { stdout } = await this.shell.exec(`dumpsys package ${shellQuote(pkg)}`)
      return stdout
    },
  }

  // ---- settings ----

  settings = {
    get: async (ns: SettingsNamespace, key: string): Promise<string | null> => {
      const { stdout, exitCode } = await this.shell.exec(`settings get ${ns} ${shellQuote(key)}`)
      if (exitCode !== 0) return null
      const v = stdout.trim()
      return v && v !== 'null' ? v : null
    },
    put: async (ns: SettingsNamespace, key: string, value: string) => {
      await this.shell.exec(`settings put ${ns} ${shellQuote(key)} ${shellQuote(value)}`)
    },
    delete: async (ns: SettingsNamespace, key: string) => {
      await this.shell.exec(`settings delete ${ns} ${shellQuote(key)}`)
    },
    list: async (ns: SettingsNamespace): Promise<Record<string, string>> => {
      const { stdout } = await this.shell.exec(`settings list ${ns}`)
      const out: Record<string, string> = {}
      for (const line of stdout.split('\n')) {
        const idx = line.indexOf('=')
        if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1)
      }
      return out
    },
  }

  // ---- prop ----

  prop = {
    get: async (key: string): Promise<string | null> => {
      const { stdout } = await this.shell.exec(`getprop ${shellQuote(key)}`)
      const v = stdout.trim()
      return v ? v : null
    },
    set: async (key: string, value: string) => {
      await this.shell.exec(`setprop ${shellQuote(key)} ${shellQuote(value)}`)
    },
    all: async (): Promise<Record<string, string>> => this.system.getProps(),
  }

  // ---- wm ----

  wm = {
    size: async () => {
      const { stdout } = await this.shell.exec('wm size')
      const phys = stdout.match(/Physical size:\s*(\d+)x(\d+)/)
      const over = stdout.match(/Override size:\s*(\d+)x(\d+)/)
      return {
        width: Number(phys?.[1] ?? 0),
        height: Number(phys?.[2] ?? 0),
        override: over ? { width: Number(over[1]), height: Number(over[2]) } : undefined,
      }
    },
    setSize: async (w: number, h: number) => { await this.shell.exec(`wm size ${w}x${h}`) },
    resetSize: async () => { await this.shell.exec('wm size reset') },
    density: async () => {
      const { stdout } = await this.shell.exec('wm density')
      const phys = stdout.match(/Physical density:\s*(\d+)/)
      const over = stdout.match(/Override density:\s*(\d+)/)
      return {
        physical: Number(phys?.[1] ?? 0),
        override: over ? Number(over[1]) : undefined,
      }
    },
    setDensity: async (dpi: number) => { await this.shell.exec(`wm density ${dpi}`) },
    resetDensity: async () => { await this.shell.exec('wm density reset') },
    overscan: async (l: number, t: number, r: number, b: number) => { await this.shell.exec(`wm overscan ${l},${t},${r},${b}`) },
    resetOverscan: async () => { await this.shell.exec('wm overscan reset') },
    setUserRotation: async (mode: 'lock' | 'free', degrees?: 0 | 1 | 2 | 3) => {
      await this.shell.exec(`wm user-rotation ${mode}${degrees !== undefined ? ` ${degrees}` : ''}`)
    },
  }

  // ---- content ----

  content = {
    query: async (uri: string, opts?: { projection?: string[]; where?: string; sort?: string; user?: number }) => {
      const parts = ['content query --uri', shellQuote(uri)]
      if (opts?.projection?.length) parts.push('--projection', shellQuote(opts.projection.join(':')))
      if (opts?.where) parts.push('--where', shellQuote(opts.where))
      if (opts?.sort) parts.push('--sort', shellQuote(opts.sort))
      if (opts?.user !== undefined) parts.push('--user', String(opts.user))
      const { stdout } = await this.shell.exec(parts.join(' '))
      return stdout
    },
    insert: async (uri: string, values: Record<string, string | number | boolean | null>, opts?: { user?: number }) => {
      const parts = ['content insert --uri', shellQuote(uri), ...contentBindArgs(values)]
      if (opts?.user !== undefined) parts.push('--user', String(opts.user))
      const { stdout } = await this.shell.exec(parts.join(' '))
      return stdout
    },
    update: async (uri: string, values: Record<string, string | number | boolean | null>, opts?: { where?: string; user?: number }) => {
      const parts = ['content update --uri', shellQuote(uri), ...contentBindArgs(values)]
      if (opts?.where) parts.push('--where', shellQuote(opts.where))
      if (opts?.user !== undefined) parts.push('--user', String(opts.user))
      const { stdout } = await this.shell.exec(parts.join(' '))
      return stdout
    },
    delete: async (uri: string, opts?: { where?: string; user?: number }) => {
      const parts = ['content delete --uri', shellQuote(uri)]
      if (opts?.where) parts.push('--where', shellQuote(opts.where))
      if (opts?.user !== undefined) parts.push('--user', String(opts.user))
      const { stdout } = await this.shell.exec(parts.join(' '))
      return stdout
    },
    call: async (uri: string, method: string, arg?: string, extras?: Record<string, string | number | boolean>) => {
      const parts = ['content call --uri', shellQuote(uri), '--method', shellQuote(method)]
      if (arg) parts.push('--arg', shellQuote(arg))
      if (extras) parts.push(...contentBindArgs(extras))
      const { stdout } = await this.shell.exec(parts.join(' '))
      return stdout
    },
  }

  // ---- svc ----

  svc = {
    wifi: async (on: boolean) => { await this.shell.exec(`svc wifi ${on ? 'enable' : 'disable'}`) },
    data: async (on: boolean) => { await this.shell.exec(`svc data ${on ? 'enable' : 'disable'}`) },
    bluetooth: async (on: boolean) => { await this.shell.exec(`svc bluetooth ${on ? 'enable' : 'disable'}`) },
    nfc: async (on: boolean) => { await this.shell.exec(`svc nfc ${on ? 'enable' : 'disable'}`) },
    stayOn: async (mode: boolean | 'usb' | 'ac' | 'wireless') => {
      const v = typeof mode === 'boolean' ? (mode ? 'true' : 'false') : mode
      await this.shell.exec(`svc power stayon ${v}`)
    },
    reboot: async (mode?: 'recovery' | 'bootloader' | 'sideload' | 'fastboot') => {
      await this.shell.exec(`svc power reboot${mode ? ` ${mode}` : ''}`)
    },
  }

  // ---- net ----

  net = {
    connect: async (service: string) => {
      const socket = await this.conn.adb.createSocket(service)
      return {
        readable: socket.readable as unknown as RS<Uint8Array>,
        writable: socket.writable as unknown as WS<Uint8Array>,
        close: async () => { await socket.close() },
      }
    },
    reverseList: async () => {
      const list = await this.conn.adb.reverse.list()
      return list.map((e) => ({ local: e.localName, remote: e.remoteName }))
    },
    reverse: async (
      deviceAddress: string,
      handler: (socket: { readable: RS<Uint8Array>; writable: WS<Uint8Array>; close(): Promise<void> }) => void | Promise<void>,
      localAddress?: string,
    ) => {
      return this.conn.adb.reverse.add(deviceAddress, async (rawSocket) => {
        await handler({
          readable: rawSocket.readable as unknown as RS<Uint8Array>,
          writable: rawSocket.writable as unknown as WS<Uint8Array>,
          close: async () => { await rawSocket.close() },
        })
      }, localAddress)
    },
    reverseRemove: async (deviceAddress: string) => {
      await this.conn.adb.reverse.remove(deviceAddress)
    },
    reverseRemoveAll: async () => { await this.conn.adb.reverse.removeAll() },
    interfaces: async () => {
      const { stdout } = await this.shell.exec('ip -o addr; ip -o link')
      const byName: Record<string, { name: string; ipv4?: string; ipv6?: string; mac?: string; mtu?: number; up: boolean }> = {}
      for (const line of stdout.split('\n')) {
        const mAddr = line.match(/^\d+:\s+(\S+)\s+inet6?\s+([0-9a-f:.]+)/i)
        if (mAddr) {
          const [, name, addr] = mAddr
          byName[name] ??= { name, up: true }
          if (addr.includes(':')) byName[name].ipv6 = addr.split('/')[0]
          else byName[name].ipv4 = addr.split('/')[0]
          continue
        }
        const mLink = line.match(/^\d+:\s+(\S+):\s+<([^>]+)>\s+mtu\s+(\d+).*?link\/\S+\s+([0-9a-f:]{17})?/i)
        if (mLink) {
          const [, name, flags, mtu, mac] = mLink
          const stripped = name.replace(/@.*/, '')
          byName[stripped] ??= { name: stripped, up: false }
          byName[stripped].mtu = Number(mtu)
          if (mac) byName[stripped].mac = mac
          byName[stripped].up = /UP/.test(flags) && !/NO-CARRIER/.test(flags)
        }
      }
      return Object.values(byName)
    },
    ping: async (host: string, count = 4) => {
      const { stdout } = await this.shell.exec(`ping -c ${count} -W 2 ${shellQuote(host)}`)
      const m = stdout.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+received/)
      const avg = stdout.match(/\/(\d+\.\d+)\//)?.[1]
      return {
        transmitted: Number(m?.[1] ?? 0),
        received: Number(m?.[2] ?? 0),
        avgMs: avg ? Number(avg) : undefined,
        raw: stdout,
      }
    },
    netstat: async (flags = '-tun') => {
      const { stdout } = await this.shell.exec(`netstat ${flags}`)
      return stdout
    },
  }

  // ---- power ----

  power = {
    reboot: async (mode?: 'recovery' | 'bootloader' | 'sideload' | 'fastboot') => { await this.shell.exec(`reboot${mode ? ` ${mode}` : ''}`) },
    shutdown: async () => { await this.shell.exec('reboot -p') },
    lock: async () => { await this.shell.exec('input keyevent KEYCODE_SLEEP') },
    wake: async () => { await this.shell.exec('input keyevent KEYCODE_WAKEUP') },
    isInteractive: async () => {
      const { stdout } = await this.shell.exec('dumpsys power | grep -E "mWakefulness|Display Power"')
      return /Awake|state=ON/.test(stdout)
    },
    setCharging: async (plugged: boolean) => {
      await this.shell.exec(plugged ? 'dumpsys battery set ac 1' : 'dumpsys battery unplug')
    },
    resetBattery: async () => { await this.shell.exec('dumpsys battery reset') },
  }

  // ---- log ----

  log = {
    spawn: async (opts?: LogcatOptions): Promise<SpawnedProcess> => {
      return this.shell.spawn(buildLogcatCommand(opts, /* oneShot */ false))
    },
    tail: async (opts?: LogcatOptions & { lines?: number }): Promise<string> => {
      const cmd = buildLogcatCommand(opts, /* oneShot */ true)
      const lines = opts?.lines ?? opts?.tail ?? 200
      const { stdout } = await this.shell.exec(`${cmd} | tail -n ${lines}`)
      return stdout
    },
    clear: async () => { await this.shell.exec('logcat -c') },
    bufferSize: async (kb?: number): Promise<string> => {
      if (kb === undefined) {
        const { stdout } = await this.shell.exec('logcat -g')
        return stdout
      }
      await this.shell.exec(`logcat -G ${kb}K`)
      return `set to ${kb}K`
    },
  }

  // ---- media ----

  media = {
    volumeUp: async () => { await this.input.key('KEYCODE_VOLUME_UP') },
    volumeDown: async () => { await this.input.key('KEYCODE_VOLUME_DOWN') },
    mute: async () => { await this.input.key('KEYCODE_VOLUME_MUTE') },
    play: async () => { await this.input.key('KEYCODE_MEDIA_PLAY') },
    pause: async () => { await this.input.key('KEYCODE_MEDIA_PAUSE') },
    next: async () => { await this.input.key('KEYCODE_MEDIA_NEXT') },
    prev: async () => { await this.input.key('KEYCODE_MEDIA_PREVIOUS') },
    setMediaVolume: async (stream: 'ring' | 'music' | 'alarm' | 'voice_call' | 'notification' | 'system', value: number) => {
      const streamMap: Record<string, number> = {
        voice_call: 0, system: 1, ring: 2, music: 3, alarm: 4, notification: 5,
      }
      const idx = streamMap[stream] ?? 3
      await this.shell.exec(`media volume --stream ${idx} --set ${value}`)
    },
  }

  // ---- raw 逃生舱（在 constructor 里初始化，见上） ----

  // ---- extend ----

  private _extensions = new Map<string, object>()

  extend<T extends object>(name: string, factory: (device: DeviceAPI) => T): T {
    if (!name || /[^a-zA-Z0-9_$]/.test(name)) {
      throw new Error(`extend: invalid name ${JSON.stringify(name)}`)
    }
    if (['fs','shell','input','screen','app','system','am','pm','settings','prop','wm','content','svc','net','power','log','media','raw','extend','id','logcat'].includes(name)) {
      throw new Error(`extend: name ${name} 和内置命名空间冲突`)
    }
    if (this._extensions.has(name)) return this._extensions.get(name) as T
    const obj = factory(this as unknown as DeviceAPI)
    this._extensions.set(name, obj as object)
    Object.defineProperty(this, name, { value: obj, writable: false, enumerable: true, configurable: true })
    return obj
  }

  // 历史兼容
  async logcat(filter?: string | LogcatOptions): Promise<SpawnedProcess> {
    if (typeof filter === 'string' && filter) return this.log.spawn({ filters: [filter] })
    return this.log.spawn(typeof filter === 'object' ? filter : undefined)
  }
}

function parseLayerName(raw: string): string {
  // RequestedLayerState{hash NAME#id parentId=XX}  → NAME
  // 或 RequestedLayerState{hash NAME#id}  → NAME
  const m = raw.match(/RequestedLayerState\{[^\s]+\s+([^#]+?)(?:#\d+)?(?:\s|\})/)
  if (m) return m[1]
  // 旧版：直接就是名字
  return raw
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

// ============ pm install / intent / content / logcat helpers ============

function buildInstallFlags(opts?: InstallOptions): string {
  const parts: string[] = []
  if (opts?.replace) parts.push('-r')
  if (opts?.downgrade) parts.push('-d')
  if (opts?.test) parts.push('-t')
  if (opts?.grantAll) parts.push('-g')
  if (opts?.user !== undefined) parts.push(`--user ${opts.user}`)
  if (opts?.extra?.length) parts.push(...opts.extra)
  return parts.join(' ')
}

function buildIntentArgs(intent: IntentSpec): string {
  const parts: string[] = []
  if (intent.action) parts.push('-a', shellQuote(intent.action))
  if (intent.data) parts.push('-d', shellQuote(intent.data))
  if (intent.mime) parts.push('-t', shellQuote(intent.mime))
  for (const c of intent.categories ?? []) parts.push('-c', shellQuote(c))
  if (intent.component) parts.push('-n', shellQuote(intent.component))
  else if (intent.pkg) parts.push('-p', shellQuote(intent.pkg))
  if (intent.flags) parts.push('-f', String(intent.flags))
  for (const [k, v] of Object.entries(intent.extras ?? {})) {
    if (typeof v === 'object' && v !== null && 'type' in v) {
      parts.push(extraFlagOf(v.type), shellQuote(k), shellQuote(String(v.value)))
      continue
    }
    if (typeof v === 'boolean') { parts.push('--ez', shellQuote(k), v ? 'true' : 'false'); continue }
    if (typeof v === 'number') {
      parts.push(Number.isInteger(v) ? '--ei' : '--ef', shellQuote(k), String(v))
      continue
    }
    parts.push('--es', shellQuote(k), shellQuote(String(v)))
  }
  if (intent.raw?.length) parts.push(...intent.raw)
  return parts.join(' ')
}

function extraFlagOf(t: 'uri' | 'string' | 'int' | 'long' | 'float' | 'bool'): string {
  switch (t) {
    case 'uri': return '--eu'
    case 'int': return '--ei'
    case 'long': return '--el'
    case 'float': return '--ef'
    case 'bool': return '--ez'
    case 'string':
    default: return '--es'
  }
}

function contentBindArgs(values: Record<string, string | number | boolean | null>): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(values)) {
    if (v === null) { out.push('--bind', shellQuote(`${k}:n:`)); continue }
    if (typeof v === 'boolean') { out.push('--bind', shellQuote(`${k}:b:${v}`)); continue }
    if (typeof v === 'number') {
      const tag = Number.isInteger(v) ? 'i' : 'd'
      out.push('--bind', shellQuote(`${k}:${tag}:${v}`)); continue
    }
    out.push('--bind', shellQuote(`${k}:s:${v}`))
  }
  return out
}

function buildLogcatCommand(opts: LogcatOptions | undefined, oneShot: boolean): string {
  const parts = ['logcat']
  if (opts?.buffer) parts.push('-b', opts.buffer)
  if (opts?.format) parts.push('-v', opts.format)
  if (oneShot) parts.push('-d') // dump and exit
  if (opts?.pid !== undefined) parts.push(`--pid=${opts.pid}`)
  if (opts?.filters?.length) parts.push(...opts.filters.map(shellQuote))
  else if (!opts?.pid) parts.push('*:V')
  return parts.join(' ')
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
