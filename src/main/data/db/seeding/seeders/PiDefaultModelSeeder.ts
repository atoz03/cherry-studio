import { eq } from 'drizzle-orm'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { PI_DEFAULT_MODEL_ID, PI_PROVIDER_ID } from '@shared/data/presets/pi'
import { createUniqueModelId } from '@shared/data/types/model'

import type { DbType, ISeeder } from '../../types'

/**
 * Pi agents pick from the Pi provider's models. Seed its `default` model (pi chooses) and enable
 * the provider once, so a Pi agent works before the user pulls pi's model list in Settings.
 */
export class PiDefaultModelSeeder implements ISeeder {
  readonly name = 'piDefaultModel'
  readonly version = '1'
  readonly description = 'Enable the Pi provider with its default model'

  run(db: DbType): void {
    const id = createUniqueModelId(PI_PROVIDER_ID, PI_DEFAULT_MODEL_ID)
    db.transaction((tx) => {
      providerService.batchUpsertTx(tx, [{ providerId: PI_PROVIDER_ID, presetProviderId: PI_PROVIDER_ID, name: 'Pi' }])
      tx.update(userProviderTable)
        .set({ isEnabled: true })
        .where(eq(userProviderTable.providerId, PI_PROVIDER_ID))
        .run()
      if (tx.select({ id: userModelTable.id }).from(userModelTable).where(eq(userModelTable.id, id)).get()) return
      insertManyWithOrderKey(
        tx,
        userModelTable,
        [
          {
            id,
            providerId: PI_PROVIDER_ID,
            modelId: PI_DEFAULT_MODEL_ID,
            name: 'Pi default',
            group: PI_PROVIDER_ID,
            capabilities: [],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          }
        ],
        { pkColumn: userModelTable.id, scope: eq(userModelTable.providerId, PI_PROVIDER_ID) }
      )
    })
  }
}
