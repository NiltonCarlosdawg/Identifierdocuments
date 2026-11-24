import { describe, it, expect } from "bun:test";
import { PERMISSION_CATALOG, normalisePermissions } from "../interfaces/pages/Roles";

describe("catálogo de permissões", () => {
  it("cobre os seis recursos e as cinco acções", () => {
    expect(PERMISSION_CATALOG).toHaveLength(30);
    for (const resource of ["documents", "identifiers", "sectors", "users", "audit", "roles"]) {
      expect(PERMISSION_CATALOG.some(p => p.resource === resource)).toBe(true);
    }
    for (const action of ["read", "create", "approve", "generate", "manage"]) {
      expect(PERMISSION_CATALOG.some(p => p.action === action)).toBe(true);
    }
  });

  it("remove duplicados e entradas desconhecidas", () => {
    expect(normalisePermissions([
      { resource: "documents", action: "read" },
      { resource: "documents", action: "read" },
      { resource: "billing", action: "manage" },
      { resource: "roles", action: "fly" },
      null,
    ])).toEqual([{ resource: "documents", action: "read" }]);
    expect(normalisePermissions(null)).toEqual([]);
  });
});
