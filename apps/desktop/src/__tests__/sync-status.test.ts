import { describe, it, expect } from "bun:test";
import { syncStatusLabel } from "../interfaces/hooks/useSyncStatus";

describe("estado da sincronização na barra lateral", () => {
  it("mostra sem ligação quando offline", () => {
    expect(syncStatusLabel(false, false, 3, null)).toBe("Sem ligação");
  });
  it("mostra a sincronizar em curso", () => {
    expect(syncStatusLabel(true, true, 2, null)).toBe("A sincronizar…");
  });
  it("mostra tudo em dia quando não há pendências", () => {
    expect(syncStatusLabel(true, false, 0, null)).toBe("Em dia");
  });
  it("mostra a hora da última sincronização quando há pendências", () => {
    expect(syncStatusLabel(true, false, 1, "2026-11-25T10:32:00Z")).toBe("Por sincronizar");
    expect(syncStatusLabel(true, false, 0, "2026-11-25T10:32:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
