import { expect, test } from "@playwright/test";

/**
 * Tela de Documentos (lista + painel lateral): pesquisa e filtros no servidor, URL,
 * painel com separadores e navegação pelo teclado. Os dados são criados pela API.
 */
const API = process.env.E2E_API_URL || "http://127.0.0.1:3002";
const tag = Date.now().toString(36);
const email = `docs-${tag}@test.docid`;
const password = "testpass123";

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (typeof init.body === "string") headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const pdf = (title: string) => `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF ${title}`;

test.describe("Documentos", () => {
  test.beforeAll(async () => {
    await call("/tenants", {
      method: "POST",
      body: JSON.stringify({ name: `Docs E2E ${tag}`, slug: `docs-${tag}`, adminEmail: email, adminPassword: password, adminName: "Admin Docs", identifierPrefix: "DE", termsAccepted: true }),
    });
    const login = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    const token = login.data?.token ?? login.token;
    const cats = await call("/categories", { token });
    const groups = cats.data.groups;
    const categories: Array<{ id: string; name: string }> = Array.isArray(groups)
      ? groups.flatMap((g: { categories?: unknown[]; items?: unknown[] }) => (g.categories ?? g.items ?? []) as Array<{ id: string; name: string }>)
      : (Object.values(groups).flat() as Array<{ id: string; name: string }>);
    for (const [i, name] of ["proposta-acme.pdf", "factura-0042.pdf", "relatorio-anual.pdf"].entries()) {
      const g = await call("/identifiers/generate", { method: "POST", token, body: JSON.stringify({ categoryId: categories[i].id, description: name }) });
      const fd = new FormData();
      fd.append("identifier", g.data?.identifier ?? g.identifier);
      fd.append("file", new File([pdf(name)], name, { type: "application/pdf" }));
      await call("/documents/attach", { method: "POST", token, body: fd });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((base) => {
      localStorage.setItem("docid-config", JSON.stringify({
        state: { apiBaseUrl: base, theme: "dark", avatar: null, defaultScanner: null, defaultPrinter: null, notificationPrefs: {} },
        version: 0,
      }));
    }, API);
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-password").press("Enter");
    await expect(page).not.toHaveURL(/login/);
  });

  test("lista, pesquisa no servidor, painel e teclado", async ({ page }) => {
    await page.goto("/documentos", { waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("document-row");
    await expect(rows).toHaveCount(3);

    // Pesquisa (no servidor) e o URL acompanha.
    await page.getByTestId("documents-search").fill("factura");
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/q=factura/);
    await page.getByTestId("documents-search").fill("nada-corresponde");
    await expect(page.getByTestId("documents-empty")).toBeVisible();
    await page.getByTestId("documents-clear").click();
    await expect(rows).toHaveCount(3);

    // Painel lateral com separadores.
    await rows.first().click();
    const panel = page.getByTestId("document-panel");
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/doc=/);
    await page.getByTestId("document-tab-actividade").click();
    await expect(page.getByTestId("document-activity")).toContainText("Documento associado");

    // Menu "Mais": o Esc fecha o menu, não o painel; depois fecha o painel.
    await page.getByTestId("document-more").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(panel).toBeVisible();

    // ↓ passa ao documento seguinte.
    const first = await page.getByTestId("document-panel-title").textContent();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("document-panel-title")).not.toHaveText(first ?? "");

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("filtros: âmbito e categoria", async ({ page }) => {
    await page.goto("/documentos", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-row")).toHaveCount(3);
    await page.getByTestId("documents-scope-shared").click();
    await expect(page.getByTestId("documents-empty")).toBeVisible(); // nada partilhado com o admin
    await page.getByTestId("documents-scope-mine").click();
    await expect(page.getByTestId("document-row")).toHaveCount(3);

    await page.getByTestId("documents-filters-toggle").click();
    const select = page.getByTestId("documents-filter-category");
    const firstCategory = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(firstCategory!);
    await expect(page.getByTestId("document-row")).toHaveCount(1);
    await expect(page).toHaveURL(/cat=/);
  });
});
