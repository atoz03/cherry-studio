import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/chromiumFlags.ts
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `@main/core/platform` exposes module-level booleans (isLinux/isWin/etc.)
 *     computed at evaluation time. We use `vi.doMock` + `vi.resetModules()` and
 *     dynamically import the module-under-test in each test, so we can swap
 *     platform values per scenario.
 *   - The global `electron` mock from tests/main.setup.ts lacks the specific
 *     `app.disableHardwareAcceleration` and `app.commandLine.appendSwitch`
 *     methods we need to assert on. We shadow it with `vi.doMock('electron', …)`
 *     per test, backed by shared vi.fn() instances at module scope.
 *   - `@main/data/bootConfig` is not globally mocked. We provide a per-test stub
 *     whose `get()` returns whatever `app.disable_hardware_acceleration` value
 *     the scenario needs.
 *   - `process.env.XDG_SESSION_TYPE` is controlled via `vi.stubEnv()`, which is
 *     automatically unstubbed in afterEach to prevent cross-test leakage.
 */

interface PlatformFlags {
  isLinux: boolean
  isWin: boolean
}

const disableHardwareAccelerationMock = vi.fn()
const appendSwitchMock = vi.fn()
const hasSwitchMock = vi.fn()
const getSwitchValueMock = vi.fn()
const bootConfigGetMock = vi.fn()

const UNCONDITIONAL_FEATURES = [
  'DocumentPolicyIncludeJSCallStacksInCrashReports',
  'EarlyEstablishGpuChannel',
  'EstablishGpuChannelAsync',
  'PageAllocatorRetryOnCommitFailure'
]

/** Chromium keeps only the last value of a repeated switch — that is what takes effect. */
function effectiveEnabledFeatures(): string[] {
  const calls = appendSwitchMock.mock.calls.filter(([name]) => name === 'enable-features')
  return calls.at(-1)?.[1]?.split(',') ?? []
}

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      disableHardwareAcceleration: disableHardwareAccelerationMock,
      commandLine: {
        appendSwitch: appendSwitchMock,
        hasSwitch: hasSwitchMock,
        getSwitchValue: getSwitchValueMock
      }
    }
  }))
}

function stubConstants(flags: PlatformFlags) {
  vi.doMock('@main/core/platform', () => ({
    isLinux: flags.isLinux,
    isLinuxWayland: flags.isLinux && process.env.XDG_SESSION_TYPE === 'wayland',
    isWin: flags.isWin,
    isPortable: false,
    isMac: !flags.isLinux && !flags.isWin,
    isDev: false
  }))
}

function stubBootConfig(opts: { disableHardwareAcceleration?: boolean } = {}) {
  bootConfigGetMock.mockImplementation((key: string) => {
    if (key === 'app.disable_hardware_acceleration') {
      return opts.disableHardwareAcceleration ?? false
    }
    return undefined
  })
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGetMock
    }
  }))
}

async function loadModule() {
  return import('../chromiumFlags')
}

beforeEach(() => {
  vi.resetModules()
  disableHardwareAccelerationMock.mockReset()
  appendSwitchMock.mockReset()
  hasSwitchMock.mockReset().mockReturnValue(false)
  getSwitchValueMock.mockReset().mockReturnValue('')
  bootConfigGetMock.mockReset()
})

afterEach(() => {
  // Intentionally NOT calling vi.doUnmock(...) — see userDataLocation.test.ts
  // for the rationale. resetModules() in beforeEach + fresh vi.doMock() in
  // each test is the robust pattern.
  vi.unstubAllEnvs()
})

