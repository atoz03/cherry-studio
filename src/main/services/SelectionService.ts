import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import { clipboard, ipcMain } from 'electron'

import type { ActionItem } from '../../renderer/src/types/selectionTypes'

const logger = loggerService.withContext('SelectionService')

/**
 * 划词助手已下线。
 *
 * 这里保留一个轻量空实现，目的是：
 * 1. 兼容仍在调用该服务的主进程代码路径；
 * 2. 避免继续打包 selection-hook 与划词窗口逻辑；
 * 3. 让历史 IPC 调用安全返回，不影响主聊天链路。
 */
export class SelectionService {
  private static instance: SelectionService | null = null
  private static isIpcHandlerRegistered = false
  private enabled = false

  static getInstance(): SelectionService {
    if (!SelectionService.instance) {
      SelectionService.instance = new SelectionService()
    }
    return SelectionService.instance
  }

  start(): boolean {
    logger.info('Selection assistant is disabled. start() ignored.')
    return false
  }

  stop(): boolean {
    return false
  }

  quit(): void {
    this.enabled = false
  }

  toggleEnabled(): void {
    this.setEnabled(!this.enabled)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  processSelectTextByShortcut(): void {
    logger.info('Selection assistant is disabled. processSelectTextByShortcut() ignored.')
  }

  hideToolbar(): void {}

  writeToClipboard(text: string): boolean {
    clipboard.writeText(text)
    return true
  }

  determineToolbarSize(_width: number, _height: number): void {
    void _width
    void _height
  }

  setTriggerMode(_triggerMode: string): void {
    void _triggerMode
  }

  setFollowToolbar(_isFollowToolbar: boolean): void {
    void _isFollowToolbar
  }

  setRemeberWinSize(_isRemeberWinSize: boolean): void {
    void _isRemeberWinSize
  }

  setFilterMode(_filterMode: string): void {
    void _filterMode
  }

  setFilterList(_filterList: string[]): void {
    void _filterList
  }

  processAction(_actionItem: ActionItem, _isFullScreen: boolean = false): void {
    void _actionItem
    void _isFullScreen
    logger.info('Selection assistant is disabled. processAction() ignored.')
  }

  closeActionWindow(): void {}

  minimizeActionWindow(): void {}

  pinActionWindow(_isPinned?: boolean): void {
    void _isPinned
  }

  getLinuxEnvInfo(): {
    isLinuxWaylandDisplay: boolean
    isLinuxXWaylandMode: boolean
    hasLinuxInputDeviceAccess: boolean
    isLinuxCompositorCompatible: boolean
  } {
    return {
      isLinuxWaylandDisplay: false,
      isLinuxXWaylandMode: false,
      hasLinuxInputDeviceAccess: false,
      isLinuxCompositorCompatible: false
    }
  }

  static registerIpcHandler(): void {
    if (SelectionService.isIpcHandlerRegistered) return
    SelectionService.isIpcHandlerRegistered = true

    const service = SelectionService.getInstance()

    ipcMain.handle(IpcChannel.Selection_ToolbarHide, () => service.hideToolbar())
    ipcMain.handle(IpcChannel.Selection_WriteToClipboard, (_, text: string) => service.writeToClipboard(text))
    ipcMain.handle(IpcChannel.Selection_ToolbarDetermineSize, (_, width: number, height: number) =>
      service.determineToolbarSize(width, height)
    )
    ipcMain.handle(IpcChannel.Selection_SetEnabled, (_, enabled: boolean) => service.setEnabled(enabled))
    ipcMain.handle(IpcChannel.Selection_SetTriggerMode, (_, triggerMode: string) => service.setTriggerMode(triggerMode))
    ipcMain.handle(IpcChannel.Selection_SetFollowToolbar, (_, isFollowToolbar: boolean) =>
      service.setFollowToolbar(isFollowToolbar)
    )
    ipcMain.handle(IpcChannel.Selection_SetRemeberWinSize, (_, isRemeberWinSize: boolean) =>
      service.setRemeberWinSize(isRemeberWinSize)
    )
    ipcMain.handle(IpcChannel.Selection_SetFilterMode, (_, filterMode: string) => service.setFilterMode(filterMode))
    ipcMain.handle(IpcChannel.Selection_SetFilterList, (_, filterList: string[]) => service.setFilterList(filterList))
    ipcMain.handle(IpcChannel.Selection_ProcessAction, (_, actionItem: ActionItem, isFullScreen: boolean = false) =>
      service.processAction(actionItem, isFullScreen)
    )
    ipcMain.handle(IpcChannel.Selection_ActionWindowClose, () => service.closeActionWindow())
    ipcMain.handle(IpcChannel.Selection_ActionWindowMinimize, () => service.minimizeActionWindow())
    ipcMain.handle(IpcChannel.Selection_ActionWindowPin, (_, isPinned: boolean) => service.pinActionWindow(isPinned))
    ipcMain.handle(IpcChannel.Selection_GetLinuxEnvInfo, () => service.getLinuxEnvInfo())
  }
}

/**
 * 保留初始化入口，避免主进程启动链路改动过大。
 */
export function initSelectionService(): boolean {
  logger.info('Selection assistant disabled at build level.')
  return false
}

const selectionService = SelectionService.getInstance()

export default selectionService
