import { expect, test } from "@playwright/test";

const suffix = Date.now().toString(36);
const email = `e2e-${suffix}@test.docid`;
const password = "testpass123";

test.describe("Ecrãs da aplicação", () => {
  test.beforeEach(async ({ page }) => {
    const apiBaseUrl = process.env.E2E_API_URL || "http://127.0.0.1:3002";
    await page.addInitScript((base) => {
      localStorage.setItem("docid-config", JSON.stringify({
        state: {
          apiBaseUrl: base,
          theme: "dark",
          avatar: null,
          defaultScanner: null,
          defaultPrinter: null,
          notificationPrefs: {},
        },
        version: 0,
      }));
    }, apiBaseUrl);
  });

  test("onboarding, login, navegação e geração de identificador", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();

    await page.getByRole("button", { name: "Criar organização" }).click();
    await expect(page).toHaveURL(/onboarding/);

    await page.getByPlaceholder("Ex: Minha Empresa").fill(`Org E2E ${suffix}`);
    await page.getByPlaceholder("minha-empresa").fill(`e2e-${suffix}`);
    await page.getByPlaceholder("VL").fill("E2E");
    await page.getByRole("button", { name: /Avançar/ }).click();

    await page.getByPlaceholder("Ex: João Silva").fill("Admin E2E");
    await page.getByPlaceholder("admin@empresa.com").fill(email);
    await page.getByPlaceholder("••••••••").first().fill(password);
    await page.getByPlaceholder("••••••••").nth(1).fill(password);
    await page.getByRole("button", { name: /Rever/ }).click();
    await page.getByRole("button", { name: /Aceitar Termos/ }).click();

    await page.getByRole("region", { name: "Termos e Condições de Uso" })
      .evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.locator("#terms-checkbox").check();
    await page.getByRole("button", { name: /Criar organização/ }).click();
    await expect(page).toHaveURL(/login/);

    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill(password);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Ações rápidas")).toBeVisible();

    for (const label of ["Identificadores", "Documentos", "Aprovações", "Sectores", "Utilizadores", "Auditoria", "Configurações"]) {
      await page.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(label === "Identificadores" ? "identificadores" : label === "Documentos" ? "documentos" : label === "Aprovações" ? "aprovacoes" : label === "Sectores" ? "sectores" : label === "Utilizadores" ? "utilizadores" : label === "Auditoria" ? "auditoria" : "configuracoes"));
    }

    await page.getByRole("link", { name: "Configurações" }).click();
    await page.getByRole("button", { name: "Organização" }).click();
    await expect(page.getByTestId("license-details")).toBeVisible();
    await expect(page.getByTestId("license-details")).toContainText(/DOCID-\d{4}-/);

    await page.getByRole("link", { name: "Identificadores" }).click();
    await page.getByRole("button", { name: /Gerar identificador/ }).click();
    await page.getByRole("button", { name: /Seleccionar categoria/ }).click();
    await page.getByPlaceholder("Pesquisar por nome, código ou grupo...").fill("Proposta");
    await page.getByRole("button", { name: /Proposta Comercial/ }).click();
    await page.getByRole("button", { name: "Gerar", exact: true }).click();
    await expect(page.getByText(/VL-PROP|E2E-PROP/)).toBeVisible();
  });
});
