/**
 * PARTE A1 — Fuzzing de concorrência bruta
 * PARTE A2 — Exaustão do pool de conexões
 *
 * Uso: bun run scripts/loadtest/a1-a2-concurrent.ts
 */
import { seedTenants, cleanupTenants, type TenantSeed } from "./seed";

const BASE = process.env.API_URL || "http://localhost:3000";
const POOL_MAX = 10; // postgres.js default

interface TestResult {
  total: number;
  passed: number;
  failed: number;
  leaks: number;
  errors: { req: string; tokenTenant: string; status: number; body: string }[];
  latencies: number[];
}

async function fireRequests(
  tenants: TenantSeed[],
  count: number,
  endpoints: string[],
): Promise<TestResult> {
  const result: TestResult = { total: 0, passed: 0, failed: 0, leaks: 0, errors: [], latencies: [] };

  const requests = Array.from({ length: count }, async (_, i) => {
    const tenant = tenants[i % tenants.length];
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    const url = `${BASE}${endpoint}`;
    const start = performance.now();

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tenant.token}` },
      });
      const elapsed = performance.now() - start;
      result.latencies.push(elapsed);

      if (!res.ok) {
        const body = await res.text();
        result.failed++;
        result.errors.push({ req: `${i}: GET ${endpoint}`, tokenTenant: tenant.org.slug, status: res.status, body });
        return;
      }

      const json = await res.json();

      // Verify tenant isolation: check every item's tenantId
      if (json.data && Array.isArray(json.data)) {
        for (const item of json.data) {
          if (item.tenantId && item.tenantId !== tenant.org.id) {
            result.leaks++;
            result.errors.push({
              req: `${i}: GET ${endpoint} — CROSS-TENANT LEAK`,
              tokenTenant: tenant.org.slug,
              status: res.status,
              body: JSON.stringify(item),
            });
          }
        }
      }

      result.passed++;
    } catch (err: any) {
      result.failed++;
      result.errors.push({ req: `${i}: GET ${endpoint}`, tokenTenant: tenant.org.slug, status: 0, body: err.message });
    }
  });

  await Promise.all(requests);
  result.total = count;
  return result;
}

function printResult(label: string, r: TestResult) {
  const p50 = r.latencies.sort((a, b) => a - b)[Math.floor(r.latencies.length * 0.5)] || 0;
  const p95 = r.latencies.sort((a, b) => a - b)[Math.floor(r.latencies.length * 0.95)] || 0;
  const p99 = r.latencies.sort((a, b) => a - b)[Math.floor(r.latencies.length * 0.99)] || 0;

  console.log(`\n=== ${label} ===`);
  console.log(`  Requests:     ${r.total}`);
  console.log(`  Passed:       ${r.passed}`);
  console.log(`  Failed:       ${r.failed}`);
  console.log(`  Leaks:        ${r.leaks}`);
  console.log(`  Latência p50: ${p50.toFixed(1)}ms`);
  console.log(`  Latência p95: ${p95.toFixed(1)}ms`);
  console.log(`  Latência p99: ${p99.toFixed(1)}ms`);

  if (r.errors.length > 0) {
    console.log(`\n  Erros:`);
    for (const e of r.errors.slice(0, 10)) {
      console.log(`    [${e.tokenTenant}] ${e.req} → ${e.status}: ${e.body.slice(0, 200)}`);
    }
    if (r.errors.length > 10) console.log(`    ... e mais ${r.errors.length - 10} erros`);
  }
}

async function runA1(tenants: TenantSeed[]) {
  const endpoints = ["/identifiers", "/identifiers/", "/users", "/users/", "/tenants/me"];

  console.log("\n═══════════════════════════════════════════");
  console.log("  PARTE A1 — Fuzzing de concorrência bruta");
  console.log("═══════════════════════════════════════════");

  for (let run = 1; run <= 3; run++) {
    console.log(`\n--- Execução ${run}/3 ---`);
    const r = await fireRequests(tenants, 200, endpoints);
    printResult(`Execução ${run}`, r);

    if (r.leaks > 0) {
      console.error(`\n⚠️  CROSS-TENANT LEAK DETECTADO na execução ${run}! ${r.leaks} fuga(s) encontrada(s).`);
      process.exit(1);
    }
  }

  console.log("\n✅ A1: 0 cross-tenant leaks em 600 requests concorrentes (3 execuções × 200).");
}

async function runA2(tenants: TenantSeed[]) {
  const endpoints = ["/identifiers", "/users", "/tenants/me"];
  const burst = POOL_MAX * 3; // 30 requests (3x pool)

  console.log("\n═══════════════════════════════════════════");
  console.log("  PARTE A2 — Exaustão do pool de conexões");
  console.log("═══════════════════════════════════════════");
  console.log(`  Pool max: ${POOL_MAX} | Burst: ${burst} requests`);

  const r = await fireRequests(tenants, burst, endpoints);
  printResult(`A2: ${burst} requests concorrentes (3× pool)`, r);

  if (r.leaks > 0) {
    console.error(`\n⚠️  CROSS-TENANT LEAK DETECTADO sob pressão de pool! ${r.leaks} fuga(s).`);
    process.exit(1);
  }

  if (r.failed > 0) {
    console.log(`\n⚠️  ${r.failed} request(s) falharam — analisar se são timeouts ou erros de pool.`);
  } else {
    console.log("\n✅ A2: Todos os requests completaram sem erros, zero leaks sob pressão de pool.");
  }
}

async function main() {
  let tenants: TenantSeed[] = [];
  try {
    console.log("A criar 3 tenants de teste...");
    tenants = await seedTenants();
    console.log(`  Tenants criados: ${tenants.map((t) => t.org.slug).join(", ")}`);

    await runA1(tenants);
    await runA2(tenants);
  } finally {
    if (tenants.length > 0) {
      console.log("\nA limpar dados de teste...");
      await cleanupTenants(tenants);
      console.log("  Cleanup completo.");
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
