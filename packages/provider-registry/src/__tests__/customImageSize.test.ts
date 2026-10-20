import { describe, expect, it } from 'vitest'

import { ImageGenerationSupportSchema } from '../schemas/model'
import { buildParamsSchema } from '../utils/buildParamsSchema'
import { withCustomImageSize } from '../utils/customImageSize'

const gptImage = ImageGenerationSupportSchema.parse({
  modes: {
    generate: {
      supports: {
        size: { type: 'enum', options: ['auto', '1024x1024', '1536x1024'], default: 'auto', render: 'chips' },
        quality: { type: 'enum', options: ['low', 'high'] }
      }
    },
    edit: {
      supports: { size: { type: 'enum', options: ['1024x1024'] } },
      maxInputImages: 4
    }
  }
})

describe('withCustomImageSize', () => {
  it('pairs a free width x height with every size enum and keeps the rest of the mode', () => {
    const support = withCustomImageSize(gptImage)

    expect(ImageGenerationSupportSchema.parse(support)).toEqual(support)
    for (const mode of ['generate', 'edit'] as const) {
      expect(support.modes[mode]?.supports.customSize).toEqual({
        type: 'size',
        minSide: 1,
        maxSide: 16384,
        pairedEnumKey: 'size'
      })
    }
    expect(support.modes.generate?.supports.quality).toEqual(gptImage.modes.generate?.supports.quality)
    expect(support.modes.edit?.maxInputImages).toBe(4)
    expect(gptImage.modes.generate?.supports.customSize).toBeUndefined()
  })

  it('accepts a custom pixel size within the bounds and drops one outside them', () => {
    const schema = buildParamsSchema(withCustomImageSize(gptImage), 'generate')

    expect(schema.parse({ size: 'custom', customSize_width: 1280, customSize_height: 720 })).toMatchObject({
      size: 'custom',
      customSize_width: 1280,
      customSize_height: 720
    })
    const outOfRange = schema.parse({ size: 'custom', customSize_width: 0, customSize_height: 20000 })
    expect(outOfRange.customSize_width).toBeUndefined()
    expect(outOfRange.customSize_height).toBeUndefined()
  })

  it('leaves modes without a size enum or with their own custom size untouched', () => {
    const support = ImageGenerationSupportSchema.parse({
      modes: {
        generate: { supports: { aspectRatio: { type: 'enum', options: ['1:1', '16:9'] } } },
        edit: {
          supports: {
            size: { type: 'enum', options: ['1024x1024'] },
            customSize: { type: 'size', minSide: 512, maxSide: 2048, pairedEnumKey: 'size' }
          }
        }
      }
    })

    expect(withCustomImageSize(support)).toEqual(support)
  })
})
