import postgres from "postgres";

const connectionString = process.env.DATABASE_URL!;

const TABLES_WITH_TENANT = [
  "sectors", "users", "roles", "identifiers",
  "documents", "approvals", "audit_logs",
];

export async function setupRLS() {
  const sql = postgres(connectionString, { max: 1 });

  for (const table of TABLES_WITH_TENANT) {
    await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`DROP POLICY IF EXISTS tenant_isolation_${table} ON ${table};`);
    await sql.unsafe(`
      CREATE POLICY tenant_isolation_${table} ON ${table}
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant')::uuid);
    `);
  }

  console.log("RLS configurado para todas as tabelas.");
  await sql.end();
}

setupRLS().catch(console.error);
