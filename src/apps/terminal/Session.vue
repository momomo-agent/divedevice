<script setup lang="ts">
/**
 * 单个 Terminal Session：一个 xterm + 一个 adb pty。
 * Window.vue 里用 v-show 驱动多 tab（不用 v-if，避免切 tab 就销毁 pty）。
 */
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import type { DeviceAPI } from '@/device'
import { recordCommand } from './store'

const props = defineProps<{
  device: DeviceAPI | null
  /** 当此 tab 从隐藏切到可见时递增 → 触发 fit */
  visibleTick: number
  /** 外部搜索需求：{ query, dir: 'next'|'prev' } */
  searchRequest: { query: string; dir: 'next' | 'prev'; ts: number } | null
}>()

const emit = defineEmits<{
  (e: 'status', msg: string): void
  (e: 'exit', code: number): void
  (e: 'title', title: string): void
}>()

const hostRef = ref<HTMLDivElement | null>(null)

let term: Terminal | null = null
let fit: FitAddon | null = null
let search: SearchAddon | null = null
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
let currentLine = ''  // 追踪用户正在敲的命令行（为了存 history）

async function start() {
  if (!props.device) {
    emit('status', '未连接设备')
    return
  }
  emit('status', '启动 PTY…')
  try {
    const d = props.device as unknown as { conn: { adb: { subprocess: { shellProtocol: any } } } }
    const sp = d.conn.adb.subprocess.shellProtocol
    if (!sp) { emit('status', '当前 adb 不支持 shell protocol（设备太老？）'); return }

    const ptyProc = await sp.pty({ terminalType: 'xterm-256color' })
    pty = ptyProc as any
    stdinWriter = (ptyProc.input as unknown as WritableStream<Uint8Array>).getWriter()

    if (term) {
      try { await ptyProc.resize(term.rows, term.cols) } catch {}
    }

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
      emit('exit', code)
    })

    emit('status', '')
  } catch (err) {
    emit('status', (err as Error).message)
    console.error('[terminal] start failed', err)
  }
}

async function sendInput(data: string) {
  // 追踪用户输入：回车时把缓存行记到 history
  for (const ch of data) {
    if (ch === '\r' || ch === '\n') {
      if (currentLine.trim()) recordCommand(currentLine)
      currentLine = ''
    } else if (ch === '\x7f' || ch === '\b') {
      currentLine = currentLine.slice(0, -1)
    } else if (ch >= ' ') {
      currentLine += ch
    } else if (ch === '\x03') {
      // Ctrl-C
      currentLine = ''
    }
  }
  if (!stdinWriter) return
  try { await stdinWriter.write(new TextEncoder().encode(data)) } catch (err) { console.error('[terminal] stdin', err) }
}

async function resizeToTerm() {
  if (!term || !pty) return
  try { fit?.fit(); await pty.resize(term.rows, term.cols) } catch {}
}

defineExpose({
  /** 外部往 pty 发文本（snippet / history 一键发） */
  paste(text: string) {
    sendInput(text)
  },
  /** 把一条命令完整回车发送 */
  run(cmd: string) {
    sendInput(cmd + '\r')
  },
  sigint() { return pty?.sigint() },
  clear() { term?.clear() },
  focus() { term?.focus() },
  resize: resizeToTerm,
})

async function teardown() {
  disposed = true
  if (stdinWriter) { try { await stdinWriter.close() } catch {} ; stdinWriter = null }
  if (outputReader) { try { outputReader.cancel() } catch {} ; outputReader = null }
  if (pty) { try { await pty.kill() } catch {} ; pty = null }
  term?.dispose(); term = null
  fit = null
  search = null
  resizeObserver?.disconnect(); resizeObserver = null
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
    convertEol: false,
    cursorBlink: true,
    allowProposedApi: true,
  })
  fit = new FitAddon()
  search = new SearchAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(new WebLinksAddon())
  term.open(hostRef.value)
  fit.fit()

  term.onData(sendInput)
  term.onResize(() => { if (pty) pty.resize(term!.rows, term!.cols).catch(() => {}) })

  resizeObserver = new ResizeObserver(() => { resizeToTerm() })
  resizeObserver.observe(hostRef.value)

  await start()
})

onBeforeUnmount(teardown)

// Tab 从隐藏切到可见时要 fit，否则 xterm 尺寸还是被创建时的 0 或旧值
watch(() => props.visibleTick, async () => {
  await new Promise((r) => requestAnimationFrame(r))
  await resizeToTerm()
  term?.focus()
})

// 外部驱动的搜索
watch(() => props.searchRequest, (req) => {
  if (!req || !search) return
  if (req.dir === 'next') search.findNext(req.query, { incremental: false })
  else search.findPrevious(req.query, { incremental: false })
})

// 设备切换：重启 shell（保留 xterm 实例 + 历史 scrollback）
watch(() => props.device, async () => {
  disposed = false
  if (stdinWriter) { try { await stdinWriter.close() } catch {} ; stdinWriter = null }
  if (outputReader) { try { outputReader.cancel() } catch {} ; outputReader = null }
  if (pty) { try { await pty.kill() } catch {} ; pty = null }
  term?.writeln('\r\n\x1b[90m[device switched — restarting shell]\x1b[0m')
  await start()
})
</script>

<template>
  <div ref="hostRef" class="host" />
</template>

<style scoped>
.host { height: 100%; padding: 6px 8px; }
</style>
