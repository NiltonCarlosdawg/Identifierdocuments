import { Elysia, t } from "elysia";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { suggestCategory } from "../services/classifier.service";
import { db } from "../db";
import { categories, classifierFeedback, documents } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const classifierModule = new Elysia({ prefix: "/classifier" })
  .use(requireAuth())

  .post("/suggest", async ({ auth, body, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const allowed = await checkRateLimit(`classifier:${auth!.userId}`, 10, 60_000);
          if (!allowed) {
            set.status = 429;
            return { error: { code: "RATE_LIMITED", message: "Muitos pedidos ao classificador. Tente novamente dentro de 1 minuto." } };
          }
          const result = await suggestCategory(body.text, body.filename);

          if (result.categoryId === "UNKNOWN") {
            return { data: { ...result, availableCategories: await tx.query.categories.findMany() } };
          }

          const category = await tx.query.categories.findFirst({
            where: (cats, { eq }) => eq(cats.id, result.categoryId),
          });

          return {
            data: {
              categoryId: result.categoryId,
              categoryName: category?.name || null,
              group: category?.group || null,
              confidence: result.confidence,
              reasoning: result.reasoning,
            },
          };
        } catch (err: any) {
          console.error("[CLASSIFIER_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "CLASSIFIER_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      text: t.String({ minLength: 10 }),
      filename: t.Optional(t.String()),
    }),
    detail: { summary: "Sugerir categoria por IA", tags: ["Classificador"] },
  })

  .post("/feedback", async ({ auth, body, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const suggestedExists = await tx.query.categories.findFirst({ where: (cats, { eq }) => eq(cats.id, body.suggestedCategoryId) });
          if (!suggestedExists) {
            set.status = 422;
            return { error: { code: "INVALID_CATEGORY", message: `Categoria sugerida "${body.suggestedCategoryId}" não existe.` } };
          }

          const chosenExists = await tx.query.categories.findFirst({ where: (cats, { eq }) => eq(cats.id, body.chosenCategoryId) });
          if (!chosenExists) {
            set.status = 422;
            return { error: { code: "INVALID_CATEGORY", message: `Categoria escolhida "${body.chosenCategoryId}" não existe.` } };
          }

          if (body.documentId) {
            const doc = await tx.query.documents.findFirst({
              where: (docs, { eq, and }) => and(eq(docs.id, body.documentId!), eq(docs.tenantId, tenantId)),
              columns: { id: true },
            });
            if (!doc) {
              set.status = 422;
              return { error: { code: "INVALID_DOCUMENT", message: "Documento não encontrado ou não pertence a esta organização." } };
            }
          }

          const [fb] = await tx.insert(classifierFeedback).values({
            tenantId,
            documentId: body.documentId || null,
            suggestedCategoryId: body.suggestedCategoryId,
            chosenCategoryId: body.chosenCategoryId,
            accepted: body.accepted,
          }).returning();

          return { data: fb };
        } catch (err: any) {
          console.error("[FEEDBACK_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "FEEDBACK_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      documentId: t.Optional(t.String()),
      suggestedCategoryId: t.String(),
      chosenCategoryId: t.String(),
      accepted: t.Boolean(),
    }),
    detail: { summary: "Registar feedback do classificador", tags: ["Classificador"] },
  });
