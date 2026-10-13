import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:3100' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3100',
    env: { PORT: '3100', WHOOP_DB_PATH: ':memory:', WHOOP_CLIENT_ID: 'browser-fixture', WHOOP_CLIENT_SECRET: 'browser-fixture' },
    reuseExistingServer: false,
  },
})
