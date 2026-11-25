import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 90000,
  workers: 1,
  reporter: 'list',
})
