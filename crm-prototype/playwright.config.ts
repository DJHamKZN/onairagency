import { defineConfig } from '@playwright/test';

// Браузерные проверки запускают локальный сервер на отдельной временной базе.
const PORT = 5181;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, screenshot: 'only-on-failure' },
  webServer: {
    command: `rm -rf ./data/e2e && npm run build && DB_PATH=./data/e2e/crm.sqlite DEMO_USER_PASSWORD=e2e-pass PORT=${PORT} node --disable-warning=ExperimentalWarning --import tsx server/main.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-390', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
