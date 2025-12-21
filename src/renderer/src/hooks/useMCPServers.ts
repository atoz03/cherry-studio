import { createSelector } from '@reduxjs/toolkit'
import NavigationService from '@renderer/services/NavigationService'
import type { RootState } from '@renderer/store'
import store, { useAppDispatch, useAppSelector } from '@renderer/store'
import { addMCPServer, deleteMCPServer, setMCPServers, updateMCPServer } from '@renderer/store/mcp'
import type { MCPServer } from '@renderer/types'
import { IpcChannel } from '@shared/IpcChannel'

// 监听主进程的 MCP 服务变更（Web 端需判空）
const registerMcpIpcListeners = () => {
  const ipcRenderer = window.electron?.ipcRenderer
  if (!ipcRenderer?.on) {
    return
  }

  ipcRenderer.on(IpcChannel.Mcp_ServersChanged, (_event, servers) => {
    store.dispatch(setMCPServers(servers))
  })

  ipcRenderer.on(IpcChannel.Mcp_AddServer, (_event, server: MCPServer) => {
    store.dispatch(addMCPServer(server))
    NavigationService.navigate?.('/settings/mcp')
    NavigationService.navigate?.(`/settings/mcp/settings/${encodeURIComponent(server.id)}`)
  })
}

registerMcpIpcListeners()

const selectMcpServers = (state: RootState) => state.mcp.servers
const selectActiveMcpServers = createSelector([selectMcpServers], (servers) =>
  servers.filter((server) => server.isActive)
)

export const useMCPServers = () => {
  const mcpServers = useAppSelector(selectMcpServers)
  const activedMcpServers = useAppSelector(selectActiveMcpServers)
  const dispatch = useAppDispatch()

  return {
    mcpServers,
    activedMcpServers,
    addMCPServer: (server: MCPServer) => dispatch(addMCPServer(server)),
    updateMCPServer: (server: MCPServer) => dispatch(updateMCPServer(server)),
    deleteMCPServer: (id: string) => dispatch(deleteMCPServer(id)),
    setMCPServerActive: (server: MCPServer, isActive: boolean) => dispatch(updateMCPServer({ ...server, isActive })),
    getActiveMCPServers: () => mcpServers.filter((server) => server.isActive),
    updateMcpServers: (servers: MCPServer[]) => dispatch(setMCPServers(servers))
  }
}

export const useMCPServer = (id: string) => {
  const server = useAppSelector((state) => (state.mcp.servers || []).find((server) => server.id === id))
  const dispatch = useAppDispatch()

  return {
    server,
    updateMCPServer: (server: MCPServer) => dispatch(updateMCPServer(server)),
    setMCPServerActive: (server: MCPServer, isActive: boolean) => dispatch(updateMCPServer({ ...server, isActive })),
    deleteMCPServer: (id: string) => dispatch(deleteMCPServer(id))
  }
}
