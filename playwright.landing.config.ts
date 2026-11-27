import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Landing (apps/landing) contra a API em E2E_API_URL (por omissão http://127.0.0.1:3002).
// Construir antes com VITE_API_URL a apontar para essa API.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "landing-*.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run preview -- --host 127.0.0.1 --port ${PORT}`,
    cwd: "apps/landing",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
