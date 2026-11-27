import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Painel da provedora (apps/admin). Precisa da API em E2E_API_URL (por omissão
// http://127.0.0.1:3002) e de um utilizador admin@docid.local (bun run provider:create).
export default defineConfig({
  testDir: "./e2e",
  testMatch: "provider-admin.spec.ts",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run preview",
    cwd: "apps/admin",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
