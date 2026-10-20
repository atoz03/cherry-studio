import { useEffect, useRef } from 'react'

import { ipcApi } from '@renderer/ipc'

/**
 * Tell the main process that this window's UI has rendered its first frame. Windows created on
 * demand (detached tab, quick assistant, selection toolbar and action) stay hidden until then, so
 * they appear with their content instead of as a blank frame (main `firstFrame.ts`).
 *
 * Call it once per window, from a component that only that window renders. Pass `ready = false`
 * while the shell still waits for data its first meaningful frame needs (e.g. init data).
 */
export function useReportFirstFrame(ready = true): void {
  const reported = useRef(false)

  useEffect(() => {
    if (!ready || reported.current) return
    reported.current = true
    // The first animation frame paints the commit; reporting from the next one means the window
    // already holds that frame when main shows it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void ipcApi.request('window.report_first_frame')
      })
    )
  }, [ready])
}
