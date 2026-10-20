import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { assistantHandlers } from '@data/api/handlers/assistants'
import { assistantTable } from '@data/db/schemas/assistant'
import { assistantDataService } from '@data/services/AssistantService'
import type { Assistant } from '@shared/data/types/assistant'

// Fork: the per-assistant context-skill selection lives in the `assistant.settings` JSON column.
describe('Assistant context-skill selection persistence', () => {
  const dbh = setupTestDatabase()

  function storedSettings(id: string) {
    return dbh.db.select().from(assistantTable).where(eq(assistantTable.id, id)).get()!.settings
  }

  it('round-trips through PATCH validation, the settings column and GET', async () => {
    const assistant = assistantDataService.create({ name: 'Reviewer' })

    const patched = (await assistantHandlers['/assistants/:id'].PATCH({
      params: { id: assistant.id },
      body: { settings: { contextSkillIds: ['skill-b', 'skill-a'] } }
    })) as Assistant

    expect(patched.settings.contextSkillIds).toEqual(['skill-b', 'skill-a'])
    expect(storedSettings(assistant.id).contextSkillIds).toEqual(['skill-b', 'skill-a'])
    const fetched = (await assistantHandlers['/assistants/:id'].GET({ params: { id: assistant.id } })) as Assistant
    expect(fetched.settings.contextSkillIds).toEqual(['skill-b', 'skill-a'])
  })

  it('survives unrelated settings edits and can be cleared explicitly', async () => {
    const assistant = assistantDataService.create({ name: 'Reviewer' })
    await assistantHandlers['/assistants/:id'].PATCH({
      params: { id: assistant.id },
      body: { settings: { contextSkillIds: ['skill-a'] } }
    })

    await assistantHandlers['/assistants/:id'].PATCH({
      params: { id: assistant.id },
      body: { settings: { temperature: 0.3, enableTemperature: true } }
    })
    expect(storedSettings(assistant.id)).toMatchObject({ temperature: 0.3, contextSkillIds: ['skill-a'] })

    await assistantHandlers['/assistants/:id'].PATCH({
      params: { id: assistant.id },
      body: { settings: { contextSkillIds: [] } }
    })
    expect(storedSettings(assistant.id).contextSkillIds).toEqual([])
  })

  it('is copied when the assistant is duplicated', async () => {
    const assistant = assistantDataService.create({ name: 'Reviewer' })
    await assistantHandlers['/assistants/:id'].PATCH({
      params: { id: assistant.id },
      body: { settings: { contextSkillIds: ['skill-a'] } }
    })

    const copy = (await assistantHandlers['/assistants/:id/duplicate'].POST({
      params: { id: assistant.id },
      body: { name: 'Reviewer copy' }
    })) as Assistant

    expect(storedSettings(copy.id).contextSkillIds).toEqual(['skill-a'])
  })

  it('rejects a malformed selection before it reaches the database', async () => {
    const assistant = assistantDataService.create({ name: 'Reviewer' })

    await expect(
      assistantHandlers['/assistants/:id'].PATCH({
        params: { id: assistant.id },
        body: { settings: { contextSkillIds: 'skill-a' } }
      } as never)
    ).rejects.toHaveProperty('name', 'ZodError')
    expect(storedSettings(assistant.id).contextSkillIds).toBeUndefined()
  })
})
