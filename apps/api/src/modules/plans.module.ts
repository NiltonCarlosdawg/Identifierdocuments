import Elysia from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { plans } from "../db/schema";

// Tabela global: SEM withTenant (plans não é uma tabela de tenant).
export const plansModule = new (Elysia as any)({ prefix: "/plans" })
  .get("/", async () => {
    const rows = await db.select({
      id: plans.id,
      name: plans.name,
      price: plans.price,
      maxUsers: plans.maxUsers,
      monthlyOnlineIdentifiers: plans.monthlyOnlineIdentifiers,
      offlineBudgetPerMachine: plans.offlineBudgetPerMachine,
    }).from(plans).where(eq(plans.active, true));
    return { plans: rows };
  }, {
    detail: { summary: "Planos activos (público)", tags: ["Planos"] },
  });
