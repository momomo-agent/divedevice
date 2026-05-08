import type { AppManifest } from '@/types'
import Window from './Window.vue'

export const photosManifest: AppManifest = {
  id: 'photos',
  name: 'Photos',
  icon: '🖼',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 960, height: 640, resizable: true, minWidth: 520, minHeight: 360 },
}
