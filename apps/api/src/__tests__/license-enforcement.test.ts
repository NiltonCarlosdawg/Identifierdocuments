import { describe, it, expect } from "bun:test";
import { computeLicenseState, isBlockedWhenReadOnly, trialLicenseValues } from "../services/license-enforcement.service";

const DAY = 24 * 3600 * 1000;
const now = new Date("2026-11-23T12:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("estado da licença", () => {
  it("sem prazo ou dentro do prazo: activa", () => {
    expect(computeLicenseState({ licenseValidUntil: null, licenseStatus: "active" }, now, 7)).toMatchObject({ state: "active", canWrite: true, daysLeft: null });
    expect(computeLicenseState({ licenseValidUntil: at(10), licenseStatus: "active" }, now, 7)).toMatchObject({ state: "active", canWrite: true, daysLeft: 10 });
  });
  it("até 7 dias depois do fim: tolerância, continua a escrever", () => {
    const s = computeLicenseState({ licenseValidUntil: at(-3), licenseStatus: "active" }, now, 7);
    expect(s).toMatchObject({ state: "grace", canWrite: true });
    expect(s.graceUntil?.toISOString()).toBe(at(4).toISOString());
  });
  it("depois da tolerância: só consulta", () => {
    expect(computeLicenseState({ licenseValidUntil: at(-8), licenseStatus: "active" }, now, 7)).toMatchObject({ state: "expired", canWrite: false });
  });
  it("suspensa: só consulta mesmo dentro do prazo", () => {
    expect(computeLicenseState({ licenseValidUntil: at(100), licenseStatus: "suspended" }, now, 7)).toMatchObject({ state: "suspended", canWrite: false });
  });
  it("organização nova: teste de 14 dias com 5 utilizadores", () => {
    const t = trialLicenseValues(now);
    expect(t.licenseValidUntil.toISOString()).toBe(at(14).toISOString());
    expect(t.licenseMaxUsers).toBe(5);
  });
});

describe("o que fica bloqueado em só consulta", () => {
  it("leituras passam sempre", () => {
    expect(isBlockedWhenReadOnly("GET", "/documents")).toBe(false);
    expect(isBlockedWhenReadOnly("GET", "/documents/X/download")).toBe(false);
  });
  it("criar, carregar, partilhar e gerir ficam bloqueados", () => {
    for (const p of ["/identifiers/generate", "/identifiers/lease", "/documents/attach", "/documents/X/share", "/users", "/sectors", "/approvals/1", "/email/settings"]) {
      expect(isBlockedWhenReadOnly("POST", p)).toBe(true);
    }
  });
  it("conta, notificações e sincronização fiscal offline continuam a funcionar", () => {
    for (const p of ["/auth/login", "/auth/refresh", "/auth/me/password", "/notifications/abc/read", "/devices", "/identifiers/register-offline", "/identifiers/register-offline-loose", "/identifiers/release", "/platform/licenses/X"]) {
      expect(isBlockedWhenReadOnly(p.startsWith("/notifications") || p.startsWith("/platform") ? "PATCH" : "POST", p)).toBe(false);
    }
  });
});
