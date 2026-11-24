import { describe, it, expect, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { isValidLicenseNumber } from "../lib/license-check";

// Corre contra uma base de dados real com as migrações aplicadas (no CI, o serviço postgres).
// Sem DATABASE_URL, o teste é ignorado.
const url = process.env.DATABASE_URL;
const d = url ? describe : describe.skip;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : (null as unknown as postgres.Sql);

afterAll(async () => { if (url) await sql.end(); });

d("número de licença na base de dados", () => {
  it("gera números válidos (mesma regra do código), únicos e com o ano corrente", async () => {
    const rows = await sql<{ n: string }[]>`SELECT docid_new_license_number() AS n FROM generate_series(1, 5000)`;
    const numbers = rows.map((r) => r.n);
    expect(numbers.every(isValidLicenseNumber)).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
    const year = String(new Date().getFullYear());
    expect(numbers.every((n) => n.startsWith(`DOCID-${year}-`))).toBe(true);
  });

  it("organizações que já existiam recebem cada uma o seu número (default avaliado linha a linha)", async () => {
    await sql.begin(async (tx) => {
      await tx`CREATE TEMP TABLE lic_existing (id int) ON COMMIT DROP`;
      await tx`INSERT INTO lic_existing SELECT generate_series(1, 500)`;
      await tx`ALTER TABLE lic_existing ADD COLUMN license_number text NOT NULL DEFAULT docid_new_license_number()`;
      const [r] = await tx<{ total: number; distinct: number }[]>`
        SELECT count(*)::int AS total, count(DISTINCT license_number)::int AS distinct FROM lic_existing`;
      expect(r.total).toBe(500);
      expect(r.distinct).toBe(500);
    });
  });

  it("organização nova recebe número automaticamente e não o pode alterar", async () => {
    const id = randomUUID();
    const slug = `lic-test-${id.slice(0, 8)}`;
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant', ${id}, true)`;
      const planId = randomUUID();
      await tx`INSERT INTO plans (id, name, price, max_users, monthly_online_identifiers, offline_budget_per_machine)
               VALUES (${planId}, 'Plano Teste', 0, 5, 100, 1)`;
      const [org] = await tx<{ license_number: string; license_issued_at: Date }[]>`
        INSERT INTO organizations (id, name, slug, plan_id) VALUES (${id}, 'Teste Licença', ${slug}, ${planId})
        RETURNING license_number, license_issued_at`;
      expect(isValidLicenseNumber(org.license_number)).toBe(true);
      expect(org.license_issued_at).toBeInstanceOf(Date);

      let blocked = false;
      try {
        await tx.savepoint(async (sp) => {
          await sp`UPDATE organizations SET license_number = 'DOCID-2026-0000-0000-0000' WHERE id = ${id}`;
        });
      } catch (err: any) {
        blocked = /não pode ser alterado/.test(String(err?.message));
      }
      expect(blocked).toBe(true);

      // Alterar outros campos continua a funcionar.
      const [upd] = await tx<{ name: string; license_number: string }[]>`
        UPDATE organizations SET name = 'Nome Novo' WHERE id = ${id} RETURNING name, license_number`;
      expect(upd.name).toBe("Nome Novo");
      expect(upd.license_number).toBe(org.license_number);

      await tx`DELETE FROM organizations WHERE id = ${id}`;
      await tx`DELETE FROM plans WHERE id = ${planId}`;
    });
  });

  it("limite de utilizadores aplicado pela BD e licença protegida contra auto-renovação", async () => {
    const id = randomUUID();
    const slug = `lic-seat-${id.slice(0, 8)}`;
    const errOf = async (tx: postgres.TransactionSql, fn: (sp: postgres.TransactionSql) => Promise<unknown>) => {
      try { await tx.savepoint(fn as any); return null; } catch (err: any) { return err; }
    };
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant', ${id}, true)`;
      const planId = randomUUID();
      await tx`INSERT INTO plans (id, name, price, max_users, monthly_online_identifiers, offline_budget_per_machine)
               VALUES (${planId}, 'Plano Teste', 0, 5, 100, 1)`;
      await tx`INSERT INTO organizations (id, name, slug, plan_id, license_max_users, license_valid_until)
               VALUES (${id}, 'Teste Lugares', ${slug}, ${planId}, 2, now() + interval '14 days')`;
      const addUser = (email: string, active = true) => tx`
        INSERT INTO users (tenant_id, email, password_hash, full_name, is_active)
        VALUES (${id}, ${email}, 'x', 'U', ${active}) RETURNING id`;
      await addUser("a@seat.test");
      await addUser("b@seat.test");
      const third = await errOf(tx, (sp) => sp`INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES (${id}, 'c@seat.test', 'x', 'U')`);
      expect(third?.code).toBe("LIC01");
      expect(String(third?.message)).toContain("Limite de utilizadores");

      // Inactivo não conta; activá-lo com o limite cheio falha.
      const [inactive] = await addUser("d@seat.test", false);
      const activate = await errOf(tx, (sp) => sp`UPDATE users SET is_active = true WHERE id = ${inactive.id}`);
      expect(activate?.code).toBe("LIC01");

      // O tenant não consegue mudar a própria licença...
      const selfRenew = await errOf(tx, (sp) => sp`UPDATE organizations SET license_valid_until = now() + interval '10 years' WHERE id = ${id}`);
      expect(selfRenew?.code).toBe("LIC02");
      // ...só a plataforma (GUC app.license_admin), e fica registado quando mudou.
      await tx.savepoint(async (sp) => {
        await sp`SELECT set_config('app.license_admin', 'on', true)`;
        const [o] = await sp<{ license_max_users: number; license_updated_at: Date | null }[]>`
          UPDATE organizations SET license_max_users = 3 WHERE id = ${id} RETURNING license_max_users, license_updated_at`;
        expect(o.license_max_users).toBe(3);
        expect(o.license_updated_at).toBeInstanceOf(Date);
        await sp`SELECT set_config('app.license_admin', 'off', true)`;
      });
      // Com o novo limite já cabe mais um.
      await tx`UPDATE users SET is_active = true WHERE id = ${inactive.id}`;

      await tx`DELETE FROM users WHERE tenant_id = ${id}`;
      await tx`DELETE FROM organizations WHERE id = ${id}`;
      await tx`DELETE FROM plans WHERE id = ${planId}`;
    });
  });
});
