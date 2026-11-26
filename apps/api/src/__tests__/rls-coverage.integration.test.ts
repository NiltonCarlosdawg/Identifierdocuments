import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

// Corre com um papel sem BYPASSRLS (como a API em produção deve correr): superutilizadores
// ignoram todas as policies, por isso testar só com o utilizador do CI não prova nada.
const role = "docid_rls_coverage_test";
const orgA = "66666666-6666-6666-6666-666666666661";
const orgB = "66666666-6666-6666-6666-666666666662";
const userA = "77777777-7777-7777-7777-777777777771";
const userB = "77777777-7777-7777-7777-777777777772";
const roleA = "88888888-8888-8888-8888-888888888881";

const admin = postgres(process.env.DATABASE_URL!, { max: 1 });

// Tabelas sem tenant_id próprio, isoladas pela tabela pai.
const CHILD_TABLES = ["document_shares", "user_roles", "role_permissions"];
// Tabelas da plataforma com tenant_id mas lidas só pela provedora e pelo checkout público.
const PLATFORM_TABLES = ["orders"];

beforeAll(async () => {
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} NOBYPASSRLS; END IF;
  END $$;`);
  await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await admin.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);

  const free = admin`(SELECT id FROM plans WHERE is_free LIMIT 1)`;
  for (const [org, user, slug] of [[orgA, userA, "rls-cov-a"], [orgB, userB, "rls-cov-b"]] as const) {
    await admin`INSERT INTO organizations (id, name, slug, plan_id) VALUES (${org}, ${slug}, ${slug}, ${free}) ON CONFLICT DO NOTHING`;
    await admin`INSERT INTO users (id, tenant_id, email, password_hash, full_name)
      VALUES (${user}, ${org}, ${`${slug}@example.invalid`}, '$2b$fake', ${slug}) ON CONFLICT DO NOTHING`;
  }
  await admin`INSERT INTO roles (id, tenant_id, name) VALUES (${roleA}, ${orgA}, 'RLS_COV') ON CONFLICT DO NOTHING`;
  await admin`INSERT INTO user_roles (user_id, role_id) VALUES (${userA}, ${roleA})`;
  await admin`INSERT INTO role_permissions (role_id, resource, action) VALUES (${roleA}, 'documents', 'read')`;
});

afterAll(async () => {
  await admin`DELETE FROM role_permissions WHERE role_id = ${roleA}`;
  await admin`DELETE FROM user_roles WHERE user_id IN (${userA}, ${userB})`;
  await admin`DELETE FROM roles WHERE id = ${roleA}`;
  await admin`DELETE FROM users WHERE id IN (${userA}, ${userB})`;
  await admin`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
  await admin.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await admin.unsafe(`REVOKE ALL ON SCHEMA public FROM ${role}`);
  await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
});

async function countAs(table: string, tenant: string | null): Promise<number> {
  const rows = await admin.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    if (tenant) await tx`SELECT set_config('app.current_tenant', ${tenant}, true)`;
    return tx.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
  });
  return rows[0]!.n as number;
}

describe("cobertura de RLS", () => {
  test("todas as tabelas com tenant_id e as tabelas filhas têm RLS activo e forçado", async () => {
    const rows = await admin<{ relname: string; rls: boolean; force: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
      FROM pg_class c
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        AND (c.relname = ANY(${CHILD_TABLES})
             OR EXISTS (SELECT 1 FROM information_schema.columns col
                        WHERE col.table_schema = 'public' AND col.table_name = c.relname
                          AND col.column_name = 'tenant_id'))
    `;
    const missing = rows
      .filter((r) => !PLATFORM_TABLES.includes(r.relname))
      .filter((r) => !r.rls || !r.force).map((r) => r.relname);
    expect(missing).toEqual([]);
    expect(rows.map((r) => r.relname)).toEqual(expect.arrayContaining(CHILD_TABLES));
  });

  test("user_roles e role_permissions só mostram linhas do tenant actual", async () => {
    expect(await countAs("user_roles WHERE user_id = '" + userA + "'", orgA)).toBe(1);
    expect(await countAs("user_roles WHERE user_id = '" + userA + "'", orgB)).toBe(0);
    expect(await countAs("user_roles WHERE user_id = '" + userA + "'", null)).toBe(0);
    expect(await countAs("role_permissions WHERE role_id = '" + roleA + "'", orgA)).toBe(1);
    expect(await countAs("role_permissions WHERE role_id = '" + roleA + "'", orgB)).toBe(0);
  });
});
