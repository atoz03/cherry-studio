import { describe, expect, it } from 'vitest'

import { createDoctorSession, doctorSessionReducer } from '../doctorSessionReducer'

describe('Doctor panels with FORK_DIAGNOSTICS_UPLOAD_ENABLED off', () => {
  it('opens "Report a problem" on the local bundle export instead of the upload form', () => {
    expect(createDoctorSession({ initialPanel: 'report', initialDescription: 'It crashed' })).toMatchObject({
      activePanel: 'export',
      descriptionDraft: 'It crashed'
    })
  })

  it('redirects a report action from the checks to the local bundle export', () => {
    const checks = createDoctorSession({ initialPanel: 'checks' })

    expect(doctorSessionReducer(checks, { type: 'set-panel', panel: 'report' }).activePanel).toBe('export')
  })

  it('leaves the local panels untouched', () => {
    expect(createDoctorSession({ initialPanel: 'checks' }).activePanel).toBe('checks')
    expect(createDoctorSession({ initialPanel: 'export' }).activePanel).toBe('export')
    const exporting = createDoctorSession({ initialPanel: 'export' })
    expect(doctorSessionReducer(exporting, { type: 'set-panel', panel: 'checks' }).activePanel).toBe('checks')
  })
})
