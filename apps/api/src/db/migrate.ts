import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const connectionString = process.env.DATABASE_URL!;
const migrationClient = postgres(connectionString, { max: 1 });
const db = drizzle(migrationClient);

/**
 * Verify the migration tracker is consistent with actual DB state.
 * If a migration is marked applied but its effects are missing, reset
 * that entry (and all later ones) so drizzle re-runs them.
 */
async function ensureConsistency(client: postgres.Sql) {
  const checks: { table: string; desc: string }[] = [
    { table: "documents", desc: "base table" },
    { table: "document_access_requests", desc: "migration 0012" },
    { table: "idempotency_records", desc: "migration 0012" },
    { table: "document_versions", desc: "migration 0015" },
  ];

  const missing: string[] = [];
  for (const c of checks) {
    const [{ exists }] = await client`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${c.table}
      ) as exists`;
    if (!exists) missing.push(`${c.table} (${c.desc})`);
  }

  const [{ hasTags }] = await client`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'tags'
    ) as "hasTags"`;
  if (!hasTags) missing.push("documents.tags (migration 0016)");

  if (missing.length > 0) {
    console.log(`[DB CHECK] Schema inconsistente — objetos faltando: ${missing.join(", ")}`);
    console.log("[DB CHECK] Limpando migrações marcadas como aplicadas para re-executar...");
    await client`DELETE FROM drizzle.__drizzle_migrations`;
    console.log("[DB CHECK] Tracker limpo. Todas as migrações serão re-aplicadas.");
  }
}

async function run() {
  await ensureConsistency(migrationClient);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations executadas com sucesso.");
  await migrationClient.end();
}

run().catch((err) => {
  console.error("Erro ao executar migrações:", err);
  process.exit(1);
});
