import { expect, test } from '@playwright/test'

test('boots the SPA and renders the map with no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')

  // Tab shell: God Mode selectable, view title reflects it.
  await page.getByRole('button', { name: 'God Mode' }).click()
  await expect(page.getByTestId('view-title')).toContainText('God Mode')

  // MapLibre canvas mounts inside the deck/map container.
  const canvas = page.locator('.map-canvas canvas').first()
  await expect(canvas).toBeVisible({ timeout: 20_000 })

  // Switch to the User Console tab too — both tabs share the view component.
  await page.getByRole('button', { name: 'User Console' }).click()
  await expect(page.getByTestId('view-title')).toContainText('User Console')

  // Let deck.gl/MapLibre settle, then assert a clean run.
  await page.waitForTimeout(1500)
  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([])
})
