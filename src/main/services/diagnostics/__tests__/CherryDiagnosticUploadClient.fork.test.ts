import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signerMocks = vi.hoisted(() => ({ generateDiagnosticUploadHeaders: vi.fn() }))

vi.mock('@main/ai/provider/cherryai', () => signerMocks)

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { CherryDiagnosticUploadClient } from '../CherryDiagnosticUploadClient'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'diagnostic-upload-fork-'))
  vi.mocked(net.fetch).mockReset()
})

afterEach(async () => {
  await rm(tempDir, { force: true, recursive: true })
})

describe('CherryDiagnosticUploadClient with FORK_DIAGNOSTICS_UPLOAD_ENABLED off', () => {
  it('rejects an upload as unavailable without signing it or contacting the backend', async () => {
    const filePath = path.join(tempDir, 'bundle.zip')
    await writeFile(filePath, 'zip-bytes')

    await expect(
      new CherryDiagnosticUploadClient().upload({
        description: 'Something broke',
        fileName: 'bundle.zip',
        filePath: AbsoluteFilePathSchema.parse(filePath)
      })
    ).resolves.toEqual({ reason: 'service_unavailable', status: 'rejected' })
    expect(signerMocks.generateDiagnosticUploadHeaders).not.toHaveBeenCalled()
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('never polls the backend for the status of an earlier report', async () => {
    await expect(
      new CherryDiagnosticUploadClient().fetchStatus('123e4567-e89b-42d3-a456-426614174000')
    ).rejects.toThrow('disabled')
    expect(net.fetch).not.toHaveBeenCalled()
  })
})
