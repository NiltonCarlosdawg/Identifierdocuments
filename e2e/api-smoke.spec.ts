import { test, expect } from "@playwright/test";

/**
 * Smoke opcional contra API real. Corre apenas se API_E2E_URL estiver definido
 * (ex.: http://localhost:3000) — não bloqueia o CI sem Postgres/Redis.
 */
const API = process.env.API_E2E_URL;

test.describe("API smoke (opcional)", () => {
  test.skip(!API, "Defina API_E2E_URL para correr smoke da API");

  test("GET /health responde ok", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ status: expect.anything() });
  });
});
