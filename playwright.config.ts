import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 12000,
  outputDir: process.env.PW_OUTPUT_DIR ?? 'test-results',
  reporter: process.env.PW_JSON ? [['json', { outputFile: process.env.PW_JSON }]] : 'list',
  use: { baseURL: process.env.SHOP_URL ?? 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
