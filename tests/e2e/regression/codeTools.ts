import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { openLaunchpadApp } from './navigation'

export async function openCodeTool(page: Page, name: string): Promise<void> {
  await openLaunchpadApp(page, 'Code Mate')
  await page.getByRole('button', { name, exact: true }).first().click()
}

export async function configureTool(page: Page, model: string, provider: string): Promise<void> {
  const codeView = page.locator('[data-ui="code.view"]:visible').first()
  const providerName = codeView.getByText(provider, { exact: true }).first()
  const providerCard: Locator = providerName.locator(
    'xpath=ancestor::div[contains(@class, "group") and .//button[normalize-space()="Configure"]][1]'
  )
  await providerCard.scrollIntoViewIfNeeded()
  await providerCard.hover()
  const configure = providerCard.getByRole('button', { name: 'Configure', exact: true })
  await expect(configure).toBeVisible()
  await configure.click()
  const dialog = page.getByRole('dialog').last()
  await expect(dialog).toBeVisible()
  const selectModel = dialog.getByRole('button', { name: 'Select a model', exact: true })
  if (await selectModel.isVisible().catch(() => false)) await selectModel.click()
  const search = dialog.getByRole('textbox').last()
  if (await search.isVisible().catch(() => false)) await search.fill(model)
  await page.getByRole('option').filter({ hasText: model }).first().click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  const enable = providerCard.getByRole('button', { name: 'Enable', exact: true }).first()
  if (await enable.isVisible().catch(() => false)) await enable.click()
}
