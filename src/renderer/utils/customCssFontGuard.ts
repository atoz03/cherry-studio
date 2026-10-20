const MAIN_FONT_GUARD = 'html, body, #root { font-family: var(--font-family) !important; }'
const CODE_FONT_GUARD = 'code, pre, kbd, samp { font-family: var(--code-font-family) !important; }'

/**
 * Append rules that keep the fonts chosen in Display settings in force over the user's
 * custom CSS (a global `font-family` there would otherwise win). Without a chosen font,
 * or without custom CSS, the text is returned unchanged so custom CSS keeps full control.
 */
export function withFontGuard(
  customCss: string | undefined,
  fonts: { fontFamily?: string; codeFontFamily?: string }
): string | undefined {
  if (!customCss?.trim()) return customCss
  const guards = [fonts.fontFamily?.trim() && MAIN_FONT_GUARD, fonts.codeFontFamily?.trim() && CODE_FONT_GUARD].filter(
    Boolean
  )
  return guards.length > 0 ? `${customCss}\n\n/* Display settings font guard */\n${guards.join('\n')}\n` : customCss
}
