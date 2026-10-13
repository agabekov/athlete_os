import { expect, test } from '@playwright/test'
import { readyDashboard } from './fixture'

test('complete dashboard preserves its layout and chart controls at desktop and mobile widths', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/dashboard', route => route.fulfill({ json: readyDashboard }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Demo Athlete' })).toBeVisible()
  await expect(page.getByText(/Data for/)).toContainText('October 13, 2026')
  await expect(page.getByRole('img', { name: /^HRV:/ })).toBeVisible()
  await page.getByRole('button', { name: '30D', exact: true }).click()
  await expect(page.getByRole('button', { name: '30D', exact: true })).toHaveAttribute('aria-pressed', 'true')
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.screenshot({ path: '/tmp/athlete-os-dashboard-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 320, height: 900 })
  await page.screenshot({ path: '/tmp/athlete-os-dashboard-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('a delayed initial status cannot overwrite a newer sync operation', async ({ page }) => {
  let initial = true
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let polls = 0
  let dashboardCalls = 0
  await page.route('**/api/dashboard', route => { dashboardCalls++; return route.fulfill({ json: { state: 'empty' } }) })
  await page.route('**/api/sync', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 202, json: { state: 'running' } })
      release()
      return
    }
    if (initial) { initial = false; await gate; return route.fulfill({ json: { state: 'idle' } }) }
    return route.fulfill({ json: { state: ++polls < 2 ? 'running' : 'succeeded' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Run first sync' }).click()
  await expect(page.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Run first sync' })).toBeEnabled({ timeout: 10_000 })
  expect(dashboardCalls).toBeGreaterThan(1)
})

test('a lost POST response resumes polling for the job accepted by the server', async ({ page }) => {
  let accepted = false
  let polls = 0
  await page.route('**/api/dashboard', route => route.fulfill({ json: { state: 'empty' } }))
  await page.route('**/api/sync', route => {
    if (route.request().method() === 'POST') { accepted = true; return route.abort('failed') }
    return route.fulfill({ json: { state: !accepted ? 'idle' : ++polls < 2 ? 'running' : 'succeeded' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Run first sync' }).click()
  await expect(page.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Run first sync' })).toBeEnabled({ timeout: 10_000 })
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('connect screen loads, remains usable on mobile, and sends OAuth through the server', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Your WHOOP story/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Connect WHOOP' })).toHaveAttribute('href', '/api/auth/login')
  await page.setViewportSize({ width: 320, height: 800 })
  await expect(page.getByRole('link', { name: 'Connect WHOOP' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('initial API failure offers retry and recovers', async ({ page }) => {
  let failed = false
  await page.route('**/api/dashboard', route => {
    if (!failed) { failed = true; return route.fulfill({ status: 500, body: '{}' }) }
    return route.fulfill({ json: { state: 'disconnected' } })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Could not load')
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('link', { name: 'Connect WHOOP' })).toBeVisible()
})

test('sync polls status and refreshes the dashboard after completion', async ({ page }) => {
  let running = false
  let polls = 0
  await page.route('**/api/dashboard', route => route.fulfill({ json: { state: 'empty' } }))
  await page.route('**/api/sync', route => {
    if (route.request().method() === 'POST') { running = true; return route.fulfill({ status: 202, json: { state: 'running' } }) }
    const state = !running ? 'idle' : ++polls < 2 ? 'running' : 'succeeded'
    return route.fulfill({ json: { state } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Run first sync' }).click()
  await expect(page.getByRole('button', { name: 'Syncing…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Run first sync' })).toBeEnabled({ timeout: 10_000 })
  expect(polls).toBeGreaterThanOrEqual(2)
})
