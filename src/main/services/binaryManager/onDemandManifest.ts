/** One platform's release artifact for an on-demand tool. */
export interface OnDemandPackage {
  url: string
  archive: 'none' | 'zip' | 'zip-tree' | 'tar.gz'
  /** Installed files relative to the tool's install root; a tree lists its entry point (`git/cmd/git.exe`). */
  binaries: string[]
  /** zip: the archive directory holding `binaries`. */
  strip?: string
  /** zip-tree: the directory the whole archive unpacks into. */
  dir?: string
  /** Checksum of the downloaded file. */
  sha256: string
}

export interface OnDemandTool {
  version: string
  versionFile: string
  /** Keyed by `${process.platform}-${process.arch}`. */
  packages: Record<string, OnDemandPackage>
}

export type OnDemandBinaryName = 'mise' | 'bun' | 'uv' | 'mingit'

declare const __ON_DEMAND_BINARIES__: Record<OnDemandBinaryName, OnDemandTool>

/**
 * Pinned versions, URLs and checksums of the tools Cherry downloads on first use
 * instead of bundling. The single source is `TOOLS` in scripts/download-binaries.js;
 * electron.vite.config.ts injects it at build time.
 */
export const onDemandBinaryManifest = __ON_DEMAND_BINARIES__
