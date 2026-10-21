/**
 * sharp with libvips' operation cache off. Each image job here runs once, so the cache (up to
 * 50 MB and 20 open files by default) would only keep memory after the job is done.
 * Loaded on first use: a static import would map sharp's multi-MB libvips native library at boot.
 */
export async function loadSharp() {
  const { default: sharp } = await import('sharp')
  sharp.cache(false)
  return sharp
}
