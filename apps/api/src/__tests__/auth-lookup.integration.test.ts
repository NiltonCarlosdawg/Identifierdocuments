import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const role = "docid_auth_lookup_test";
const orgId = "44444444-4444-4444-4444-444444444444";
const userId = "55555555-5555-5555-5555-555555555555";
const email = "auth-lookup-test@example.invalid";

const admin = postgres(process.env.DATABASE_URL!, { max: 1 });

beforeAll(async () => {
  await admin.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role}; END IF;
  END $$;`);
  await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await admin.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
  await admin.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);

  await admin`SELECT set_config('app.current_tenant', ${orgId}, false)`;
  await admin`INSERT INTO organizations (id, name, slug, plan_id) VALUES (${orgId}, 'Auth lookup', 'auth-lookup-test', (SELECT id FROM plans WHERE is_free LIMIT 1)) ON CONFLICT DO NOTHING`;
  await admin`INSERT INTO users (id, tenant_id, email, password_hash, full_name) VALUES (${userId}, ${orgId}, ${email}, '$2b$fake', 'Lookup User') ON CONFLICT DO NOTHING`;
});

afterAll(async () => {
  await admin`DELETE FROM users WHERE id = ${userId}`;
  await admin`DELETE FROM organizations WHERE id = ${orgId}`;
  await admin.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`);
  await admin.unsafe(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${role}`);
  await admin.unsafe(`REVOKE ALL ON SCHEMA public FROM ${role}`);
  await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
});

describe("lookup de autenticação com RLS activo", () => {
  test("encontra utilizador sem contexto de tenant", async () => {
    const client = postgres(process.env.DATABASE_URL!, { max: 1 });
    try {
      const rows = await client.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        return tx`SELECT count(*)::int AS n FROM auth_find_user_by_email(${email})`;
      });
      expect(rows[0]?.n).toBe(1);
    } finally {
      await client.end();
    }
  });

  test("pool com app.auth_lookup no arranque lê organizations cross-tenant", async () => {
    const countAsRole = async (client: postgres.Sql) => {
      const rows = await client.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        return tx`SELECT count(*)::int AS n FROM organizations`;
      });
      return rows[0]!.n;
    };
    const plain = postgres(process.env.DATABASE_URL!, { max: 1 });
    const lookup = postgres(process.env.DATABASE_URL!, {
      max: 1,
      connection: { "app.auth_lookup": "on" },
    });
    try {
      expect(await countAsRole(plain)).toBe(0);
      expect(await countAsRole(lookup)).toBeGreaterThan(0);
    } finally {
      await plain.end();
      await lookup.end();
    }
  });
});
