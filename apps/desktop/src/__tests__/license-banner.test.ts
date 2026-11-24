import { describe, it, expect } from "bun:test";
import { licenseNotice, type LicenseInfo } from "../interfaces/components/LicenseBanner";

const base: LicenseInfo = {
  licenseNumber: "DOCID-2026-AAAA-BBBB-CCCC", plan: "trial", state: "active", canWrite: true,
  validUntil: "2026-12-07T12:00:00Z", graceUntil: "2026-12-14T12:00:00Z", daysLeft: 14, maxUsers: 5, activeUsers: 1,
};

describe("aviso de licença na app", () => {
  it("sem aviso quando falta muito tempo", () => {
    expect(licenseNotice(base)).toBeNull();
    expect(licenseNotice(null)).toBeNull();
  });
  it("teste com 7 dias ou menos: informação", () => {
    expect(licenseNotice({ ...base, daysLeft: 3 })).toMatchObject({ tone: "info" });
    expect(licenseNotice({ ...base, daysLeft: 3 })!.text).toContain("faltam 3 dias");
  });
  it("tolerância: aviso com a data limite", () => {
    const n = licenseNotice({ ...base, state: "grace", daysLeft: -2 })!;
    expect(n.tone).toBe("warning");
    expect(n.text).toContain("14/12/2026");
  });
  it("expirada ou suspensa: erro e modo só consulta", () => {
    expect(licenseNotice({ ...base, state: "expired", canWrite: false })).toMatchObject({ tone: "error" });
    expect(licenseNotice({ ...base, state: "suspended", canWrite: false })!.text).toContain("suspensa");
  });
});