describe('configureChromiumFlags', () => {
  describe('hardware acceleration toggle', () => {
    it('calls disableHardwareAcceleration() when BootConfig flag is true', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig({ disableHardwareAcceleration: true })

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).toHaveBeenCalledTimes(1)
    })

    it('does NOT call disableHardwareAcceleration() when BootConfig flag is false', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig({ disableHardwareAcceleration: false })

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).not.toHaveBeenCalled()
    })

    it('does NOT call disableHardwareAcceleration() when BootConfig flag is undefined', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig() // no opts → get() returns undefined

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).not.toHaveBeenCalled()
    })
  })

  describe('platform-specific switches', () => {
    it('Windows: appends wm-window-animations-disabled but no Linux switches', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('wm-window-animations-disabled')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('name', 'CherryStudio')
      expect(effectiveEnabledFeatures()).not.toContain('GlobalShortcutsPortal')
    })

    it('Linux X11: appends class/name but NOT GlobalShortcutsPortal', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'x11')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).toHaveBeenCalledWith('name', 'CherryStudio')
      expect(effectiveEnabledFeatures()).not.toContain('GlobalShortcutsPortal')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('wm-window-animations-disabled')
    })

    it('Linux Wayland: appends class/name AND GlobalShortcutsPortal', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(effectiveEnabledFeatures()).toContain('GlobalShortcutsPortal')
      expect(appendSwitchMock).toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).toHaveBeenCalledWith('name', 'CherryStudio')
    })

    it('macOS: appends NO platform-specific switches', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(appendSwitchMock).not.toHaveBeenCalledWith('wm-window-animations-disabled')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('class', 'CherryStudio')
      expect(appendSwitchMock).not.toHaveBeenCalledWith('name', 'CherryStudio')
      expect(effectiveEnabledFeatures()).not.toContain('GlobalShortcutsPortal')
    })
  })

  describe('Linux key storage backend', () => {
    function stubDesktop(desktop: string, session = '') {
      vi.stubEnv('XDG_CURRENT_DESKTOP', desktop)
      vi.stubEnv('DESKTOP_SESSION', session)
      vi.stubEnv('KDE_FULL_SESSION', '')
    }

    async function configure(flags: PlatformFlags) {
      stubConstants(flags)
      stubElectron()
      stubBootConfig()
      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()
    }

    it('selects libsecret on desktops Chromium does not recognise (Hyprland)', async () => {
      stubDesktop('Hyprland')
      await configure({ isLinux: true, isWin: false })

      expect(appendSwitchMock).toHaveBeenCalledWith('password-store', 'gnome-libsecret')
    })

    it('leaves KDE sessions to KWallet', async () => {
      stubDesktop('KDE')
      await configure({ isLinux: true, isWin: false })

      expect(appendSwitchMock).not.toHaveBeenCalledWith('password-store', expect.anything())
    })

    it('detects KDE from DESKTOP_SESSION when XDG_CURRENT_DESKTOP is empty', async () => {
      stubDesktop('', 'plasma-kde')
      await configure({ isLinux: true, isWin: false })

      expect(appendSwitchMock).not.toHaveBeenCalledWith('password-store', expect.anything())
    })

    it('respects a user-supplied --password-store', async () => {
      stubDesktop('Hyprland')
      hasSwitchMock.mockImplementation((name: string) => name === 'password-store')
      await configure({ isLinux: true, isWin: false })

      expect(appendSwitchMock).not.toHaveBeenCalledWith('password-store', expect.anything())
    })

    it('does nothing outside Linux', async () => {
      stubDesktop('Hyprland')
      await configure({ isLinux: false, isWin: true })

      expect(appendSwitchMock).not.toHaveBeenCalledWith('password-store', expect.anything())
    })
  })

  describe('unconditional feature flags', () => {
    it('always appends the unconditional enable-features flag on macOS', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(effectiveEnabledFeatures()).toEqual(UNCONDITIONAL_FEATURES)
    })

    it('always appends the unconditional enable-features flag on Windows', async () => {
      stubConstants({ isLinux: false, isWin: true })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(effectiveEnabledFeatures()).toEqual(UNCONDITIONAL_FEATURES)
    })

    it('keeps the unconditional features alongside GlobalShortcutsPortal on Linux Wayland', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(effectiveEnabledFeatures()).toEqual([...UNCONDITIONAL_FEATURES, 'GlobalShortcutsPortal'])
    })

    it('keeps features the user passed with --enable-features', async () => {
      vi.stubEnv('XDG_SESSION_TYPE', 'wayland')
      stubConstants({ isLinux: true, isWin: false })
      stubElectron()
      stubBootConfig()
      getSwitchValueMock.mockImplementation((name: string) =>
        name === 'enable-features' ? 'WaylandWindowDecorations' : ''
      )

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(effectiveEnabledFeatures()).toEqual([
        'WaylandWindowDecorations',
        ...UNCONDITIONAL_FEATURES,
        'GlobalShortcutsPortal'
      ])
    })
  })

  describe('all off baseline', () => {
    it('macOS with BootConfig off: only the unconditional feature flag is appended', async () => {
      stubConstants({ isLinux: false, isWin: false })
      stubElectron()
      stubBootConfig({ disableHardwareAcceleration: false })

      const { configureChromiumFlags } = await loadModule()
      configureChromiumFlags()

      expect(disableHardwareAccelerationMock).not.toHaveBeenCalled()
      // Only the unconditional enable-features call: 1 total.
      expect(appendSwitchMock).toHaveBeenCalledTimes(1)
      expect(effectiveEnabledFeatures()).toEqual(UNCONDITIONAL_FEATURES)
    })
  })
})
