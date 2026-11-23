import { describe, expect, test } from "bun:test";
import { formatLicenseNumber, licenseState } from "../lib/license";

const now = new Date("2026-11-23T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * 86_400_000);

describe("licenseState", () => {
  test("trial dentro do prazo", () => {
    expect(licenseState({ status: "trial", validUntil: d(5) }, now)).toBe("trial");
  });
  test("expirada até 7 dias fica em tolerância", () => {
    expect(licenseState({ status: "active", validUntil: d(-3) }, now)).toBe("grace");
  });
  test("expirada além da tolerância fica só-leitura", () => {
    expect(licenseState({ status: "active", validUntil: d(-10) }, now)).toBe("read_only");
  });
  test("suspensa independentemente da validade", () => {
    expect(licenseState({ status: "suspended", validUntil: d(100) }, now)).toBe("suspended");
  });
  test("sem prazo é válida", () => {
    expect(licenseState({ status: "active", validUntil: null }, now)).toBe("active");
  });
});

describe("formatLicenseNumber", () => {
  test("agrupa o seed em 4-4-4", () => {
    expect(formatLicenseNumber(2026, "A3TBTE432ZPX")).toBe("DOCID-2026-A3TB-TE43-2ZPX");
  });
});
