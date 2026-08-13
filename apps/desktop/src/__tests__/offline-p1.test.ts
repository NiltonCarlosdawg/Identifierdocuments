import { describe, expect, test } from "bun:test";
import { isNetworkError, mapError, NETWORK_ERROR_MESSAGE } from "../shared/errors/mapError";
import { CACHE_TTLS, DEFAULT_TTL_MS, resolveCacheTtl } from "../infrastructure/storage/OfflineCache";
import { pendingCount, type QueueItem } from "../domain/entities/QueueItem";

describe("Fase 9 — detecção de rede para enqueue de upload", () => {
  test("erros de browser e reqwest são rede", () => {
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(true);
    expect(isNetworkError("error sending request for url")).toBe(true);
    expect(isNetworkError("operation timed out")).toBe(true);
    expect(isNetworkError("dns error: no such host")).toBe(true);
    expect(isNetworkError("connection refused")).toBe(true);
  });

  test("erros de negócio NÃO são rede (não enfileiram)", () => {
    expect(isNetworkError(new Error("Este identificador já possui um documento principal."))).toBe(false);
    expect(isNetworkError('{"error":{"code":"ATTACH_ERROR"}}')).toBe(false);
    expect(isNetworkError(new Error("422 Unprocessable Entity"))).toBe(false);
  });

  test("mapError devolve mensagem de rede uniforme", () => {
    expect(mapError(new Error("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE);
  });
});

describe("Fase 9 — fila após upload com sucesso", () => {
  test("itens uploaded não contam como pendentes (sai da fila activa)", () => {
    const rows: QueueItem[] = [
      {
        id: "1", file_path: "/a", filename: "a.pdf", identifier: "ID-1",
        tenant_id: "t", user_id: "u", status: "uploaded", attempts: 0,
        last_error: null, created_at: new Date().toISOString(),
      },
      {
        id: "2", file_path: "/b", filename: "b.pdf", identifier: "ID-2",
        tenant_id: "t", user_id: "u", status: "pending", attempts: 0,
        last_error: null, created_at: new Date().toISOString(),
      },
    ];
    expect(pendingCount(rows)).toBe(1);
  });
});

describe("Fase 10 — TTL de cache auxiliar", () => {
  test("match exacto de /categories", () => {
    expect(resolveCacheTtl("/categories", CACHE_TTLS)).toBe(CACHE_TTLS["/categories"]);
  });

  test("match dinâmico /sectors/:id/members", () => {
    expect(resolveCacheTtl("/sectors/abc-123/members", CACHE_TTLS)).toBe(CACHE_TTLS["/sectors/:id/members"]);
  });

  test("endpoint desconhecido usa DEFAULT_TTL_MS", () => {
    expect(resolveCacheTtl("/unknown/path", CACHE_TTLS)).toBe(DEFAULT_TTL_MS);
  });
});
