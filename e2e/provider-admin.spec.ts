import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_API_URL || "http://127.0.0.1:3002";
const SUFFIX = Date.now().toString(36);
const PLAN = `Painel ${SUFFIX}`;

test.describe("Painel da provedora", () => {
  test("login, planos, pedidos e licenças", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("provider-email").fill("admin@docid.local");
    await page.getByTestId("provider-password").fill("testpass123");
    await page.getByTestId("provider-submit").click();
    await expect(page.getByTestId("tab-orders")).toBeVisible();

    for (const tab of ["orders", "plans", "tenants", "licenses"]) {
      await expect(page.getByTestId(`tab-${tab}`)).toBeVisible();
    }

    await page.getByTestId("tab-plans").click();
    await page.getByTestId("plan-name").fill(PLAN);
    await page.getByTestId("plan-price").fill("250000");
    await page.getByTestId("plan-users").fill("20");
    await page.getByTestId("plan-save").click();
    await expect(page.locator("tr[data-testid='plan-row']").filter({ hasText: PLAN })).toBeVisible();

    const setup = await page.evaluate(async ({ base, planName }) => {
      const token = localStorage.getItem("docid-provider-token");
      const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const tenants = await (await fetch(`${base}/provider/tenants`, { headers: h })).json();
      const plans = await (await fetch(`${base}/provider/plans`, { headers: h })).json();
      const tenant = tenants.find((t: any) => t.slug?.startsWith("e2e-")) || tenants[0];
      const plan = plans.plans.find((p: any) => p.name === planName);
      const res = await fetch(`${base}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug: tenant.slug, planId: plan.id, paymentMethod: "transfer", phone: "900000000", contactEmail: "e2e@test.docid" }),
      });
      const body = await res.json();
      return { slug: tenant.slug, name: tenant.name, orderId: body.orderId, error: body.error };
    }, { base: BASE, planName: PLAN });
    expect(setup.error).toBeFalsy();

    await page.getByTestId("tab-orders").click();
    const orderRow = page.locator("tr[data-testid='order-row']")
      .filter({ hasText: setup.name })
      .filter({ hasText: PLAN });
    await expect(orderRow).toBeVisible();
    await orderRow.getByTestId("order-approve").click();

    const licenseNumber = await page.evaluate(async ({ base, name }) => {
      const token = localStorage.getItem("docid-provider-token");
      const rows = await (await fetch(`${base}/provider/licenses`, { headers: { Authorization: `Bearer ${token}` } })).json();
      const row = rows.find((r: any) => r.tenantName === name);
      return row?.licenseNumber;
    }, { base: BASE, name: setup.name });
    expect(licenseNumber).toMatch(/^DOCID-\d{4}-/);

    await page.getByTestId("tab-licenses").click();
    const licenseRow = page.locator("tr[data-testid='license-row']").filter({ hasText: licenseNumber });
    await expect(licenseRow).toContainText("Activa");
    await expect(licenseRow).toContainText("20");

    await licenseRow.getByTestId("license-suspend").click();
    await expect(licenseRow).toContainText("Suspensa");

    await licenseRow.getByRole("button", { name: "Activar" }).click();
    await expect(licenseRow).toContainText("Activa");
  });
});
