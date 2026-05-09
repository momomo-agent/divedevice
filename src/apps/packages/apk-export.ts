/**
 * APK / APKS zip 导出辅助
 * - triggerDownload: 通过 <a download> 触发浏览器下载
 * - buildStoreZip: 纯处理（store）方式打包 ZIP，不压缩，零依赖
 *   实现参考 APPNOTE.TXT (PKZIP spec)
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

// CRC-32 (IEEE 802.3) 表
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * 组装 store 模式（method=0, 不压缩）ZIP。APK 已经压缩，所以 store 就行。
 * 支持 UTF-8 文件名（bit 11）。
 */
export function buildStoreZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder()
  type Entry = {
    name: Uint8Array
    data: Uint8Array
    crc: number
    size: number
    offset: number
  }
  const entries: Entry[] = []
  let total = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    total += 30 + name.length + f.data.length
  }
  let cdSize = 0
  for (const f of files) {
    cdSize += 46 + enc.encode(f.name).length
  }
  total += cdSize + 22
  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  let off = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = f.data
    const crc = crc32(data)
    const hdrStart = off
    dv.setUint32(off, 0x04034b50, true); off += 4
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 0x0800, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0x21, true); off += 2
    dv.setUint32(off, crc, true); off += 4
    dv.setUint32(off, data.length, true); off += 4
    dv.setUint32(off, data.length, true); off += 4
    dv.setUint16(off, name.length, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    out.set(name, off); off += name.length
    out.set(data, off); off += data.length
    entries.push({ name, data, crc, size: data.length, offset: hdrStart })
  }
  const cdOffset = off
  for (const e of entries) {
    dv.setUint32(off, 0x02014b50, true); off += 4
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 20, true); off += 2
    dv.setUint16(off, 0x0800, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0x21, true); off += 2
    dv.setUint32(off, e.crc, true); off += 4
    dv.setUint32(off, e.size, true); off += 4
    dv.setUint32(off, e.size, true); off += 4
    dv.setUint16(off, e.name.length, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint16(off, 0, true); off += 2
    dv.setUint32(off, 0, true); off += 4
    dv.setUint32(off, e.offset, true); off += 4
    out.set(e.name, off); off += e.name.length
  }
  dv.setUint32(off, 0x06054b50, true); off += 4
  dv.setUint16(off, 0, true); off += 2
  dv.setUint16(off, 0, true); off += 2
  dv.setUint16(off, entries.length, true); off += 2
  dv.setUint16(off, entries.length, true); off += 2
  dv.setUint32(off, cdSize, true); off += 4
  dv.setUint32(off, cdOffset, true); off += 4
  dv.setUint16(off, 0, true); off += 2
  return out
}
