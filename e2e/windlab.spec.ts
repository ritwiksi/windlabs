import { test, expect } from '@playwright/test'

test('end-to-end: real wake simulation, wind control, constrained optimization', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Design for/i })).toBeVisible()
  await expect(page.locator('.badge-status')).toContainText('MODEL READY')
  await expect(page.locator('.metric-primary strong')).not.toContainText('—')
  await expect(page.locator('.source')).toContainText('ERA5 HISTORICAL RESOURCE')
  await expect(page.locator('.cesium-viewer canvas')).toHaveCount(1)

  await page.locator('#speed').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.badge-status')).toContainText('MODEL READY')
  await expect(page.locator('.error')).toHaveCount(0)

  await page.screenshot({ path: 'test-results/windlab-before.png', fullPage: true })
  await page.getByRole('button', { name: /Optimize turbine layout/ }).click()
  await expect(page.locator('.badge-status')).toContainText('MODEL READY', { timeout: 110_000 })
  await expect(page.locator('.error')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/windlab-after.png', fullPage: true })
  expect(errors).toEqual([])
})
