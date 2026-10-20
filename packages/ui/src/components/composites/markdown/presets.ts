/**
 * Plugin presets for Streamdown's `plugins` prop.
 *
 * Defaults to `code` + `cjk` (the most commonly needed for chat / docs UIs).
 * Math + Mermaid are opt-in via `withMath()` / `withMermaid()`. Importing this
 * module bundles Shiki and Mermaid; `withCjk()` / `withMath()` live in
 * `base-presets.ts` so consumers that only need those avoid both.
 */

import { code } from '@streamdown/code'
import { mermaid } from '@streamdown/mermaid'
import type { PluginConfig } from 'streamdown'

import { withCjk, withMath } from './base-presets'

export { withCjk, withMath, type WithMathOptions } from './base-presets'

export interface WithFullMarkdownOptions {
  singleDollarMath?: boolean
}

/** Code (Shiki highlighting) + CJK line-break tweaks. */
export const defaultMarkdownPlugins: PluginConfig = {
  code,
  cjk: withCjk()
}

/** Mermaid diagram plugin. Heavy — only import where actually rendered. */
export function withMermaid(): PluginConfig['mermaid'] {
  return mermaid
}

/**
 * Composer preset bundling all four plugins (code + cjk + math + mermaid).
 * Suitable for consumers that render the full markdown surface.
 */
export function withFullMarkdown(opts?: WithFullMarkdownOptions): PluginConfig {
  return {
    ...defaultMarkdownPlugins,
    math: withMath({ singleDollar: opts?.singleDollarMath ?? false }),
    mermaid: withMermaid()
  }
}

/**
 * @deprecated Use `withFullMarkdown`. Kept as a compatibility alias for
 * downstream branches that still import this preset from the markdown barrel.
 */
export const withChatPlugins = withFullMarkdown
