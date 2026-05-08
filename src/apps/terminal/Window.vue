<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useDevice, useWindow } from '@/composables'

const { window: win } = useWindow()
const device = useDevice()

const hostRef = ref<HTMLDivElement | null>(null)
const statusRef = ref('')

let term: Terminal | null = null
let fit: FitAddon | null = null
let pty: {
  input: WritableStream<Uint8Array>
  output: ReadableStream<Uint8Array>
  exited: Promise<number>
  resize: (rows: number, cols: number) => Promise<void>
  sigint: () => Promise<void>
  kill: () => Promise<void> | void
} | null = null
let stdinWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
let outputReader: ReadableStreamDefaultReader<Uint8Array> | null = null
let resizeObserver: ResizeObserver | null = null
let disposed = false

async function start() {
  if (!device.value) {
    statusRef.value = '未连接设备'
    return
  }
  statusRef.value = '启动 PTY…'
  try {
    // 拿到底层 adb，走 shellProtocol.pty（真 TTY）
    const d = device.value as unknown as { conn: { adb: any } }
    const sp = d.conn.adb.subprocess.shellProtocol
    if (!sp) {
      statusRef.value = '当前 adb 不支持 shell protocol（设备太老？）'
      return
    }

    const ptyProc = await sp.pty({ terminalType: 'xterm-256color' })
    pty = ptyProc as any
    stdinWriter = (ptyProc.input as unknown as WritableStream<Uint8Array>).getWriter()

    // 先同步一次终端尺寸到 pty（避免 shell 按默认 80x24 出奇怪布局）
    if (term) {
      try { await ptyProc.resize(term.rows, term.cols) } catch {}
    }

    // stdout 循环（pty 合并 stdout/stderr 到 output）
    ;(async () => {
      const reader = (ptyProc.output as unknown as ReadableStream<Uint8Array>).getReader()
      outputReader = reader
      for (;;) {
        const { done, value } = await reader.read()
        if (done || disposed) break
        if (value) term?.write(value)
      }
    })().catch((err) => console.error('[terminal] output', err))

    ptyProc.exited.then((code: number) => {
      if (disposed) return
      term?.writeln(`\r\n\x1b[90m[pty exited: ${code}]\x1b[0m`)
    })

    statusRef.value = ''
  } catch (err) {
    statusRef.value = (err as Error).message
    console.error('[terminal] start failed', err)
  }
}

async function sendInput(data: string) {
  if (!stdinWriter) return
  try {
    await stdinWriter.write(new TextEncoder().encode(data))
  } catch (err) {
    console.error('[terminal] stdin', err)
  }
}

async function resizeToTerm() {
  if (!term || !pty) return
  try {
    fit?.fit()
    await pty.resize(term.rows, term.cols)
  } catch {}
}

async function teardown() {
  disposed = true
  if (stdinWriter) {
    try { await stdinWriter.close() } catch {}
    stdinWriter = null
  }
  if (outputReader) {
    try { outputReader.cancel() } catch {}
    outputReader = null
  }
  if (pty) {
    try { await pty.kill() } catch {}
    pty = null
  }
  term?.dispose()
  term = null
  fit = null
  resizeObserver?.disconnect()
  resizeObserver = null
}

onMounted(async () => {
  await new Promise((r) => requestAnimationFrame(r))
  if (!hostRef.value) return

  term = new Terminal({
    fontFamily: 'ui-monospace, SF Mono, Menlo, Consolas, monospace',
    fontSize: 12.5,
    theme: {
      background: '#141820',
      foreground: '#e8ecf2',
      cursor: '#63a3ff',
      selectionBackground: 'rgba(99,163,255,0.3)',
    },
    convertEol: false, // pty 自己发 \r\n
    cursorBlink: true,
    allowProposedApi: true,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.open(hostRef.value)
  fit.fit()

  term.onData(sendInput)
  term.onResize(() => {
    if (pty) pty.resize(term!.rows, term!.cols).catch(() => {})
  })

  resizeObserver = new ResizeObserver(() => { resizeToTerm() })
  resizeObserver.observe(hostRef.value)

  await start()
})

onBeforeUnmount(() => { teardown() })

// 切换设备时重启 shell
watch(() => win.value.deviceId, async () => {
  disposed = false
  if (stdinWriter) {
    try { await stdinWriter.close() } catch {}
    stdinWriter = null
  }
  if (outputReader) {
    try { outputReader.cancel() } catch {}
    outputReader = null
  }
  if (pty) {
    try { await pty.kill() } catch {}
    pty = null
  }
  term?.reset()
  await start()
})
</script>

<template>
  <div class="terminal-root">
    <div v-if="statusRef" class="status">{{ statusRef }}</div>
    <div ref="hostRef" class="host" />
  </div>
</template>

<style scoped>
.terminal-root {
  position: relative;
  height: 100%;
  background: #141820;
}
.host { height: 100%; padding: 6px 8px; }
.status {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-3);
  font-size: 12px;
  pointer-events: none;
}
</style>
