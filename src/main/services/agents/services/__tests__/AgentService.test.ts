import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetModels, mockInitSkillsForAgent } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockInitSkillsForAgent: vi.fn()
}))

vi.mock('@main/apiServer/services/mcp', () => ({
  mcpApiService: {
    getServerInfo: vi.fn()
  }
}))

vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getDataPath: vi.fn(() => '/mock/data')
}))

vi.mock('@main/apiServer/services/models', () => ({
  modelsService: {
    getModels: mockGetModels
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }))
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    getAppPath: vi.fn(() => '/app')
  },
  BrowserWindow: vi.fn(),
  dialog: {},
  ipcMain: {},
  nativeTheme: {
    on: vi.fn(),
    themeSource: 'system',
    shouldUseDarkColors: false
  },
  screen: {},
  session: {},
  shell: {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
    macOS: false,
    windows: false,
    linux: true
  }
}))

vi.mock('../../skills/SkillService', () => ({
  skillService: {
    initSkillsForAgent: mockInitSkillsForAgent
  }
}))

import { AgentService } from '../AgentService'

function createSelectQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(rows)
      }))
    }))
  }
}

function createWhereQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(rows)
    }))
  }
}

function createOrderedSelectQuery(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn().mockResolvedValue(rows)
      }))
    }))
  }
}

function createAgentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent_current',
    type: 'claude-code',
    name: 'Current Agent',
    description: 'Active user agent',
    deleted_at: null,
    accessible_paths: '[]',
    instructions: 'You are a helpful assistant.',
    model: 'claude-sonnet-4',
    plan_model: null,
    small_model: null,
    mcps: '[]',
    allowed_tools: '[]',
    configuration: '{}',
    sort_order: 0,
    created_at: '2026-05-25T00:00:00.000Z',
    updated_at: '2026-05-25T00:00:00.000Z',
    ...overrides
  }
}

describe('AgentService built-in agent lifecycle', () => {
  const service = AgentService.getInstance()

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('skips recreating a built-in agent that was soft-deleted by the user', async () => {
    const database = {
      select: vi.fn(() =>
        createSelectQuery([{ id: 'cherry-assistant-default', deleted_at: '2026-04-15T00:00:00.000Z' }])
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const result = await service.initBuiltinAgent({
      id: 'cherry-assistant-default',
      builtinRole: 'assistant',
      provisionWorkspace: vi.fn()
    })

    expect(result).toEqual({ agentId: null, skippedReason: 'deleted' })
    expect(mockGetModels).not.toHaveBeenCalled()
  })

  it('hard-deletes agent rows when id is no longer treated as built-in', async () => {
    const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: 1 })
    const txDelete = vi.fn(() => ({ where: deleteWhere }))
    const updateWhere = vi.fn().mockResolvedValue(undefined)
    const txUpdateSet = vi.fn(() => ({ where: updateWhere }))
    const txUpdate = vi.fn(() => ({ set: txUpdateSet }))
    const database = {
      select: vi.fn(() => createSelectQuery([{ id: 'cherry-claw-default', deleted_at: null }])),
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
        callback({ delete: txDelete, update: txUpdate })
      ),
      delete: vi.fn(() => ({ where: deleteWhere }))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deleted = await service.deleteAgent('cherry-claw-default')

    expect(deleted).toBe(true)
    expect(database.transaction).not.toHaveBeenCalled()
    expect(txDelete).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
    expect(database.delete).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(txUpdateSet).not.toHaveBeenCalled()
  })

  it('filters legacy preset agents from list responses and totals', async () => {
    const rows = [
      createAgentRow({ id: 'agent_current', name: 'Current Agent', sort_order: 0 }),
      createAgentRow({
        id: 'legacy_by_name',
        name: 'Cherry Claw',
        description: 'Default autonomous CherryClaw agent',
        configuration: JSON.stringify({
          avatar: '🦞',
          soul_enabled: true,
          scheduler_enabled: true,
          heartbeat_enabled: true
        }),
        sort_order: 1
      }),
      createAgentRow({ id: 'cherry-assistant-default', name: 'Cherry Assistant', sort_order: 2 })
    ]
    const database = {
      select: vi.fn(() => createOrderedSelectQuery(rows))
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)
    vi.spyOn(service as never, 'listMcpTools').mockResolvedValue({ tools: [], legacyIdMap: new Map() } as never)

    const result = await service.listAgents({ sortBy: 'sort_order', orderBy: 'asc' })

    expect(result.total).toBe(1)
    expect(result.agents.map((agent) => agent.id)).toEqual(['agent_current'])
  })

  it('hides legacy preset agents from direct lookups and existence checks', async () => {
    const database = {
      select: vi.fn(() =>
        createSelectQuery([
          createAgentRow({
            id: 'cherry-assistant-default',
            name: 'Cherry Assistant',
            description: 'Cherry Studio 内置使用顾问。诊断问题、引导操作、收录 FAQ、提交 Bug/需求、搜索和创建 Skills'
          })
        ])
      )
    }

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    await expect(service.getAgent('cherry-assistant-default')).resolves.toBeNull()
    await expect(service.agentExists('cherry-assistant-default')).resolves.toBe(false)
  })

  it('purges legacy preset agents matched by id or persisted metadata', async () => {
    const rows = [
      createAgentRow({ id: 'agent_current', name: 'Current Agent' }),
      createAgentRow({ id: 'cherry-assistant-default', name: 'Cherry Assistant' }),
      createAgentRow({
        id: 'renamed_legacy_claw',
        name: 'assistant',
        description: 'Default autonomous CherryClaw agent',
        accessible_paths: JSON.stringify(['/mock/Data/Agents/w-default'])
      })
    ]
    const database = {
      select: vi.fn(() => createWhereQuery(rows))
    }
    const deleteAgent = vi.spyOn(service, 'deleteAgent').mockResolvedValue(true)

    vi.spyOn(service as never, 'getDatabase').mockResolvedValue(database as never)

    const deletedIds = await service.purgeLegacyPresetAgents()

    expect(deletedIds).toEqual(['cherry-assistant-default', 'renamed_legacy_claw'])
    expect(deleteAgent).toHaveBeenCalledTimes(2)
    expect(deleteAgent).toHaveBeenNthCalledWith(1, 'cherry-assistant-default')
    expect(deleteAgent).toHaveBeenNthCalledWith(2, 'renamed_legacy_claw')
  })
})
