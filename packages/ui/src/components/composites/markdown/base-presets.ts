/**
 * Streamdown plugin presets that need neither Shiki nor Mermaid.
 *
 * Kept apart from `presets.ts` so a consumer that renders its own code blocks
 * (and lazy-loads Mermaid itself) does not pull either library into its bundle:
 * `@streamdown/code` imports the full Shiki entry and `@streamdown/mermaid`
 * imports Mermaid at module top level.
 */

import { cjk, type CjkPlugin } from '@streamdown/cjk'
import { createMathPlugin } from '@streamdown/math'
import type { PluginConfig } from 'streamdown'
import type { Pluggable } from 'unified'

import { rehypeStreamingMath } from './plugins'

export interface WithMathOptions {
  singleDollar?: boolean
  /** Render the longest closed, valid prefix; keep final input errors visible when false. */
  streaming?: boolean
}

const cjkWithLiteralTildes: CjkPlugin = (() => {
  const remarkPluginsAfter = cjk.remarkPluginsAfter.map((plugin, index, plugins) =>
    index === plugins.length - 1 ? ([plugin, { singleTilde: false }] as Pluggable) : plugin
  )

  return {
    ...cjk,
    remarkPluginsAfter,
    remarkPlugins: [...cjk.remarkPluginsBefore, ...remarkPluginsAfter]
  }
})()

/** CJK line-break tweaks; a single `~` stays a literal tilde. */
export function withCjk(): PluginConfig['cjk'] {
  return cjkWithLiteralTildes
}

/** KaTeX math plugin. `singleDollar` enables `$x$` inline math (off by default). */
export function withMath(opts?: WithMathOptions): PluginConfig['math'] {
  const math = createMathPlugin({ singleDollarTextMath: opts?.singleDollar ?? false })
  return opts?.streaming ? { ...math, rehypePlugin: [rehypeStreamingMath, math.rehypePlugin] } : math
}
