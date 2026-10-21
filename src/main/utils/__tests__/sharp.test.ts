import { describe, expect, it } from 'vitest'

import { loadSharp } from '../sharp'

describe('loadSharp', () => {
  // libvips' default operation cache keeps up to 50 MB after a one-off image job.
  it('returns sharp with the libvips operation cache off', async () => {
    const sharp = await loadSharp()

    expect(sharp.cache()).toMatchObject({ memory: { max: 0 }, items: { max: 0 }, files: { max: 0 } })
  })
})
