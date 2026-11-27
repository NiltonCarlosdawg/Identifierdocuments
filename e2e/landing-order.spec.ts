import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL || "http://127.0.0.1:3002";

test.describe("Landing — pedido de um cliente novo", () => {
  test("tabela com os preços da API e pedido sem conta chega à API", async ({ page, request }) => {
    const plans = (await (await request.get(`${API}/plans`)).json()).plans as Array<{ name: string; price: number }>;
    // A tabela mostra só estes três planos; outros planos pagos (ex.: criados pelo teste do
    // painel na mesma base) não aparecem nela.
    const TABLE = ["essencial", "profissional", "empresarial"];
    const paid = plans.filter((p) => p.price > 0 && TABLE.includes(p.name.toLowerCase()));
    expect(paid.length).toBeGreaterThan(0);

    await page.goto("/");
    // Os preços da tabela são os da API (nada fixo no código).
    const fmt = new Intl.NumberFormat("pt-PT");
    for (const p of paid) {
      await expect(page.getByText(`${fmt.format(p.price)} Kz`).first()).toBeVisible();
    }

    const plan = paid[0];
    await page.goto(`/?plano=${encodeURIComponent(plan.name)}#pedido`);
    await expect(page.getByTestId("checkout-selected-plan")).toHaveText(plan.name);

    const company = `Empresa E2E ${Date.now().toString(36)}`;
    await page.getByTestId("checkout-company").fill(company);
    await page.getByTestId("checkout-contact-name").fill("Cliente de Teste");
    await page.getByTestId("checkout-phone").fill("923000000");
    await page.getByTestId("checkout-email").fill("cliente-e2e@example.invalid");
    await page.getByTestId("checkout-submit").click();

    await expect(page.getByTestId("checkout-success")).toBeVisible();
    await expect(page.getByTestId("checkout-success")).toContainText("criar a conta");
  });

  test("cliente que diz ter conta mas não existe vê a mensagem da API", async ({ page }) => {
    await page.goto("/?plano=Essencial#pedido");
    await page.getByTestId("checkout-existing").click();
    await page.getByTestId("checkout-slug").fill("organizacao-que-nao-existe");
    await page.getByTestId("checkout-phone").fill("923000000");
    await page.getByTestId("checkout-email").fill("cliente-e2e@example.invalid");
    await page.getByTestId("checkout-submit").click();
    await expect(page.getByTestId("checkout-error")).toHaveText("Organização não encontrada.");
  });
});
