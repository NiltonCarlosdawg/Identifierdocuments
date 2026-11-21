import { describe, expect, test } from "bun:test";
import { canSeeApproval, isTenantAdmin } from "../services/access-decision.service";

describe("isTenantAdmin", () => {
  test("admin do tenant tem poder total", () => {
    expect(isTenantAdmin(["ORG_ADMIN"])).toBe(true);
    expect(isTenantAdmin(["MEMBER", "ORG_ADMIN"])).toBe(true);
  });
  test("member e supervisor não têm poder total", () => {
    expect(isTenantAdmin(["MEMBER"])).toBe(false);
    expect(isTenantAdmin(["SECTOR_SUPERVISOR"])).toBe(false);
  });
});

describe("canSeeApproval", () => {
  test("member vê só as próprias aprovações", () => {
    expect(canSeeApproval(["MEMBER"], "u1", { requesterId: "u1", supervisorId: "s1" })).toBe(true);
    expect(canSeeApproval(["MEMBER"], "u1", { requesterId: "u2", supervisorId: "s1" })).toBe(false);
  });
  test("supervisor vê as que supervisiona e as suas", () => {
    expect(canSeeApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "u1" })).toBe(true);
    expect(canSeeApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "s2" })).toBe(false);
  });
  test("admin vê todas", () => {
    expect(canSeeApproval(["ORG_ADMIN"], "u1", { requesterId: "u2", supervisorId: "s2" })).toBe(true);
  });
});
