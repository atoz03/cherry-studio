import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('packaged Smithy dependencies', () => {
  it('preserves S3 request signing and response decoding for backups', async () => {
    const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3')
    let authorization = ''
    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      requestHandler: {
        handle: async (request: { headers: Record<string, string> }) => {
          authorization = request.headers.authorization
          return {
            response: {
              statusCode: 200,
              headers: { 'content-type': 'application/xml' },
              body: new TextEncoder().encode(
                '<ListAllMyBucketsResult><Buckets><Bucket><Name>backups</Name></Bucket></Buckets></ListAllMyBucketsResult>'
              )
            }
          }
        }
      }
    })
    try {
      const response = await client.send(new ListBucketsCommand({}))
      expect(response.Buckets).toEqual([{ Name: 'backups' }])
      expect(authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\//)
    } finally {
      client.destroy()
    }
  })
})
