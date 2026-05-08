import type { AppManifest } from '@/types'
import Window from './Window.vue'

export const recorderManifest: AppManifest = {
  id: 'recorder',
  name: 'Recorder',
  icon: '⏺',
  component: Window,
  requiresDevice: true,
  windowDefaults: { width: 520, height: 520, resizable: true, minWidth: 360, minHeight: 320 },
}
