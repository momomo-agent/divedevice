/**
 * 启动时注册所有内置 app。
 * 新增 app 就在这里加一行 register。
 */
import { appRegistry } from '@/services/app-registry'
import { finderManifest } from './finder/manifest'

export function registerBuiltInApps() {
  appRegistry.register(finderManifest)
}
