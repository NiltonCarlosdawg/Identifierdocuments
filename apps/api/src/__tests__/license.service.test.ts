import { describe, expect, test } from "bun:test";
import { deriveLicenseContext, trialLicenseInput } from "../services/license.service";

const plan = { id: "p1", name: "Pro", maxUsers: 50 } as any;
const now = new Date("2026-11-23T12:00:00Z");

describe("deriveLicenseContext", () => {
  test("maxUsers da licença prevalece sobre o plano", () => {
    const ctx = deriveLicenseContext(
      { status: "active", validUntil: null, maxUsers: 5, planId: "p1" } as any,
      plan,
      now,
    );
    expect(ctx.maxUsers).toBe(5);
    expect(ctx.state).toBe("active");
  });
  test("sem maxUsers na licença usa o plano", () => {
    const ctx = deriveLicenseContext(
      { status: "active", validUntil: null, maxUsers: null, planId: "p1" } as any,
      plan,
      now,
    );
    expect(ctx.maxUsers).toBe(50);
  });
  test("suspensa fica só-leitura", () => {
    const ctx = deriveLicenseContext(
      { status: "suspended", validUntil: new Date("2027-01-01"), maxUsers: null, planId: "p1" } as any,
      plan,
      now,
    );
    expect(ctx.state).toBe("suspended");
    expect(ctx.readOnly).toBe(true);
  });
  test("sem licença não há direito de uso", () => {
    const ctx = deriveLicenseContext(null, plan, now);
    expect(ctx.state).toBe("none");
    expect(ctx.readOnly).toBe(true);
  });
});

describe("trialLicenseInput", () => {
  test("14 dias e 5 utilizadores", () => {
    const input = trialLicenseInput("t1", { id: "p1", maxUsers: 1 } as any, now);
    expect(input.tenantId).toBe("t1");
    expect(input.planId).toBe("p1");
    expect(input.status).toBe("trial");
    expect(input.maxUsers).toBe(5);
    expect(input.validUntil?.toISOString()).toBe("2026-12-07T12:00:00.000Z");
  });
});
