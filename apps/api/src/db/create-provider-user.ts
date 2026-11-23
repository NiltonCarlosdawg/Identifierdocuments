// Uso: bun run provider:create -- <email> <password> [name]
import { db, queryClient } from "./index";
import { providerUsers } from "./schema";
import { hashPassword } from "../lib/password";

const [email, password, name] = process.argv.slice(2);
if (!email || !password) {
  console.error("Uso: bun run provider:create -- <email> <password> [name]");
  process.exit(1);
}
if (password.length < 6) {
  console.error("A senha deve ter pelo menos 6 caracteres (mesmo requisito do login).");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const [user] = await db.insert(providerUsers).values({
  email,
  passwordHash,
  name: name || email,
}).onConflictDoUpdate({
  target: providerUsers.email,
  set: { passwordHash, name: name || email, isActive: true },
}).returning({ id: providerUsers.id, email: providerUsers.email });

console.log(`Utilizador do painel ${user.email} (${user.id}) criado/actualizado.`);
await queryClient.end();
