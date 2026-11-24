import { describe, it, expect } from "bun:test";
import { generateLicenseNumber } from "../services/license.service";
import { isValidLicenseNumber } from "../lib/license-check";

describe("número de licença gerado pela app", () => {
  it("é aceite pela validação da plataforma (Crockford + carácter de controlo)", () => {
    for (let i = 0; i < 200; i++) {
      const n = generateLicenseNumber();
      expect(isValidLicenseNumber(n)).toBe(true);
    }
  });
});
