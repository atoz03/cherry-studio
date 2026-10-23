import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { PiDefaultModelSeeder } from '@data/db/seeding/seeders/PiDefaultModelSeeder'

describe('PiDefaultModelSeeder', () => {
  const dbh = setupTestDatabase()

  const readProvider = () => dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, 'pi')).get()
  const readModels = () => dbh.db.select().from(userModelTable).where(eq(userModelTable.providerId, 'pi')).all()

  it('enables the preset Pi provider and gives it a visible default model', () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'pi', presetProviderId: 'pi', name: 'Pi', orderKey: 'a0' })
      .run()

    new PiDefaultModelSeeder().run(dbh.db)

    expect(readProvider()?.isEnabled).toBe(true)
    expect(readModels()).toMatchObject([
      { id: 'pi::default', modelId: 'default', isEnabled: true, isHidden: false, supportsStreaming: true }
    ])
  })

  it('keeps an existing default model instead of inserting a second one', () => {
    new PiDefaultModelSeeder().run(dbh.db)
    dbh.db.update(userModelTable).set({ name: 'Mine' }).where(eq(userModelTable.id, 'pi::default')).run()

    new PiDefaultModelSeeder().run(dbh.db)

    expect(readModels()).toMatchObject([{ id: 'pi::default', name: 'Mine' }])
  })
})
