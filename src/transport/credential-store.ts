/**
 * 内存中的 CredentialStore：
 * 每次 session 生成一把 RSA key（PKCS#8 格式）。
 * Phase 1 暂不持久化；后续可以写 IndexedDB 版本实现同一接口。
 */
import type { AdbCredentialStore, AdbPrivateKey } from '@yume-chan/adb'

export class InMemoryCredentialStore implements AdbCredentialStore {
  private keys: AdbPrivateKey[] = []

  async generateKey(): Promise<AdbPrivateKey> {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
        hash: 'SHA-1',
      },
      true,
      ['sign', 'verify'],
    )
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
    const key: AdbPrivateKey = {
      buffer: new Uint8Array(pkcs8),
      name: `DiveDevice@${new Date().toISOString()}`,
    }
    this.keys.push(key)
    return key
  }

  *iterateKeys(): Iterable<AdbPrivateKey> {
    for (const k of this.keys) yield k
  }
}

// 进程单例：同一 session 内复用同一把 key
export const credentialStore = new InMemoryCredentialStore()
