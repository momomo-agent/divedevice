/**
 * useAppController —— app Window 组件挂载时登记控制接口。
 *
 *   useAppController({
 *     send(event, payload) {
 *       if (event === 'navigate') navigate(payload.path)
 *       if (event === 'select-tab') selectTab(payload.tabId)
 *     },
 *     getState() { return { path: path.value, view: view.value } },
 *     describe: () => ({
 *       events: [
 *         { name: 'navigate', description: 'navigate to a path ({path})' },
 *         { name: 'select-tab', description: 'switch tab ({tabId})' },
 *       ],
 *     }),
 *   })
 *
 * 不必传 windowId/appId —— 自动从 useWindow() 推导。
 * onBeforeUnmount 自动解注册。
 */
import { onBeforeUnmount } from 'vue'
import { useWindow } from './index'
import { appControllers } from '@/services/app-controllers'
import type { AppController } from '@/services/app-controllers'

export type AppControllerLocal = Omit<AppController, 'windowId' | 'appId'>

export function useAppController(local: AppControllerLocal): void {
  const { window: win } = useWindow()
  const full: AppController = {
    windowId: win.value.id,
    appId: win.value.appId,
    ...local,
  }
  appControllers.register(full)
  onBeforeUnmount(() => appControllers.unregister(full.windowId))
}
