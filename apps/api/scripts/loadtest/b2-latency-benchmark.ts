/**
 * PARTE B2 — Latência sob concorrência crescente (pós-FIX)
 *
 * Uso: bun run scripts/loadtest/b2-latency-benchmark.ts
 */
import { seedTenants, cleanupTenants, type TenantSeed } from "./seed";

const BASE = process.env.API_URL || "http://localhost:3000";

interface RunResult {
  label: string;
  total: number;
  passed: number;
  failed: number;
  p50: number;
  p95: number;
  p99: number;
}

async function fireRequests(tenants: TenantSeed[], count: number, endpoint: string): Promise<RunResult> {
  const latencies: number[] = [];
  let passed = 0;
  let failed = 0;

  const requests = Array.from({ length: count }, async (_, i) => {
    const tenant = tenants[i % tenants.length];
    const url = `${BASE}${endpoint}`;
    const start = performance.now();

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tenant.token}` },
      });
      const elapsed = performance.now() - start;
      latencies.push(elapsed);

      if (res.ok) passed++;
      else failed++;
    } catch {
      failed++;
    }
  });

  await Promise.all(requests);

  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    label: `${count}× GET ${endpoint}`,
    total: count,
    passed,
    failed,
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
  };
}

async function runBenchmark(tenants: TenantSeed[]) {
  const endpoints = ["/identifiers", "/users"];
  const concurrencies = [10, 50, 200];
  const results: RunResult[] = [];

  console.log("\n════════════════════════════════════════════════");
  console.log("  PARTE B2 — Latência sob concorrência crescente");
  console.log("════════════════════════════════════════════════\n");

  for (const endpoint of endpoints) {
    for (const concurrency of concurrencies) {
      process.stdout.write(`  ${concurrency}× GET ${endpoint} ... `);
      const r = await fireRequests(tenants, concurrency, endpoint);
      results.push(r);
      console.log(`${r.passed} ok, ${r.failed} falhas | p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms p99=${r.p99.toFixed(1)}ms`);
    }
  }

  // Summary table
  console.log("\n");
  console.log("  " + "─".repeat(80));
  console.log(`  ${"Endpoint".padEnd(30)} ${"Req".padEnd(6)} ${"OK".padEnd(6)} ${"ERR".padEnd(6)} ${"p50(ms)".padEnd(10)} ${"p95(ms)".padEnd(10)} ${"p99(ms)".padEnd(10)}`);
  console.log("  " + "─".repeat(80));
  for (const r of results) {
    console.log(`  ${r.label.padEnd(30)} ${String(r.total).padEnd(6)} ${String(r.passed).padEnd(6)} ${String(r.failed).padEnd(6)} ${r.p50.toFixed(1).padEnd(10)} ${r.p95.toFixed(1).padEnd(10)} ${r.p99.toFixed(1).padEnd(10)}`);
  }
  console.log("  " + "─".repeat(80));

  const anyFails = results.some(r => r.failed > 0);
  if (anyFails) {
    console.log(`\n⚠️  Algumas requests falharam — verificar se são timeouts ou erros de servidor.`);
  } else {
    console.log("\n✅ B2: Todas as requests completaram com sucesso.");
  }
}

async function main() {
  let tenants: TenantSeed[] = [];
  try {
    tenants = await seedTenants();
    console.log(`  Tenants criados: ${tenants.map(t => t.org.slug).join(", ")}`);
    await runBenchmark(tenants);
  } finally {
    if (tenants.length > 0) await cleanupTenants(tenants);
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
