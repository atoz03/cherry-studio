import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { V1_CUSTOM_CSS_MARKER } from '@shared/utils/customCssMigration'

import { useCustomCss, useCustomCssInjection } from '../useCustomCss'

const CUSTOM_CSS_ELEMENT_ID = 'user-defined-custom-css'

describe('useCustomCssInjection', () => {
  afterEach(() => {
    document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()
  })

  it('does not inject v1-marked CSS and resumes injection after the marker is removed', () => {
    const cssPayload = 'body { color: tomato; }'
    const markedCss = `${V1_CUSTOM_CSS_MARKER}\n${cssPayload}`
    const { rerender } = renderHook(({ cssText }) => useCustomCssInjection(cssText), {
      initialProps: { cssText: markedCss }
    })

    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)).toBeNull()

    rerender({ cssText: cssPayload })

    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.textContent).toBe(cssPayload)
  })
})

describe('useCustomCss', () => {
  afterEach(() => {
    document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()
    MockUsePreferenceUtils.resetMocks()
  })

  it('keeps the font chosen in settings in force over a global font-family in custom CSS', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'ui.custom_css': 'body { font-family: serif; }',
      'ui.theme_user.font_family': 'PingFang SC'
    })

    renderHook(() => useCustomCss())

    const injected = document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.textContent ?? ''
    expect(injected).toMatch(/^body \{ font-family: serif; \}/)
    expect(injected).toContain('font-family: var(--font-family) !important')
  })
})
