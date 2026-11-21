import { describe, expect, test } from "bun:test";
import { approvalAuditEntry, canResolveApproval, canSeeApproval, isTenantAdmin } from "../services/access-decision.service";

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

describe("canResolveApproval", () => {
  test("ninguém resolve o próprio pedido, nem o admin", () => {
    const own = { requesterId: "u1", supervisorId: "s1" };
    expect(canResolveApproval(["ORG_ADMIN"], "u1", own)).toBe(false);
    expect(canResolveApproval(["SECTOR_SUPERVISOR"], "u1", own)).toBe(false);
  });
  test("supervisor responsável resolve; supervisor alheio não", () => {
    expect(canResolveApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "u1" })).toBe(true);
    expect(canResolveApproval(["SECTOR_SUPERVISOR"], "u1", { requesterId: "u2", supervisorId: "s2" })).toBe(false);
  });
});

describe("approvalAuditEntry", () => {
  test("regista quem decidiu e o que foi decidido", () => {
    const base = { tenantId: "t1", userId: "u1", documentId: "d1", approvalId: "a1", ip: "127.0.0.1" };
    expect(approvalAuditEntry({ ...base, status: "approved" }).action).toBe("APPROVAL_APPROVED");
    const denied = approvalAuditEntry({ ...base, status: "rejected", notes: "motivo" });
    expect(denied.action).toBe("APPROVAL_REJECTED");
    expect(denied.resource).toBe("approvals");
    expect(denied.resourceId).toBe("a1");
    expect(JSON.parse(denied.metadata).notes).toBe("motivo");
  });
});
