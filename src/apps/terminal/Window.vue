<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useDevice, useWindow } from '@/composables'
import type { SpawnedProcess } from '@/device'

const { window: win } = useWindow()
const device = useDevice()

const hostRef = ref<HTMLDivElement | null>(null)
const statusRef = ref('')

let term: Terminal | null = null
let fit: FitAddon | null = null
let proc: SpawnedProcess | null = null
let stdinWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
let resizeObserver: ResizeObserver | null = null
let disposed = false

async function start() {
  if (!device.value) {
    statusRef.value = '未连接设备'
    return
  }
  statusRef.value = '启动 shell…'
  try {
    proc = await device.value.shell.spawn('sh')
    stdinWriter = proc.stdin.getWriter()

    // stdout
    ;(async () => {
      const reader = proc!.stdout.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done || disposed) break
        if (value) term?.write(value)
      }
    })().catch((err) => console.error('[terminal] stdout', err))

    // stderr
    ;(async () => {
      const reader = proc!.stderr.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done || disposed) break
        if (value) term?.write(value)
      }
    })().catch((err) => console.error('[terminal] stderr', err))

    proc.exit.then((code) => {
      if (disposed) return
      term?.writeln(`\r\n\x1b[90m[process exited: ${code}]\x1b[0m`)
    })

    statusRef.value = ''
  } catch (err) {
    statusRef.value = (err as Error).message
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

async function teardown() {
  disposed = true
  if (stdinWriter) {
    try { await stdinWriter.close() } catch {}
    stdinWriter = null
  }
  if (proc) {
    try { await proc.kill() } catch {}
    proc = null
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
    convertEol: true,
    cursorBlink: true,
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.open(hostRef.value)
  fit.fit()

  term.onData(sendInput)

  resizeObserver = new ResizeObserver(() => {
    try { fit?.fit() } catch {}
  })
  resizeObserver.observe(hostRef.value)

  await start()
})

onBeforeUnmount(() => { teardown() })

// 切换设备时重启 shell
watch(() => win.value.deviceId, async (_n, _o) => {
  disposed = false
  if (stdinWriter) {
    try { await stdinWriter.close() } catch {}
    stdinWriter = null
  }
  if (proc) {
    try { await proc.kill() } catch {}
    proc = null
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
