import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { FileIntakeService } from '../FileIntakeService'
import { FileManager } from '../FileManager'
import { fileIntakeLimits } from '../intakeTypes'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const owner = { ownerId: 'phone/grant', quotaKey: 'phone' }
const metadata = { uploadId: 'upload', filename: 'report.txt', mediaType: 'text/plain', byteLength: 4 }

describe('file intake sweep timer', () => {
  setupTestDatabase()
  let root: string
  let intake: FileIntakeService

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'file-intake-sweep-'))
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      path.join(root, key === 'feature.files.intakes' ? 'intakes' : key, filename ?? '')
    )
    await mkdir(path.join(root, 'intakes'))
    // Only intervals and the clock are faked; file I/O still needs real timers to settle.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    BaseService.resetInstances()
    Object.assign(application.get('FileManager'), { intakes: new FileManager().intakes })
    intake = new FileIntakeService()
    await intake._doInit()
  })
  afterEach(async () => {
    await intake._doStop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('keeps no timer without staged uploads and sweeps while one is retained', async () => {
    expect(vi.getTimerCount()).toBe(0)

    await intake.prepare(owner, metadata)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(vi.getTimerCount()).toBe(1)
    await expect(intake.get(owner, 'upload')).resolves.toMatchObject({ state: 'receiving' })
  })

  it('removes an expired upload on the next sweep, then stops sweeping until another arrives', async () => {
    await intake.prepare(owner, metadata)
    vi.setSystemTime(Date.now() + fileIntakeLimits.retentionMs + 1)

    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(0))
    expect(await readdir(path.join(root, 'intakes'))).toEqual([])
    expect(await intake.owners()).toEqual([])

    await intake.prepare(owner, { ...metadata, uploadId: 'next' })
    expect(vi.getTimerCount()).toBe(1)
  })
})
