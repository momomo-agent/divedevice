import { appRegistry } from '@/services/app-registry'
import { finderManifest } from './finder/manifest'
import { terminalManifest } from './terminal/manifest'
import { editorManifest } from './editor/manifest'
import { photosManifest } from './photos/manifest'
import { mediaManifest } from './media/manifest'
import { screencastManifest } from './screencast/manifest'
import { screenshotManifest } from './screenshot/manifest'
import { recorderManifest } from './recorder/manifest'
import { logcatManifest } from './logcat/manifest'

export function registerBuiltInApps() {
  appRegistry.register(finderManifest)
  appRegistry.register(terminalManifest)
  appRegistry.register(editorManifest)
  appRegistry.register(photosManifest)
  appRegistry.register(mediaManifest)
  appRegistry.register(screencastManifest)
  appRegistry.register(screenshotManifest)
  appRegistry.register(recorderManifest)
  appRegistry.register(logcatManifest)
}
