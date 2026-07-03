/**
 * PARTE B3 — Contenção de advisory lock via endpoint HTTP real
 *
 * Usa POST /identifiers/generate (agora com ::text fix) para testar
 * que pg_advisory_xact_lock previne duplicação de sequence:
 *
 *   Caso 1: 50 POST concorrentes, MESMA categoria (lock partilhado)
 *   Caso 2: 50 POST concorrentes, 5 categorias DIFERENTES (lock分散)
 *
 * Uso: bun run scripts/loadtest/b3-advisory-lock.ts
 */
import { db } from "../../src/db";
import { categories } from "../../src/db/schema";
import { seedTenants, cleanupTenants, type TenantSeed } from "./seed";

const BASE = process.env.API_URL || "http://localhost:3000";

interface CaseResult {
  label: string;
  ok: number;
  errors: number;
  groups: Map<string, number[]>;
  latencies: number[];
  errorDetails: string[];
}

async function fireGenerate(
  tenants: TenantSeed[],
  count: number,
  catIds: string[],
  label: string,
): Promise<CaseResult> {
  const result: CaseResult = { label, ok: 0, errors: 0, groups: new Map(), latencies: [], errorDetails: [] };

  const tasks = Array.from({ length: count }, async (_, i) => {
    const tenant = tenants[i % tenants.length];
    const catId = catIds[i % catIds.length];
    const start = performance.now();

    try {
      const res = await fetch(`${BASE}/identifiers/generate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenant.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          categoryId: catId,
          description: `B3-${label}-${i}`,
          origin: "digital",
          visibility: "public",
        }),
      });

      if (res.ok) {
        const json = await res.json() as any;
        const seq = json.data?.sequence;
        const tenantId = json.data?.tenantId;
        if (typeof seq === "number" && tenantId) {
          const gkey = `${tenantId}:${catId}`;
          if (!result.groups.has(gkey)) result.groups.set(gkey, []);
          result.groups.get(gkey)!.push(seq);
        }
        result.ok++;
      } else {
        const body = await res.text();
        result.errors++;
        result.errorDetails.push(`#${i}: ${res.status} ${body.slice(0, 120)}`);
      }
    } catch (err: any) {
      result.errors++;
      result.errorDetails.push(`#${i}: NETWORK ${err.message}`);
    } finally {
      result.latencies.push(performance.now() - start);
    }
  });

  await Promise.all(tasks);
  return result;
}

function printResult(r: CaseResult) {
  const sorted = [...r.latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

  let totalDupes = 0;
  for (const [group, seqs] of r.groups) {
    const seen = new Map<number, number>();
    for (const s of seqs) seen.set(s, (seen.get(s) || 0) + 1);
    const groupDupes = [...seen.entries()].filter(([, c]) => c > 1);
    if (groupDupes.length > 0) {
      console.log(`    ⚠️  Grupo ${group.slice(0, 12)}...: ${groupDupes.map(([s, c]) => `seq=${s} (x${c})`).join(", ")}`);
    }
    totalDupes += groupDupes.length;
  }

  console.log(`  ${r.label}`);
  console.log(`    OK: ${r.ok}  Erros: ${r.errors}`);
  console.log(`    Grupos (tenantId:catId): ${r.groups.size}`);
  console.log(`    Duplicatas: ${totalDupes}  ${totalDupes > 0 ? '❌' : '✅'}`);
  console.log(`    Latência: p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  p99=${p99.toFixed(1)}ms`);

  if (r.errorDetails.length > 0) {
    console.log(`    Erros (primeiros 5):`);
    for (const e of r.errorDetails.slice(0, 5)) console.log(`      ${e}`);
    if (r.errorDetails.length > 5) console.log(`      ... e mais ${r.errorDetails.length - 5}`);
  }
}

async function runB3(tenants: TenantSeed[], catIds: string[]) {
  console.log("\n═══════════════════════════════════════════════");
  console.log("  PARTE B3 — Advisory lock via HTTP endpoint");
  console.log("═══════════════════════════════════════════════\n");

  console.log(`  Categorias: ${catIds.join(", ")}`);
  console.log(`  Tenants: ${tenants.map(t => t.org.slug).join(", ")}`);

  // Case 1: Same category (high lock contention)
  console.log(`\n  Caso 1: 50 POST concorrentes, MESMA categoria (${catIds[0]})`);
  const r1 = await fireGenerate(tenants, 50, [catIds[0]], "C1");
  printResult(r1);

  // Case 2: 5 different categories (low lock contention)
  console.log(`\n  Caso 2: 50 POST concorrentes, 5 categorias DIFERENTES`);
  const r2 = await fireGenerate(tenants, 50, catIds, "C2");
  printResult(r2);

  // Aggregate
  let totalDupes = 0;
  for (const r of [r1, r2]) {
    for (const [, seqs] of r.groups) {
      const seen = new Map<number, number>();
      for (const s of seqs) seen.set(s, (seen.get(s) || 0) + 1);
      totalDupes += [...seen.values()].filter(c => c > 1).length;
    }
  }

  if (totalDupes > 0) {
    console.log(`\n❌ B3: ${totalDupes} grupos com duplicatas! Advisory lock FALHOU.`);
    process.exit(1);
  }
  console.log(`\n✅ B3: Zero sequências duplicadas. Advisory lock OK via HTTP.`);

  const avg1 = r1.latencies.reduce((a, b) => a + b, 0) / r1.latencies.length;
  const avg2 = r2.latencies.reduce((a, b) => a + b, 0) / r2.latencies.length;
  console.log(`\n  Impacto contenção:`);
  console.log(`    Média Caso 1 (mesma cat): ${avg1.toFixed(1)}ms`);
  console.log(`    Média Caso 2 (5 cats):     ${avg2.toFixed(1)}ms`);
  console.log(`    Diferença:                 ${((avg1 / avg2) * 100 - 100).toFixed(1)}%`);
}

async function main() {
  let tenants: TenantSeed[] = [];
  try {
    const cats = await db.select({ id: categories.id }).from(categories).limit(5);
    const catIds = cats.map(r => r.id);
    if (catIds.length < 5) throw new Error("Precisamos de 5 categorias.");

    tenants = await seedTenants();
    console.log(`  Tenants: ${tenants.map(t => t.org.slug).join(", ")}`);
    await runB3(tenants, catIds);
  } finally {
    if (tenants.length > 0) await cleanupTenants(tenants);
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
