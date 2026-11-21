import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import postgres from "postgres";

const API_ROOT = join(import.meta.dir, "..", "..");
const dbName = `docid_migrate_${process.pid}_${Date.now().toString(36)}`;

const urlFor = (database: string): string => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  return url.toString();
};

const adminUrl = urlFor("postgres");
const freshUrl = urlFor(dbName);

let admin: postgres.Sql;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe("SET client_min_messages = warning");
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
});

afterAll(async () => {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
  await admin.end();
});

describe("migrate numa base completamente vazia", () => {
  test("aplica migrações sem exigir tracker pré-criado", async () => {
    const proc = Bun.spawn({
      cmd: ["bun", "src/db/migrate.ts"],
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: freshUrl },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(code).toBe(0);
    expect(out).toContain("Migrations executadas com sucesso.");
    expect(err).not.toContain("does not exist");
  }, 30000);
});
