import { describe, expect, test } from "bun:test";
import { isTenantAdmin } from "../services/access-decision.service";

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
