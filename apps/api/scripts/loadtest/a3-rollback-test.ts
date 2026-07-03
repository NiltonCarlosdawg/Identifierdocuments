/**
 * PARTE A3 — Rollback e limpeza do SET LOCAL
 *
 * Uso: bun run scripts/loadtest/a3-rollback-test.ts
 */
import { db } from "../../src/db";
import { withTenant } from "../../src/db/withTenant";
import { seedTenants, cleanupTenants, type TenantSeed } from "./seed";
import { sectors, identifiers } from "../../src/db/schema";
import { eq } from "drizzle-orm";

async function runA3(tenants: TenantSeed[]) {
  const tA = tenants[0];
  const tB = tenants[1];

  console.log("\n═══════════════════════════════════════════");
  console.log("  PARTE A3 — Rollback e limpeza do SET LOCAL");
  console.log("═══════════════════════════════════════════");

  let leaks = 0;

  for (let i = 0; i < 50; i++) {
    // Step 1: force an error inside withTenant(tenantA)
    try {
      await withTenant(tA.org.id, async (tx) => {
        await tx.insert(identifiers).values({
          tenantId: tA.org.id, sectorId: tA.sector.id,
          categoryId: "NONEXISTENT", // will cause FK violation
          identifier: `LEAK-TEST-${i}`, sequence: 999,
          createdBy: tA.user.id,
        }).returning();
      });
    } catch {
      // Expected — FK violation
    }

    // Step 2: immediately read tenantB's data (same process, likely reuses pool connection)
    const result = await withTenant(tB.org.id, async (tx) => {
      return tx.select().from(sectors).where(eq(sectors.tenantId, tB.org.id));
    });

    for (const row of result) {
      if (row.tenantId !== tB.org.id) {
        console.error(`  ⚠️  Iteração ${i}: CROSS-TENANT LEAK! sector.tenantId=${row.tenantId}, esperado=${tB.org.id}`);
        leaks++;
      }
    }

    if (result.length === 0) {
      console.error(`  ⚠️  Iteração ${i}: sector vazio — possível fuga silenciosa`);
      leaks++;
    }

    if (i % 10 === 0) console.log(`  Iteração ${i}/50: ${leaks === 0 ? "ok" : `${leaks} fuga(s)`}`);
  }

  if (leaks > 0) {
    console.error(`\n❌ A3: ${leaks} fuga(s) de SET LOCAL detectada(s) em 50 iterações.`);
    process.exit(1);
  }
  console.log("\n✅ A3: 0 leaks SET LOCAL em 50 iterações de erro forçado + leitura cruzada.");
}

async function main() {
  let tenants: TenantSeed[] = [];
  try {
    tenants = await seedTenants();
    await runA3(tenants);
  } finally {
    if (tenants.length > 0) await cleanupTenants(tenants);
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
