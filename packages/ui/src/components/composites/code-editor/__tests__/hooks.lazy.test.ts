// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useLanguageExtensions } from '../hooks'

const langs = vi.hoisted(() => ({ evaluated: vi.fn(), fallback: { extension: 'fallback' } }))

vi.mock('@uiw/codemirror-extensions-langs', () => {
  langs.evaluated()
  return { loadLanguage: () => langs.fallback }
})

describe('code editor language loading', () => {
  // The all-languages bundle costs ~10 MB of heap in every window that opens an editor.
  it('loads a common language on its own, without the all-languages bundle', async () => {
    const { result } = renderHook(() => useLanguageExtensions('python'))

    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current[0]).not.toBe(langs.fallback)
    expect(langs.evaluated).not.toHaveBeenCalled()
  })

  it('still highlights a language only the all-languages bundle knows', async () => {
    const { result } = renderHook(() => useLanguageExtensions('nix'))

    await waitFor(() => expect(result.current).toEqual([langs.fallback]))
  })
})
