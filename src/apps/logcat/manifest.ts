import type { AppManifest } from '@/types'
import Window from './Window.vue'

export const logcatManifest: AppManifest = {
  id: 'logcat',
  name: 'Logcat',
  icon: '🪵',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 720, height: 420, resizable: true, minWidth: 420, minHeight: 240 },
}
