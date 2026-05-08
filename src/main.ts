import { createApp } from 'vue'
import Shell from '@/shell/Shell.vue'
import { registerBuiltInApps } from '@/apps'
import { deviceHub } from '@/services'
import '@/style.css'

registerBuiltInApps()
deviceHub.bootstrap()

createApp(Shell).mount('#app')
