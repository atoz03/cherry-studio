import type { Request, Response } from 'express'
import express from 'express'

const router = express.Router()

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.0.0'
  })
})

export default router
