import { describe, expect, test } from "bun:test";
import { defaultIdentifierPrefix, normalizeIdentifierPrefix } from "../lib/identifier-prefix";

describe("prefixo do identificador", () => {
  test("aceita 1 a 6 letras e normaliza para maiúsculas", () => {
    expect(normalizeIdentifierPrefix("VL")).toBe("VL");
    expect(normalizeIdentifierPrefix(" abc ")).toBe("ABC");
    expect(normalizeIdentifierPrefix("ABCDEF")).toBe("ABCDEF");
  });

  test("recusa hífen, dígitos, acentos, vazio e mais de 6", () => {
    for (const bad of ["EMP-", "EMP2", "AÇO", "", "   ", "ABCDEFG", "V L"]) {
      expect(normalizeIdentifierPrefix(bad)).toBeNull();
    }
  });

  test("por omissão usa só as letras do slug", () => {
    expect(defaultIdentifierPrefix("emp-b")).toBe("EMPB");
    expect(defaultIdentifierPrefix("verano-labs")).toBe("VERA");
    expect(defaultIdentifierPrefix("2024-99")).toBe("ORG");
    expect(normalizeIdentifierPrefix(defaultIdentifierPrefix("a1-b2"))).toBe("AB");
  });
});
