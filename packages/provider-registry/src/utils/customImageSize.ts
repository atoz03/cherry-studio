import type { ImageGenerationSupport, SupportSpec } from '../schemas/model'

/** Any positive whole-pixel side; the upper bound only keeps typos from reaching the relay. */
export const RELAY_CUSTOM_IMAGE_SIZE = {
  type: 'size',
  minSide: 1,
  maxSide: 16384,
  pairedEnumKey: 'size'
} as const satisfies SupportSpec

/**
 * Offer a free width × height next to every mode's `size` enum, for relays (New API)
 * that forward any `WxH` size. Modes without a `size` enum, or with their own
 * `customSize` widget, are left as they are.
 */
export function withCustomImageSize(support: ImageGenerationSupport): ImageGenerationSupport {
  const modes: ImageGenerationSupport['modes'] = {}
  for (const [mode, def] of Object.entries(support.modes) as [
    keyof ImageGenerationSupport['modes'],
    NonNullable<ImageGenerationSupport['modes'][keyof ImageGenerationSupport['modes']]>
  ][]) {
    const offersCustomSize = def.supports.size?.type === 'enum' && !def.supports.customSize
    modes[mode] = offersCustomSize
      ? { ...def, supports: { ...def.supports, customSize: RELAY_CUSTOM_IMAGE_SIZE } }
      : def
  }
  return { ...support, modes }
}
