import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { RegressionApp } from './RegressionApp'
import { openSettingsSection } from './settings'

const REGRESSION_KEY_LABEL = 'Regression'

export async function ensureCherryInApiKey(app: RegressionApp, page: Page): Promise<void> {
  const status = await page.evaluate(
    async ({ key, label }) => {
      const request = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
        window.api.dataApi.request({ id: `regression-cherryin-${method}-${Date.now()}`, method, path, body })
      const response = await request('GET', '/providers/cherryin/api-keys')
      const keys = (response.data as { keys?: Array<{ label?: string }> } | undefined)?.keys ?? []
      if (!keys.some((entry) => entry.label === label)) {
        await request('POST', '/providers/cherryin/api-keys', { key, label })
      }
      return (await request('PATCH', '/providers/cherryin', { isEnabled: true })).status
    },
    { key: app.config.cherryIn.apiKey, label: REGRESSION_KEY_LABEL }
  )
  expect(status).toBe(200)
  await openSettingsSection(page, 'Model Provider')
  const cherryIn = page.getByTestId('provider-list-item-cherryin')
  await cherryIn.click()
  await expect(cherryIn).toHaveAttribute('data-selected', 'true')
}

export async function addCherryInModel(page: Page, model: string, tab?: string): Promise<void> {
  if (
    await page
      .getByText(model, { exact: true })
      .isVisible()
      .catch(() => false)
  )
    return
  await page.getByRole('button', { name: 'Sync models', exact: true }).click()
  const drawer = page.locator('[data-slot="page-side-panel"][role="dialog"]:visible').first()
  await expect(drawer).toBeVisible()
  if (tab) {
    const tabLocator = drawer.getByRole('tab', { name: new RegExp(tab, 'i') })
    if (await tabLocator.isVisible().catch(() => false)) await tabLocator.click()
  }
  const search = drawer.getByPlaceholder('Search models')
  await expect(search).toBeEnabled()
  await search.fill(model)
  await expect(drawer.getByText(model, { exact: true })).toBeVisible()
  const add = drawer.getByRole('button', { name: 'Add', exact: true }).first()
  if (await add.isVisible().catch(() => false)) await add.click()
  await drawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(drawer).toBeHidden()
}
