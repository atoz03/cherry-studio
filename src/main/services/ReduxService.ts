/**
 * @deprecated Scheduled for removal in v2.0.0
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * STOP: Feature PRs affecting this file are currently BLOCKED.
 * Only critical bug fixes are accepted during this migration phase.
 *
 * This file is being refactored to v2 standards.
 * Any non-critical changes will conflict with the ongoing work.
 *
 * 🔗 Context & Status:
 * - Contribution Hold: https://github.com/CherryHQ/cherry-studio/issues/10954
 * - v2 Refactor PR   : https://github.com/CherryHQ/cherry-studio/pull/10162
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'
import { EventEmitter } from 'events'

import { windowService } from './WindowService'

type StoreValue = any
type Unsubscribe = () => void

const logger = loggerService.withContext('ReduxService')

export class ReduxService extends EventEmitter {
  private stateCache: any = {}
  private isReady = false

  private readonly STATUS_CHANGE_EVENT = 'statusChange'

  constructor() {
    super()
    this.setupIpcHandlers()
  }

  private setupIpcHandlers() {
    // 监听 store 就绪事件
    ipcMain.handle(IpcChannel.ReduxStoreReady, () => {
      this.isReady = true
      this.emit('ready')
    })

    // 监听 store 状态变化
    ipcMain.on(IpcChannel.ReduxStateChange, (_event, payload, enableGit, gitCommitIntervalMinutes) => {
      let nextState = payload
      if (!payload || typeof payload !== 'object') {
        nextState = {
          note: {
            notesPath: typeof payload === 'string' ? payload : '',
            settings: {
              enableGit: Boolean(enableGit),
              gitCommitIntervalMinutes: gitCommitIntervalMinutes ?? null
            }
          }
        }
      }
      this.stateCache = nextState
      this.emit(this.STATUS_CHANGE_EVENT, nextState)
    })
  }

  private async waitForStoreReady(webContents: Electron.WebContents, timeout = 10000): Promise<void> {
    if (this.isReady) return

    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      try {
        const isReady = await webContents.executeJavaScript(`
          !!window.store && typeof window.store.getState === 'function'
        `)
        if (isReady) {
          this.isReady = true
          return
        }
      } catch (error) {
        // 忽略错误，继续等待
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('Timeout waiting for Redux store to be ready')
  }

  // 添加同步获取状态的方法
  getStateSync() {
    return this.stateCache
  }

  // 添加同步选择器方法
  selectSync<T = StoreValue>(selector: string): T | undefined {
    try {
      // 使用 Function 构造器来安全地执行选择器
      const selectorFn = new Function('state', `return ${selector}`)
      return selectorFn(this.stateCache)
    } catch (error) {
      // change it to debug level as it not block other operations
      logger.debug('Failed to select from cache:', error as Error)
      return undefined
    }
  }

  // 修改 select 方法，优先使用缓存
  async select<T = StoreValue>(selector: string): Promise<T> {
    try {
      // 如果已经准备就绪，先尝试从缓存中获取
      if (this.isReady) {
        const cachedValue = this.selectSync<T>(selector)
        if (cachedValue !== undefined) {
          return cachedValue
        }
      }

      // 如果缓存中没有，再从渲染进程获取
      const mainWindow = windowService.getMainWindow()
      if (!mainWindow) {
        throw new Error('Main window is not available')
      }
      await this.waitForStoreReady(mainWindow.webContents)
      return await mainWindow.webContents.executeJavaScript(`
        (() => {
          const state = window.store.getState();
          return ${selector};
        })()
      `)
    } catch (error) {
      logger.error('Failed to select store value:', error as Error)
      throw error
    }
  }

  // 派发 action
  async dispatch(action: any): Promise<void> {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    await this.waitForStoreReady(mainWindow.webContents)
    try {
      await mainWindow.webContents.executeJavaScript(`
        window.store.dispatch(${JSON.stringify(action)})
      `)
    } catch (error) {
      logger.error('Failed to dispatch action:', error as Error)
      throw error
    }
  }

  // 订阅状态变化
  async subscribe(selector: string, callback: (newValue: any) => void): Promise<Unsubscribe> {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    await this.waitForStoreReady(mainWindow.webContents)

    // 在渲染进程中设置监听
    await mainWindow.webContents.executeJavaScript(
      `
      if (!window._reduxStateChangeSubscribed) {
        if (!window._storeSubscriptions) {
          window._storeSubscriptions = new Set();
        } else {
          window._storeSubscriptions.forEach((unsub) => {
            try {
              unsub();
            } catch {
              // 忽略旧订阅清理失败
            }
          });
          window._storeSubscriptions.clear();
        }

        // 设置全局状态变化监听
        const unsubscribe = window.store.subscribe(() => {
          const state = window.store.getState();
          // 仅发送必要字段，避免 IPC 结构化克隆失败
          const notesPath = typeof state.note?.notesPath === 'string' ? state.note.notesPath : '';
          const enableGit = Boolean(state.note?.settings?.enableGit);
          const interval = state.note?.settings?.gitCommitIntervalMinutes ?? null;
          window.electron.ipcRenderer.send('` +
        IpcChannel.ReduxStateChange +
        `', notesPath, enableGit, interval);
        });

        window._storeSubscriptions.add(unsubscribe);
        window._reduxStateChangeSubscribed = true;
      }
    `
    )

    // 在主进程中处理回调
    const handler = async () => {
      try {
        const newValue = await this.select(selector)
        callback(newValue)
      } catch (error) {
        logger.error('Error in subscription handler:', error as Error)
      }
    }

    this.on(this.STATUS_CHANGE_EVENT, handler)
    return () => {
      this.off(this.STATUS_CHANGE_EVENT, handler)
    }
  }

  // 获取整个状态树
  async getState(): Promise<any> {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    await this.waitForStoreReady(mainWindow.webContents)
    try {
      return await mainWindow.webContents.executeJavaScript(`
        window.store.getState()
      `)
    } catch (error) {
      logger.error('Failed to get state:', error as Error)
      throw error
    }
  }

  // 批量执行 actions
  async batch(actions: any[]): Promise<void> {
    for (const action of actions) {
      await this.dispatch(action)
    }
  }
}

export const reduxService = new ReduxService()

/** example
 async function example() {
 try {
 // 读取状态
 const settings = await reduxService.select('state.settings')
 logger.log('settings', settings)

 // 派发 action
 await reduxService.dispatch({
 type: 'settings/updateApiKey',
 payload: 'new-api-key'
 })

 // 订阅状态变化
 const unsubscribe = await reduxService.subscribe('state.settings.apiKey', (newValue) => {
 logger.log('API key changed:', newValue)
 })

 // 批量执行 actions
 await reduxService.batch([
 { type: 'action1', payload: 'data1' },
 { type: 'action2', payload: 'data2' }
 ])

 // 同步方法虽然可能不是最新的数据，但响应更快
 const apiKey = reduxService.selectSync('state.settings.apiKey')
 logger.log('apiKey', apiKey)

 // 处理保证是最新的数据
 const apiKey1 = await reduxService.select('state.settings.apiKey')
 logger.log('apiKey1', apiKey1)

 // 取消订阅
 unsubscribe()
 } catch (error) {
 logger.error('Error:', error)
 }
 }
 */
