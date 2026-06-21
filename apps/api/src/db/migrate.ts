import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const connectionString = process.env.DATABASE_URL!;
const migrationClient = postgres(connectionString, { max: 1 });
const db = drizzle(migrationClient);

async function run() {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations executadas com sucesso.");
  await migrationClient.end();
}

run().catch((err) => {
  console.error("Erro ao executar migrações:", err);
  process.exit(1);
});
