import { createApp } from 'vue'
import Shell from '@/shell/Shell.vue'
import { registerBuiltInApps } from '@/apps'
import '@/style.css'

registerBuiltInApps()

createApp(Shell).mount('#app')
