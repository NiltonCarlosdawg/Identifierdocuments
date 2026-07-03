/**
 * PARTE A5 — Tentativa de bypass via tenantId malformado
 *
 * Uso: bun run scripts/loadtest/a5-bypass-test.ts
 */
import { SignJWT } from "jose";

const BASE = process.env.API_URL || "http://localhost:3000";
const rawSecret = process.env.JWT_SECRET!;
const JWT_SECRET = new TextEncoder().encode(rawSecret);

async function createJWT(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("docid-api")
    .setAudience("docid-desktop")
    .setExpirationTime("5m")
    .sign(JWT_SECRET);
}

async function testCase(label: string, payload: Record<string, unknown>) {
  const token = await createJWT(payload);

  try {
    const res = await fetch(`${BASE}/identifiers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.text();
    console.log(`  ${label}:`);
    console.log(`    Status: ${res.status}`);
    console.log(`    Body preview: ${body.slice(0, 150)}`);
    console.log(`    Token tenantId: ${payload.tenantId ?? "(undefined)"}`);
    console.log();

    if (res.status === 500) {
      console.log("    → INTERPRETAÇÃO: Erro 500 (provável validação JWT rejeitou).");
    } else if (res.status === 200) {
      const data = JSON.parse(body);
      const count = data.data?.length ?? "N/A";
      console.log(`    → INTERPRETAÇÃO: Resposta 200 com ${count} registos — risco se não for 0!`);
    } else {
      console.log("    → INTERPRETAÇÃO: Rejeitado pela API (esperado para payload inválido).");
    }
  } catch (err: any) {
    console.log(`  ${label}: ERRO — ${err.message}`);
  }
}

async function main() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  PARTE A5 — Bypass via tenantId malformado");
  console.log("═══════════════════════════════════════════\n");

  // Case 1: SQL injection payload
  await testCase("JWT com tenantId contendo SQL injection", {
    userId: "00000000-0000-0000-0000-000000000001",
    tenantId: "'; DROP TABLE users; --",
    sectorId: null,
    roles: ["ORG_ADMIN"],
  });

  // Case 2: Missing tenantId
  await testCase("JWT sem campo tenantId (undefined)", {
    userId: "00000000-0000-0000-0000-000000000001",
    sectorId: null,
    roles: ["ORG_ADMIN"],
  });

  // Case 3: Valid UUID but non-existent tenant
  await testCase("JWT com tenantId UUID válido + inexistente", {
    userId: "00000000-0000-0000-0000-000000000001",
    tenantId: "11111111-1111-1111-1111-111111111111",
    sectorId: null,
    roles: ["ORG_ADMIN"],
  });
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
