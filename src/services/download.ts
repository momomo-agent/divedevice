/**
 * 浏览器端触发文件下载（通过 <a download>）。
 * 同时适配 tool 返回给模型的 _images 字段所需的 base64 编码。
 */

export function triggerDownload(filename: string, bytes: Uint8Array, mimeType: string) {
  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 1000)
}

/** Uint8Array → base64 (chunk 处理，避免 apply 栈溢出) */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}
