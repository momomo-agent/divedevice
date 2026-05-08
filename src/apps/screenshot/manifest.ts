import type { AppManifest } from '@/types'
import Window from './Window.vue'

export const screenshotManifest: AppManifest = {
  id: 'screenshot',
  name: 'Screenshot',
  icon: '📸',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 420, height: 600, resizable: true, minWidth: 280, minHeight: 360 },
}
