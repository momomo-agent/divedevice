/**
 * File type → app associations.
 * Finder 双击时查这张表决定用哪个 app 打开。
 */
export interface FileAssoc {
  /** 目标 app id */
  appId: string
  /** 传给 app 的初始参数键（如 'openPath'） */
  pathProp: string
  /** 窗口标题 */
  title?: (filename: string) => string
}

/** 默认兜底（Editor） */
export const DEFAULT_ASSOC: FileAssoc = {
  appId: 'editor',
  pathProp: 'openPath',
  title: (name) => name,
}

/** ext（不含点，小写） → assoc */
const registry: Record<string, FileAssoc> = {}

function register(exts: string[], assoc: FileAssoc) {
  for (const e of exts) registry[e.toLowerCase()] = assoc
}

// ---- 图片 → Finder 内嵌预览（已在 Finder 内处理，这里不注册） ----
// 约定：isImage 单独判断，Finder 不走 open-with 路径

// ---- 视频 / 音频 → Media ----
register(
  ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', '3gp',
    'mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus'],
  { appId: 'media', pathProp: 'openPath' },
)

// ---- 文本/代码/配置/日志 → Editor ----
register(
  [
    'txt', 'md', 'markdown', 'log', 'conf', 'config', 'ini', 'env',
    'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'htm', 'css', 'scss', 'less',
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
    'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc',
    'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'sql', 'lua', 'r',
    'proto', 'graphql', 'gradle', 'properties',
    'gitignore', 'dockerignore', 'editorconfig',
  ],
  { appId: 'editor', pathProp: 'openPath' },
)

export function extOf(path: string): string {
  const name = path.split('/').pop() ?? path
  const m = name.toLowerCase().match(/\.([^.]+)$/)
  if (m) return m[1]
  // 无扩展名的特殊文件
  if (name.toLowerCase() === 'readme') return 'md'
  return ''
}

export function lookup(path: string): FileAssoc {
  const ext = extOf(path)
  return registry[ext] ?? DEFAULT_ASSOC
}

export function isImageFile(path: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|svg)$/i.test(path)
}
