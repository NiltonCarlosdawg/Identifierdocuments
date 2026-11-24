import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
export const queryClient = postgres(connectionString, { prepare: false });
export const db = drizzle(queryClient, { schema });
// Pool para leituras cross-tenant (painel provedora, checkout público, jobs):
// liga o GUC app.auth_lookup por conexão, como as funções SECURITY DEFINER
// fazem com SET LOCAL — sem ele as policies RLS escondem organizations/users.
export const lookupClient = postgres(connectionString, {
  prepare: false,
  connection: { "app.auth_lookup": "on" },
});
export const lookupDb = drizzle(lookupClient, { schema });
export { schema };
export type DB = typeof db;
