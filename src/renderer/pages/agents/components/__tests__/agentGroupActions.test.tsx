import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { type AgentGroupActionContext, resolveAgentGroupActions } from '../agentGroupActions'

function context(agentType: AgentGroupActionContext['agentType']): AgentGroupActionContext {
  return {
    agentId: 'agent-1',
    agentType,
    assistantIconType: 'emoji',
    onEdit: vi.fn(),
    onImportFromPi: vi.fn(),
    onDeleteAgent: vi.fn(),
    onSetAgentIconType: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleSidebar: vi.fn(),
    pinned: false,
    sidebarPinned: false,
    t: ((key: string) => key) as TFunction
  }
}

describe('agent group actions', () => {
  it('offers importing pi CLI sessions only on Pi agents', () => {
    const ids = (type: AgentGroupActionContext['agentType']) => resolveAgentGroupActions(context(type)).map((a) => a.id)

    expect(ids('pi')).toContain('agent-group.import-pi-session')
    expect(ids('claude-code')).not.toContain('agent-group.import-pi-session')
  })
})
