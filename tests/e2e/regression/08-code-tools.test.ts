import type { Page } from '@playwright/test'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { listOwnedProcessIds, observeOwnedProcess } from '../../../scripts/e2e/regression/processEvidence'
import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { configureTool, openCodeTool } from './codeTools'
import { expect, test } from './fixture'
import { CUSTOM_CHAT_PROVIDER, ensureCustomChatProvider } from './models'
import type { RegressionApp } from './RegressionApp'
import { closeSettings } from './settings'

async function launchWithWorkspace(app: RegressionApp, page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Launch', exact: true }).click()
  const selectFolder = page.getByText('Select Folder', { exact: true })
  if (await selectFolder.isVisible().catch(() => false)) {
    await selectFolder.click()
    await page.waitForTimeout(1_000)
    chooseNativeFile(app.record.platform, app.paths, app.paths.workspace)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('textbox', { name: 'Select working directory', exact: true })).toHaveValue(
      app.paths.workspace
    )
    await dialog.getByRole('button', { name: 'Launch', exact: true }).click()
  }
}

test(...caseDefinition('CODE-01'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'Claude Code')
  await configureTool(page, app.config.customProvider.chatModel, 'Unified Gateway')
  await launchWithWorkspace(app, page)
  await expect
    .poll(() => observeOwnedProcess(app.record, 'claude', true, baseline).passed, { timeout: 60_000 })
    .toBe(true)
})

test(...caseDefinition('CODE-02'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenAI Codex')
  await configureTool(page, app.config.customProvider.chatModel, 'Unified Gateway')
  await launchWithWorkspace(app, page)
  await expect
    .poll(() => observeOwnedProcess(app.record, 'codex', true, baseline).passed, { timeout: 60_000 })
    .toBe(true)
})

test(...caseDefinition('CODE-03'), async ({ app, mainWindow: page }) => {
  await ensureCustomChatProvider(app, page)
  await closeSettings(page)
  const baseline = new Set(listOwnedProcessIds(app.record))
  await openCodeTool(page, 'OpenClaw')
  await configureTool(page, app.config.customProvider.chatModel, CUSTOM_CHAT_PROVIDER)
  await page
    .locator('[data-ui="code.view"]:visible')
    .first()
    .getByRole('button', { name: 'Launch', exact: true })
    .click()
  await expect
    .poll(() => observeOwnedProcess(app.record, 'openclaw', true, baseline).passed, { timeout: 2 * 60_000 })
    .toBe(true)
})
