import { test, expect } from "@playwright/test";

test.describe("Login UI (smoke)", () => {
  test("mostra marca DocID e formulário de login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "DocID" })).toBeVisible();
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("login-password")).toBeVisible();
    await expect(page.getByTestId("login-submit")).toBeVisible();
    await expect(page.getByText("Gestão Documental Empresarial")).toBeVisible();
  });

  test("navegação para criar organização", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Criar organização" }).click();
    await expect(page).toHaveURL(/onboarding/);
  });
});
