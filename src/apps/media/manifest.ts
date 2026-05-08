import type { AppManifest } from '@/types'
import Window from './Window.vue'

export const mediaManifest: AppManifest = {
  id: 'media',
  name: 'Media',
  icon: '🎬',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 720, height: 480, resizable: true, minWidth: 360, minHeight: 220 },
}
