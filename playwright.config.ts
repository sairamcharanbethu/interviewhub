import fs from 'fs';
import os from 'os';
import path from 'path';
import { defineConfig } from '@playwright/test';

// E2E runs against a production build with a throwaway DATA_DIR — never ./data.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-e2e-'));
process.env.E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run start -- -p 3100',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATA_DIR: dataDir,
      SKILLS_DIR: path.join(dataDir, 'skills'),
      PORT: '3100',
    },
  },
});
