import { describe, expect, test } from "bun:test";
import { licenseInputFromOrder } from "../services/order.service";

describe("licenseInputFromOrder", () => {
  test("aprovação emite licença anual com limite do plano", () => {
    const decidedAt = new Date("2026-11-23T12:00:00Z");
    const input = licenseInputFromOrder(
      { tenantId: "t1", planId: "p1" } as any,
      { maxUsers: 20 } as any,
      decidedAt,
      "provider-1",
    );
    expect(input.tenantId).toBe("t1");
    expect(input.planId).toBe("p1");
    expect(input.maxUsers).toBe(20);
    expect(input.status).toBe("active");
    expect(input.validUntil?.toISOString()).toBe("2027-11-23T12:00:00.000Z");
    expect(input.providerUserId).toBe("provider-1");
  });
});
