import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), 'data')

export function getDataPath(): string {
  const baseDir = process.env.CHERRY_DATA_DIR?.trim() || DEFAULT_DATA_DIR
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true })
  }
  return baseDir
}
