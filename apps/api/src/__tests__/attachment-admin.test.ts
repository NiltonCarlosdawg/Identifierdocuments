import { describe, expect, test } from "bun:test";
import { canAccessDocument, listDocumentsForApi } from "../services/attachment.service";
import type { AuthPayload } from "../middleware/auth";

const auth = (userId: string, tenantId: string, sectorId: string): AuthPayload => ({
  userId,
  tenantId,
  sectorId,
  roles: [],
});

const forbiddenTx = {
  query: new Proxy({}, {
    get() {
      throw new Error("admin não deve precisar de consultar partilhas");
    },
  }),
};

describe("admin do tenant em documentos sector_only", () => {
  test("admin descarrega sector_only de outro sector", async () => {
    const result = await canAccessDocument(
      forbiddenTx as any,
      auth("admin-a", "tenant-a", "sector-a"),
      "sector-b",
      "sector_only",
      "doc-b",
      "user-b",
      ["ORG_ADMIN"],
    );
    expect(result).toEqual({ allowed: true, restricted: false });
  });

  test("listagem do admin inclui sector_only de outro sector e respeita tenant", async () => {
    const row = (id: string, tenantId: string) => ({
      id,
      tenantId,
      kind: "primary",
      tags: null,
      createdAt: new Date(),
      identifier: { visibility: "sector_only", sectorId: "sector-b", category: null },
      uploader: null,
      versions: [],
    });
    const rows = [row("doc-b", "tenant-a"), row("doc-c", "tenant-b")];
    const selectChain = { from: () => ({ where: async () => [] }) };
    const fake = {
      query: { documents: { findMany: async () => rows.filter((r) => r.tenantId === "tenant-a") } },
      select: () => selectChain,
    };
    const result = await listDocumentsForApi(fake as any, auth("admin-a", "tenant-a", "sector-a"), {
      tenantId: "tenant-a",
      page: 1,
      limit: 20,
      roleNames: ["ORG_ADMIN"],
    });
    expect(result.data.some((d: any) => d.id === "doc-b")).toBe(true);
    expect(result.data.some((d: any) => d.id === "doc-c")).toBe(false);
  });
});
