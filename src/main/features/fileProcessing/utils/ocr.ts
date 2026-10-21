import { readFile } from 'fs/promises'

import { loadSharp } from '@main/utils/sharp'
import type { FileInfo } from '@shared/types/file'

export const preprocessImage = async (buffer: Buffer): Promise<Buffer> => {
  const sharp = await loadSharp()
  return sharp(buffer).grayscale().normalize().sharpen().png({ quality: 100 }).toBuffer()
}

export const loadOcrImage = async (file: FileInfo): Promise<Buffer> => {
  const buffer = await readFile(file.path)
  return preprocessImage(buffer)
}
