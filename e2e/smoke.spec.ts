import { expect, test } from '@playwright/test'

type SimHook = {
  frameCount: number
  tickCount: number
  running: boolean
  drone0: [number, number]
  activeFires: number
}
const readSim = () => (window as unknown as { __SIM__?: SimHook }).__SIM__

test('sim boots, runs >=1000 frames, and advances state with no console errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('/')

  // Tab shell + map mount.
  await page.getByRole('button', { name: 'God Mode' }).click()
  await expect(page.getByTestId('view-title')).toContainText('God Mode')
  await expect(page.locator('.map-canvas canvas').first()).toBeVisible({ timeout: 20_000 })

  // God Mode fleet panel lists all 8 drones.
  await expect(page.locator('.fleet-row')).toHaveCount(8)

  // Fast-forward so the season advances quickly.
  await page.getByTestId('speed-60').click()

  const s1 = await page.evaluate(readSim)
  expect(s1).toBeTruthy()

  // The rAF loop is live: poll until it has rendered >=1000 frames.
  await expect
    .poll(async () => (await page.evaluate(readSim))?.frameCount ?? 0, {
      timeout: 60_000,
      intervals: [250],
    })
    .toBeGreaterThanOrEqual(1000)

  const s2 = await page.evaluate(readSim)
  expect(s2!.frameCount).toBeGreaterThan(s1!.frameCount)
  // Sim state really progressed (not just the rAF ticking).
  expect(s2!.tickCount).toBeGreaterThan(s1!.tickCount)
  // At least one drone's position changed between samples.
  const moved = s2!.drone0[0] !== s1!.drone0[0] || s2!.drone0[1] !== s1!.drone0[1]
  expect(moved).toBe(true)

  expect(errors, `page/console errors:\n${errors.join('\n')}`).toEqual([])
})
