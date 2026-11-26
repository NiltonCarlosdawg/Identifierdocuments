#!/usr/bin/env node
// Aplica as migrações pendentes em produção (cPanel). Corre com `node`, a partir da pasta
// da API (usa o `postgres` do node_modules do servidor e o DATABASE_URL do ambiente).
//
// Porque não `src/db/migrate.ts`: em produção o utilizador da API não é o dono das tabelas.
// Cada migração corre numa transacção própria com SET LOCAL ROLE <dono das tabelas>, e é
// registada em drizzle.__drizzle_migrations (hash = sha256 do ficheiro, created_at = `when`
// do journal), como o migrador do Drizzle faria. Pendente = `when` acima do último registo
// e hash ainda não registado. Uma migração que falhe é revertida inteira e o script pára.
//
//   node scripts/apply-migrations.mjs            aplica
//   node scripts/apply-migrations.mjs --dry-run  só lista o que aplicaria
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const dryRun = process.argv.includes("--dry-run");
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "db", "migrations");
const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definido.");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

try {
  const [{ owner }] = await sql`SELECT tableowner AS owner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'organizations'`;
  const [{ me }] = await sql`SELECT current_user AS me`;
  const applied = await sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`;
  const appliedHashes = new Set(applied.map((r) => r.hash));
  const lastCreated = applied.reduce((max, r) => Math.max(max, Number(r.created_at)), 0);

  const pending = journal.entries
    .map((e) => {
      const body = readFileSync(join(migrationsDir, `${e.tag}.sql`), "utf8");
      return { tag: e.tag, when: e.when, body, hash: createHash("sha256").update(body).digest("hex") };
    })
    .filter((m) => m.when > lastCreated && !appliedHashes.has(m.hash));

  console.log(`dono das tabelas: ${owner} · utilizador: ${me} · registadas: ${applied.length} · pendentes: ${pending.length}`);
  for (const m of pending) {
    if (dryRun) {
      console.log(`[dry-run] ${m.tag}`);
      continue;
    }
    await sql.begin(async (tx) => {
      if (owner !== me) await tx.unsafe(`SET LOCAL ROLE "${owner.replace(/"/g, '""')}"`);
      await tx.unsafe(m.body);
      if (owner !== me) await tx.unsafe("RESET ROLE");
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${m.hash}, ${m.when})`;
    });
    console.log(`aplicada: ${m.tag}`);
  }
} catch (err) {
  console.error(`migração falhou: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
