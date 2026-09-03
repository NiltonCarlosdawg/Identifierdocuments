# Commit b9bb9789c3713a24c0971844501a35d51bfa0d0b
**Author:** NiltonCarlosdawg <niltoncost186@gmail.com>
**Date:** Fri Jul 24 21:13:27 2026 +0100

feat: fluxo de pedido/aprovação de acesso com tabela dedicada + restrições de sector

- Schema: document_access_requests + source_request_id em document_shares
- Request-access endpoints refactorados para document_access_requests
- GET/PATCH/POST cancel access-requests com permissões (owner/supervisor)
- Revoke bloqueado para shares com sourceRequestId
- approvals.module limpo do branch access_request
- POST /users permite SECTOR_SUPERVISOR (força MEMBER + sectorId)
- GET /users filtrado por sector (early return vazio se sem sector)
- PATCH /users/:id/sector exclusivo ORG_ADMIN via .guard()
- GET /stats e /audit filtrados por sector conforme role
- requireSectorScope middleware com bypassRoles e aplicado a GET /:id/members

diff --git a/apps/api/src/db/migrations/0012_ordinary_stellaris.sql b/apps/api/src/db/migrations/0012_ordinary_stellaris.sql
new file mode 100644
index 0000000..d2b95f3
--- /dev/null
+++ b/apps/api/src/db/migrations/0012_ordinary_stellaris.sql
@@ -0,0 +1,61 @@
+CREATE TABLE IF NOT EXISTS "document_access_requests" (
+	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
+	"tenant_id" uuid NOT NULL,
+	"document_id" uuid NOT NULL,
+	"requester_id" uuid NOT NULL,
+	"status" text DEFAULT 'pending' NOT NULL,
+	"resolved_by" uuid,
+	"resolved_at" timestamp,
+	"created_at" timestamp DEFAULT now() NOT NULL
+);
+--> statement-breakpoint
+CREATE TABLE IF NOT EXISTS "idempotency_records" (
+	"tenant_id" uuid NOT NULL,
+	"idempotency_key" text NOT NULL,
+	"result" jsonb NOT NULL,
+	"created_at" timestamp DEFAULT now() NOT NULL,
+	CONSTRAINT "idempotency_records_tenant_id_idempotency_key_pk" PRIMARY KEY("tenant_id","idempotency_key")
+);
+--> statement-breakpoint
+ALTER TABLE "document_shares" ADD COLUMN "source_request_id" uuid;--> statement-breakpoint
+DO $$ BEGIN
+ ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
+EXCEPTION
+ WHEN duplicate_object THEN null;
+END $$;
+--> statement-breakpoint
+DO $$ BEGIN
+ ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
+EXCEPTION
+ WHEN duplicate_object THEN null;
+END $$;
+--> statement-breakpoint
+DO $$ BEGIN
+ ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
+EXCEPTION
+ WHEN duplicate_object THEN null;
+END $$;
+--> statement-breakpoint
+DO $$ BEGIN
+ ALTER TABLE "document_access_requests" ADD CONSTRAINT "document_access_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
+EXCEPTION
+ WHEN duplicate_object THEN null;
+END $$;
+--> statement-breakpoint
+DO $$ BEGIN
+ ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
+EXCEPTION
+ WHEN duplicate_object THEN null;
+END $$;
+--> statement-breakpoint
+CREATE INDEX IF NOT EXISTS "dar_tenant_idx" ON "document_access_requests" USING btree ("tenant_id");--> statement-breakpoint
+CREATE INDEX IF NOT EXISTS "dar_document_idx" ON "document_access_requests" USING btree ("document_id");--> statement-breakpoint
+CREATE INDEX IF NOT EXISTS "dar_requester_idx" ON "document_access_requests" USING btree ("requester_id");--> statement-breakpoint
+CREATE INDEX IF NOT EXISTS "dar_status_idx" ON "document_access_requests" USING btree ("status");--> statement-breakpoint
+DO $$ BEGIN
+ ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_source_request_id_document_access_requests_id_fk" FOREIGN KEY ("source_request_id") REFERENCES "public"."document_access_requests"("id") ON DELETE no action ON UPDATE no action;
+EXCEPTION
+ WHEN duplicate_object THEN null;
+END $$;
+--> statement-breakpoint
+CREATE INDEX IF NOT EXISTS "document_shares_source_request_idx" ON "document_shares" USING btree ("source_request_id");
\ No newline at end of file
diff --git a/apps/api/src/db/migrations/meta/0012_snapshot.json b/apps/api/src/db/migrations/meta/0012_snapshot.json
new file mode 100644
index 0000000..8eedf2b
--- /dev/null
+++ b/apps/api/src/db/migrations/meta/0012_snapshot.json
@@ -0,0 +1,2486 @@
+{
+  "id": "30aa3b29-e88b-4b7a-9cd9-d59eb4a824fc",
+  "prevId": "0d22d8d3-9e59-4448-b4aa-9ca10c5d5d84",
+  "version": "7",
+  "dialect": "postgresql",
+  "tables": {
+    "public.approvals": {
+      "name": "approvals",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "document_id": {
+          "name": "document_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "share_id": {
+          "name": "share_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "sector_id": {
+          "name": "sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "supervisor_id": {
+          "name": "supervisor_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "requester_id": {
+          "name": "requester_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "type": {
+          "name": "type",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'cross_sector'"
+        },
+        "status": {
+          "name": "status",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'pending'"
+        },
+        "notes": {
+          "name": "notes",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "requested_at": {
+          "name": "requested_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "resolved_at": {
+          "name": "resolved_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "approvals_tenant_idx": {
+          "name": "approvals_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "approvals_status_idx": {
+          "name": "approvals_status_idx",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "approvals_document_idx": {
+          "name": "approvals_document_idx",
+          "columns": [
+            {
+              "expression": "document_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "approvals_tenant_id_organizations_id_fk": {
+          "name": "approvals_tenant_id_organizations_id_fk",
+          "tableFrom": "approvals",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "approvals_document_id_documents_id_fk": {
+          "name": "approvals_document_id_documents_id_fk",
+          "tableFrom": "approvals",
+          "tableTo": "documents",
+          "columnsFrom": [
+            "document_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "approvals_share_id_document_shares_id_fk": {
+          "name": "approvals_share_id_document_shares_id_fk",
+          "tableFrom": "approvals",
+          "tableTo": "document_shares",
+          "columnsFrom": [
+            "share_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "approvals_sector_id_sectors_id_fk": {
+          "name": "approvals_sector_id_sectors_id_fk",
+          "tableFrom": "approvals",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "approvals_supervisor_id_users_id_fk": {
+          "name": "approvals_supervisor_id_users_id_fk",
+          "tableFrom": "approvals",
+          "tableTo": "users",
+          "columnsFrom": [
+            "supervisor_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "approvals_requester_id_users_id_fk": {
+          "name": "approvals_requester_id_users_id_fk",
+          "tableFrom": "approvals",
+          "tableTo": "users",
+          "columnsFrom": [
+            "requester_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.audit_logs": {
+      "name": "audit_logs",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "action": {
+          "name": "action",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "resource": {
+          "name": "resource",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "resource_id": {
+          "name": "resource_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "metadata": {
+          "name": "metadata",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "ip": {
+          "name": "ip",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "audit_tenant_idx": {
+          "name": "audit_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "audit_created_idx": {
+          "name": "audit_created_idx",
+          "columns": [
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "audit_logs_tenant_id_organizations_id_fk": {
+          "name": "audit_logs_tenant_id_organizations_id_fk",
+          "tableFrom": "audit_logs",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "audit_logs_user_id_users_id_fk": {
+          "name": "audit_logs_user_id_users_id_fk",
+          "tableFrom": "audit_logs",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.categories": {
+      "name": "categories",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "text",
+          "primaryKey": true,
+          "notNull": true
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "group": {
+          "name": "group",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "prefix": {
+          "name": "prefix",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "default_visibility": {
+          "name": "default_visibility",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'public'"
+        },
+        "requires_sequential": {
+          "name": "requires_sequential",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "categories_prefix_unique": {
+          "name": "categories_prefix_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "prefix"
+          ]
+        }
+      }
+    },
+    "public.classifier_feedback": {
+      "name": "classifier_feedback",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "document_id": {
+          "name": "document_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "suggested_category_id": {
+          "name": "suggested_category_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "chosen_category_id": {
+          "name": "chosen_category_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "accepted": {
+          "name": "accepted",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "classifier_feedback_tenant_idx": {
+          "name": "classifier_feedback_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "classifier_feedback_document_idx": {
+          "name": "classifier_feedback_document_idx",
+          "columns": [
+            {
+              "expression": "document_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "classifier_feedback_tenant_id_organizations_id_fk": {
+          "name": "classifier_feedback_tenant_id_organizations_id_fk",
+          "tableFrom": "classifier_feedback",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "classifier_feedback_document_id_documents_id_fk": {
+          "name": "classifier_feedback_document_id_documents_id_fk",
+          "tableFrom": "classifier_feedback",
+          "tableTo": "documents",
+          "columnsFrom": [
+            "document_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.devices": {
+      "name": "devices",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'active'"
+        },
+        "last_seen_at": {
+          "name": "last_seen_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "devices_tenant_idx": {
+          "name": "devices_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "devices_user_idx": {
+          "name": "devices_user_idx",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "devices_tenant_id_organizations_id_fk": {
+          "name": "devices_tenant_id_organizations_id_fk",
+          "tableFrom": "devices",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "devices_user_id_users_id_fk": {
+          "name": "devices_user_id_users_id_fk",
+          "tableFrom": "devices",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.document_access_requests": {
+      "name": "document_access_requests",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "document_id": {
+          "name": "document_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "requester_id": {
+          "name": "requester_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "status": {
+          "name": "status",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'pending'"
+        },
+        "resolved_by": {
+          "name": "resolved_by",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "resolved_at": {
+          "name": "resolved_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "dar_tenant_idx": {
+          "name": "dar_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "dar_document_idx": {
+          "name": "dar_document_idx",
+          "columns": [
+            {
+              "expression": "document_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "dar_requester_idx": {
+          "name": "dar_requester_idx",
+          "columns": [
+            {
+              "expression": "requester_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "dar_status_idx": {
+          "name": "dar_status_idx",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "document_access_requests_tenant_id_organizations_id_fk": {
+          "name": "document_access_requests_tenant_id_organizations_id_fk",
+          "tableFrom": "document_access_requests",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_access_requests_document_id_documents_id_fk": {
+          "name": "document_access_requests_document_id_documents_id_fk",
+          "tableFrom": "document_access_requests",
+          "tableTo": "documents",
+          "columnsFrom": [
+            "document_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_access_requests_requester_id_users_id_fk": {
+          "name": "document_access_requests_requester_id_users_id_fk",
+          "tableFrom": "document_access_requests",
+          "tableTo": "users",
+          "columnsFrom": [
+            "requester_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_access_requests_resolved_by_users_id_fk": {
+          "name": "document_access_requests_resolved_by_users_id_fk",
+          "tableFrom": "document_access_requests",
+          "tableTo": "users",
+          "columnsFrom": [
+            "resolved_by"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.document_shares": {
+      "name": "document_shares",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "document_id": {
+          "name": "document_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "shared_by": {
+          "name": "shared_by",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "shared_with_sector_id": {
+          "name": "shared_with_sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "shared_with_user_id": {
+          "name": "shared_with_user_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "source_request_id": {
+          "name": "source_request_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'active'"
+        },
+        "revoked_at": {
+          "name": "revoked_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "document_shares_document_idx": {
+          "name": "document_shares_document_idx",
+          "columns": [
+            {
+              "expression": "document_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "document_shares_user_idx": {
+          "name": "document_shares_user_idx",
+          "columns": [
+            {
+              "expression": "shared_with_user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "document_shares_sector_idx": {
+          "name": "document_shares_sector_idx",
+          "columns": [
+            {
+              "expression": "shared_with_sector_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "document_shares_status_idx": {
+          "name": "document_shares_status_idx",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "document_shares_source_request_idx": {
+          "name": "document_shares_source_request_idx",
+          "columns": [
+            {
+              "expression": "source_request_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "document_shares_document_id_documents_id_fk": {
+          "name": "document_shares_document_id_documents_id_fk",
+          "tableFrom": "document_shares",
+          "tableTo": "documents",
+          "columnsFrom": [
+            "document_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_shares_shared_by_users_id_fk": {
+          "name": "document_shares_shared_by_users_id_fk",
+          "tableFrom": "document_shares",
+          "tableTo": "users",
+          "columnsFrom": [
+            "shared_by"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_shares_shared_with_sector_id_sectors_id_fk": {
+          "name": "document_shares_shared_with_sector_id_sectors_id_fk",
+          "tableFrom": "document_shares",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "shared_with_sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_shares_shared_with_user_id_users_id_fk": {
+          "name": "document_shares_shared_with_user_id_users_id_fk",
+          "tableFrom": "document_shares",
+          "tableTo": "users",
+          "columnsFrom": [
+            "shared_with_user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "document_shares_source_request_id_document_access_requests_id_fk": {
+          "name": "document_shares_source_request_id_document_access_requests_id_fk",
+          "tableFrom": "document_shares",
+          "tableTo": "document_access_requests",
+          "columnsFrom": [
+            "source_request_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.documents": {
+      "name": "documents",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "identifier_id": {
+          "name": "identifier_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "filename": {
+          "name": "filename",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "mime_type": {
+          "name": "mime_type",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "file_path": {
+          "name": "file_path",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "file_size": {
+          "name": "file_size",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "extracted_text": {
+          "name": "extracted_text",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "uploaded_by": {
+          "name": "uploaded_by",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "upload_source": {
+          "name": "upload_source",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'manual'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "documents_tenant_idx": {
+          "name": "documents_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "documents_tenant_id_organizations_id_fk": {
+          "name": "documents_tenant_id_organizations_id_fk",
+          "tableFrom": "documents",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "documents_identifier_id_identifiers_id_fk": {
+          "name": "documents_identifier_id_identifiers_id_fk",
+          "tableFrom": "documents",
+          "tableTo": "identifiers",
+          "columnsFrom": [
+            "identifier_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "documents_uploaded_by_users_id_fk": {
+          "name": "documents_uploaded_by_users_id_fk",
+          "tableFrom": "documents",
+          "tableTo": "users",
+          "columnsFrom": [
+            "uploaded_by"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "documents_identifier_id_unique": {
+          "name": "documents_identifier_id_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "identifier_id"
+          ]
+        }
+      }
+    },
+    "public.idempotency_records": {
+      "name": "idempotency_records",
+      "schema": "",
+      "columns": {
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "idempotency_key": {
+          "name": "idempotency_key",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "result": {
+          "name": "result",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {
+        "idempotency_records_tenant_id_organizations_id_fk": {
+          "name": "idempotency_records_tenant_id_organizations_id_fk",
+          "tableFrom": "idempotency_records",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {
+        "idempotency_records_tenant_id_idempotency_key_pk": {
+          "name": "idempotency_records_tenant_id_idempotency_key_pk",
+          "columns": [
+            "tenant_id",
+            "idempotency_key"
+          ]
+        }
+      },
+      "uniqueConstraints": {}
+    },
+    "public.identifier_leases": {
+      "name": "identifier_leases",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "category_id": {
+          "name": "category_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "sector_id": {
+          "name": "sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "device_id": {
+          "name": "device_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "start_seq": {
+          "name": "start_seq",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "end_seq": {
+          "name": "end_seq",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "used_up_to": {
+          "name": "used_up_to",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "status": {
+          "name": "status",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'active'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        },
+        "released_at": {
+          "name": "released_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": false
+        }
+      },
+      "indexes": {
+        "leases_tenant_idx": {
+          "name": "leases_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "leases_tenant_category_idx": {
+          "name": "leases_tenant_category_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "category_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "leases_device_idx": {
+          "name": "leases_device_idx",
+          "columns": [
+            {
+              "expression": "device_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "leases_status_idx": {
+          "name": "leases_status_idx",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "leases_device_cat_active_idx": {
+          "name": "leases_device_cat_active_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "category_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "device_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "where": "status = 'active'",
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "identifier_leases_tenant_id_organizations_id_fk": {
+          "name": "identifier_leases_tenant_id_organizations_id_fk",
+          "tableFrom": "identifier_leases",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifier_leases_category_id_categories_id_fk": {
+          "name": "identifier_leases_category_id_categories_id_fk",
+          "tableFrom": "identifier_leases",
+          "tableTo": "categories",
+          "columnsFrom": [
+            "category_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifier_leases_sector_id_sectors_id_fk": {
+          "name": "identifier_leases_sector_id_sectors_id_fk",
+          "tableFrom": "identifier_leases",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifier_leases_device_id_devices_id_fk": {
+          "name": "identifier_leases_device_id_devices_id_fk",
+          "tableFrom": "identifier_leases",
+          "tableTo": "devices",
+          "columnsFrom": [
+            "device_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.identifier_release_pool": {
+      "name": "identifier_release_pool",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "category_id": {
+          "name": "category_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "sector_id": {
+          "name": "sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "range_start": {
+          "name": "range_start",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "range_end": {
+          "name": "range_end",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "pool_tenant_idx": {
+          "name": "pool_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "pool_tenant_category_idx": {
+          "name": "pool_tenant_category_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "category_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "identifier_release_pool_tenant_id_organizations_id_fk": {
+          "name": "identifier_release_pool_tenant_id_organizations_id_fk",
+          "tableFrom": "identifier_release_pool",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifier_release_pool_category_id_categories_id_fk": {
+          "name": "identifier_release_pool_category_id_categories_id_fk",
+          "tableFrom": "identifier_release_pool",
+          "tableTo": "categories",
+          "columnsFrom": [
+            "category_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifier_release_pool_sector_id_sectors_id_fk": {
+          "name": "identifier_release_pool_sector_id_sectors_id_fk",
+          "tableFrom": "identifier_release_pool",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.identifiers": {
+      "name": "identifiers",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "sector_id": {
+          "name": "sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "category_id": {
+          "name": "category_id",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "identifier": {
+          "name": "identifier",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "sequence": {
+          "name": "sequence",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "issued_to": {
+          "name": "issued_to",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "description": {
+          "name": "description",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "visibility": {
+          "name": "visibility",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'public'"
+        },
+        "status": {
+          "name": "status",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'draft'"
+        },
+        "origin": {
+          "name": "origin",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'digital'"
+        },
+        "created_by": {
+          "name": "created_by",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "identifiers_tenant_idx": {
+          "name": "identifiers_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "identifiers_status_idx": {
+          "name": "identifiers_status_idx",
+          "columns": [
+            {
+              "expression": "status",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "identifiers_created_idx": {
+          "name": "identifiers_created_idx",
+          "columns": [
+            {
+              "expression": "created_at",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "identifiers_tenant_identifier_idx": {
+          "name": "identifiers_tenant_identifier_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "identifier",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "identifiers_tenant_id_organizations_id_fk": {
+          "name": "identifiers_tenant_id_organizations_id_fk",
+          "tableFrom": "identifiers",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifiers_sector_id_sectors_id_fk": {
+          "name": "identifiers_sector_id_sectors_id_fk",
+          "tableFrom": "identifiers",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifiers_category_id_categories_id_fk": {
+          "name": "identifiers_category_id_categories_id_fk",
+          "tableFrom": "identifiers",
+          "tableTo": "categories",
+          "columnsFrom": [
+            "category_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "identifiers_created_by_users_id_fk": {
+          "name": "identifiers_created_by_users_id_fk",
+          "tableFrom": "identifiers",
+          "tableTo": "users",
+          "columnsFrom": [
+            "created_by"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.notifications": {
+      "name": "notifications",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "type": {
+          "name": "type",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "payload": {
+          "name": "payload",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "is_read": {
+          "name": "is_read",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "notifications_user_idx": {
+          "name": "notifications_user_idx",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "notifications_read_idx": {
+          "name": "notifications_read_idx",
+          "columns": [
+            {
+              "expression": "is_read",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "notifications_tenant_id_organizations_id_fk": {
+          "name": "notifications_tenant_id_organizations_id_fk",
+          "tableFrom": "notifications",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "notifications_user_id_users_id_fk": {
+          "name": "notifications_user_id_users_id_fk",
+          "tableFrom": "notifications",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.organizations": {
+      "name": "organizations",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "slug": {
+          "name": "slug",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "identifier_prefix": {
+          "name": "identifier_prefix",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'VL'"
+        },
+        "identifier_lease_batch_size": {
+          "name": "identifier_lease_batch_size",
+          "type": "integer",
+          "primaryKey": false,
+          "notNull": true,
+          "default": 50
+        },
+        "plan": {
+          "name": "plan",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'starter'"
+        },
+        "is_active": {
+          "name": "is_active",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {},
+      "foreignKeys": {},
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {
+        "organizations_slug_unique": {
+          "name": "organizations_slug_unique",
+          "nullsNotDistinct": false,
+          "columns": [
+            "slug"
+          ]
+        }
+      }
+    },
+    "public.role_permissions": {
+      "name": "role_permissions",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "role_id": {
+          "name": "role_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "resource": {
+          "name": "resource",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "action": {
+          "name": "action",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        }
+      },
+      "indexes": {
+        "role_perm_unique_idx": {
+          "name": "role_perm_unique_idx",
+          "columns": [
+            {
+              "expression": "role_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "resource",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "action",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "role_permissions_role_id_roles_id_fk": {
+          "name": "role_permissions_role_id_roles_id_fk",
+          "tableFrom": "role_permissions",
+          "tableTo": "roles",
+          "columnsFrom": [
+            "role_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.roles": {
+      "name": "roles",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "is_system": {
+          "name": "is_system",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "roles_tenant_name_idx": {
+          "name": "roles_tenant_name_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "name",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "roles_tenant_id_organizations_id_fk": {
+          "name": "roles_tenant_id_organizations_id_fk",
+          "tableFrom": "roles",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.sectors": {
+      "name": "sectors",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "name": {
+          "name": "name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "code": {
+          "name": "code",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "supervisor_id": {
+          "name": "supervisor_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "sectors_tenant_code_idx": {
+          "name": "sectors_tenant_code_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "code",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        },
+        "sectors_tenant_idx": {
+          "name": "sectors_tenant_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": false,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "sectors_tenant_id_organizations_id_fk": {
+          "name": "sectors_tenant_id_organizations_id_fk",
+          "tableFrom": "sectors",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "sectors_supervisor_id_users_id_fk": {
+          "name": "sectors_supervisor_id_users_id_fk",
+          "tableFrom": "sectors",
+          "tableTo": "users",
+          "columnsFrom": [
+            "supervisor_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.user_roles": {
+      "name": "user_roles",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "user_id": {
+          "name": "user_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "role_id": {
+          "name": "role_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "sector_id": {
+          "name": "sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "granted_by": {
+          "name": "granted_by",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "user_role_unique_idx": {
+          "name": "user_role_unique_idx",
+          "columns": [
+            {
+              "expression": "user_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "role_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "user_roles_user_id_users_id_fk": {
+          "name": "user_roles_user_id_users_id_fk",
+          "tableFrom": "user_roles",
+          "tableTo": "users",
+          "columnsFrom": [
+            "user_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "user_roles_role_id_roles_id_fk": {
+          "name": "user_roles_role_id_roles_id_fk",
+          "tableFrom": "user_roles",
+          "tableTo": "roles",
+          "columnsFrom": [
+            "role_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "user_roles_sector_id_sectors_id_fk": {
+          "name": "user_roles_sector_id_sectors_id_fk",
+          "tableFrom": "user_roles",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "user_roles_granted_by_users_id_fk": {
+          "name": "user_roles_granted_by_users_id_fk",
+          "tableFrom": "user_roles",
+          "tableTo": "users",
+          "columnsFrom": [
+            "granted_by"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    },
+    "public.users": {
+      "name": "users",
+      "schema": "",
+      "columns": {
+        "id": {
+          "name": "id",
+          "type": "uuid",
+          "primaryKey": true,
+          "notNull": true,
+          "default": "gen_random_uuid()"
+        },
+        "tenant_id": {
+          "name": "tenant_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "sector_id": {
+          "name": "sector_id",
+          "type": "uuid",
+          "primaryKey": false,
+          "notNull": false
+        },
+        "email": {
+          "name": "email",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "password_hash": {
+          "name": "password_hash",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "full_name": {
+          "name": "full_name",
+          "type": "text",
+          "primaryKey": false,
+          "notNull": true
+        },
+        "is_active": {
+          "name": "is_active",
+          "type": "boolean",
+          "primaryKey": false,
+          "notNull": true,
+          "default": true
+        },
+        "notification_preferences": {
+          "name": "notification_preferences",
+          "type": "jsonb",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "'{}'"
+        },
+        "created_at": {
+          "name": "created_at",
+          "type": "timestamp",
+          "primaryKey": false,
+          "notNull": true,
+          "default": "now()"
+        }
+      },
+      "indexes": {
+        "users_tenant_email_idx": {
+          "name": "users_tenant_email_idx",
+          "columns": [
+            {
+              "expression": "tenant_id",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            },
+            {
+              "expression": "email",
+              "isExpression": false,
+              "asc": true,
+              "nulls": "last"
+            }
+          ],
+          "isUnique": true,
+          "concurrently": false,
+          "method": "btree",
+          "with": {}
+        }
+      },
+      "foreignKeys": {
+        "users_tenant_id_organizations_id_fk": {
+          "name": "users_tenant_id_organizations_id_fk",
+          "tableFrom": "users",
+          "tableTo": "organizations",
+          "columnsFrom": [
+            "tenant_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        },
+        "users_sector_id_sectors_id_fk": {
+          "name": "users_sector_id_sectors_id_fk",
+          "tableFrom": "users",
+          "tableTo": "sectors",
+          "columnsFrom": [
+            "sector_id"
+          ],
+          "columnsTo": [
+            "id"
+          ],
+          "onDelete": "no action",
+          "onUpdate": "no action"
+        }
+      },
+      "compositePrimaryKeys": {},
+      "uniqueConstraints": {}
+    }
+  },
+  "enums": {},
+  "schemas": {},
+  "_meta": {
+    "columns": {},
+    "schemas": {},
+    "tables": {}
+  }
+}
\ No newline at end of file
diff --git a/apps/api/src/db/migrations/meta/_journal.json b/apps/api/src/db/migrations/meta/_journal.json
index db74f8d..e323ffe 100644
--- a/apps/api/src/db/migrations/meta/_journal.json
+++ b/apps/api/src/db/migrations/meta/_journal.json
@@ -85,6 +85,13 @@
       "when": 1785321600000,
       "tag": "0011_idempotency_records",
       "breakpoints": true
+    },
+    {
+      "idx": 12,
+      "version": "7",
+      "when": 1784918871911,
+      "tag": "0012_ordinary_stellaris",
+      "breakpoints": true
     }
   ]
 }
\ No newline at end of file
diff --git a/apps/api/src/db/schema.ts b/apps/api/src/db/schema.ts
index c36223d..f4422c1 100644
--- a/apps/api/src/db/schema.ts
+++ b/apps/api/src/db/schema.ts
@@ -124,12 +124,29 @@ export const documents = pgTable("documents", {
   index("documents_tenant_idx").on(t.tenantId),
 ]);
 
+export const documentAccessRequests = pgTable("document_access_requests", {
+  id: uuid("id").primaryKey().defaultRandom(),
+  tenantId: uuid("tenant_id").notNull().references(() => organizations.id),
+  documentId: uuid("document_id").notNull().references(() => documents.id),
+  requesterId: uuid("requester_id").notNull().references(() => users.id),
+  status: text("status", { enum: ["pending", "approved", "denied", "cancelled"] }).notNull().default("pending"),
+  resolvedBy: uuid("resolved_by").references(() => users.id),
+  resolvedAt: timestamp("resolved_at"),
+  createdAt: timestamp("created_at").notNull().defaultNow(),
+}, (t) => [
+  index("dar_tenant_idx").on(t.tenantId),
+  index("dar_document_idx").on(t.documentId),
+  index("dar_requester_idx").on(t.requesterId),
+  index("dar_status_idx").on(t.status),
+]);
+
 export const documentShares = pgTable("document_shares", {
   id: uuid("id").primaryKey().defaultRandom(),
   documentId: uuid("document_id").notNull().references(() => documents.id),
   sharedBy: uuid("shared_by").notNull().references(() => users.id),
   sharedWithSectorId: uuid("shared_with_sector_id").references(() => sectors.id),
   sharedWithUserId: uuid("shared_with_user_id").references(() => users.id),
+  sourceRequestId: uuid("source_request_id").references(() => documentAccessRequests.id),
   // "pending_approval": partilha cross-sector criada mas ainda sem aprovação do
   // supervisor do sector destino — não deve conceder acesso enquanto não passar a "active".
   status: text("status", { enum: ["pending_approval", "active"] }).notNull().default("active"),
@@ -140,6 +157,7 @@ export const documentShares = pgTable("document_shares", {
   index("document_shares_user_idx").on(t.sharedWithUserId),
   index("document_shares_sector_idx").on(t.sharedWithSectorId),
   index("document_shares_status_idx").on(t.status),
+  index("document_shares_source_request_idx").on(t.sourceRequestId),
 ]);
 
 export const approvals = pgTable("approvals", {
@@ -316,11 +334,19 @@ export const documentRelations = relations(documents, ({ one, many }) => ({
   approvals: many(approvals),
 }));
 
+export const documentAccessRequestRelations = relations(documentAccessRequests, ({ one }) => ({
+  tenant: one(organizations, { fields: [documentAccessRequests.tenantId], references: [organizations.id] }),
+  document: one(documents, { fields: [documentAccessRequests.documentId], references: [documents.id] }),
+  requester: one(users, { fields: [documentAccessRequests.requesterId], references: [users.id] }),
+  resolver: one(users, { fields: [documentAccessRequests.resolvedBy], references: [users.id] }),
+}));
+
 export const documentShareRelations = relations(documentShares, ({ one }) => ({
   document: one(documents, { fields: [documentShares.documentId], references: [documents.id] }),
   sharer: one(users, { fields: [documentShares.sharedBy], references: [users.id], relationName: "sharedByShares" }),
   sector: one(sectors, { fields: [documentShares.sharedWithSectorId], references: [sectors.id] }),
   user: one(users, { fields: [documentShares.sharedWithUserId], references: [users.id] }),
+  sourceRequest: one(documentAccessRequests, { fields: [documentShares.sourceRequestId], references: [documentAccessRequests.id] }),
 }));
 
 export const approvalRelations = relations(approvals, ({ one }) => ({
diff --git a/apps/api/src/middleware/auth.ts b/apps/api/src/middleware/auth.ts
index ac192d5..0cbed3f 100644
--- a/apps/api/src/middleware/auth.ts
+++ b/apps/api/src/middleware/auth.ts
@@ -2,7 +2,7 @@ import { Elysia } from "elysia";
 import { jwtVerify } from "jose";
 import { SignJWT } from "jose";
 import { db } from "../db";
-import { userRoles, roles } from "../db/schema";
+import { userRoles, roles, users } from "../db/schema";
 import { eq, and } from "drizzle-orm";
 
 const rawSecret = process.env.JWT_SECRET;
@@ -105,3 +105,42 @@ export function requireRole(...requiredRoles: string[]) {
       },
     });
 }
+
+/** Garante que o utilizador autenticado tem um sector atribuído.
+ *
+ * - `derive`: busca o sector do utilizador (PK lookup, sem risco cross-tenant)
+ *   e expõe `sectorScopeId` no contexto para os handlers consumirem.
+ *   Usa `db` directamente (não `withTenant`) porque os hooks Elysia correm
+ *   antes do handler e não têm acesso à transacção — seguro porque a query
+ *   é `WHERE users.id = ?` (PK única, sem leak entre tenants).
+ * - `guard`: nega 401 sem auth, 403 sem sector.
+ *
+ * Opcionalmente aceita `bypassRoles` — array de nomes de role que passam
+ * o guard mesmo sem `sectorId` (ex.: `requireSectorScope({ bypassRoles: ["ORG_ADMIN"] })`). */
+export function requireSectorScope(opts?: { bypassRoles?: string[] }) {
+  return (app: Elysia) => app
+    .derive({ as: "scoped" }, async (ctx: any) => {
+      if (!ctx.auth) return {};
+      const [user] = await db
+        .select({ sectorId: users.sectorId })
+        .from(users)
+        .where(eq(users.id, ctx.auth.userId));
+      return { sectorScopeId: user?.sectorId ?? null };
+    })
+    .guard({
+      beforeHandle: async (ctx: any) => {
+        if (!ctx.auth) {
+          ctx.set.status = 401;
+          return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } };
+        }
+        if (opts?.bypassRoles?.length) {
+          const roleNames = await getFreshRoles(ctx.auth.userId, ctx.auth.tenantId);
+          if (opts.bypassRoles.some((r) => roleNames.includes(r))) return;
+        }
+        if (!ctx.sectorScopeId) {
+          ctx.set.status = 403;
+          return { error: { code: "FORBIDDEN", message: "Utilizador sem sector atribuído." } };
+        }
+      },
+    });
+}
diff --git a/apps/api/src/modules/approvals.module.ts b/apps/api/src/modules/approvals.module.ts
index 491d60a..779321d 100644
--- a/apps/api/src/modules/approvals.module.ts
+++ b/apps/api/src/modules/approvals.module.ts
@@ -108,21 +108,6 @@ export const approvalsModule = new Elysia({ prefix: "/approvals" })
           const identifierStr = doc?.identifier?.identifier;
 
           if (body.status === "approved") {
-            if (existing.type === "access_request" && existing.requesterId) {
-              await tx.insert(documentShares).values({
-                documentId: approval.documentId, sharedBy: auth!.userId,
-                sharedWithUserId: existing.requesterId,
-              });
-              await notify(tx, {
-                type: "access:granted",
-                userId: existing.requesterId,
-                tenantId,
-                payload: {
-                  documentId: approval.documentId,
-                  identifier: identifierStr,
-                },
-              });
-            }
             if (existing.type === "cross_sector" && existing.shareId) {
               const [updatedShare] = await tx.update(documentShares)
                 .set({ status: "active" })
diff --git a/apps/api/src/modules/audit.module.ts b/apps/api/src/modules/audit.module.ts
index ffd07bd..bf159f0 100644
--- a/apps/api/src/modules/audit.module.ts
+++ b/apps/api/src/modules/audit.module.ts
@@ -1,8 +1,8 @@
 import { Elysia, t } from "elysia";
 import { db } from "../db";
-import { auditLogs } from "../db/schema";
+import { auditLogs, users } from "../db/schema";
 import { eq, and, desc, sql } from "drizzle-orm";
-import { requireAuth, requireRole } from "../middleware/auth";
+import { requireAuth, getFreshRoles } from "../middleware/auth";
 import { checkRateLimit } from "../middleware/rateLimit";
 import { withTenant } from "../db/withTenant";
 import { safeError } from "../lib/errors";
@@ -17,11 +17,27 @@ const CSV_BATCH = 1000;
 
 export const auditModule = new Elysia({ prefix: "/audit" })
   .use(requireAuth())
-  .use(requireRole("ORG_ADMIN"))
 
-  .get("/", async ({ query, tenantId }) => {
+  .get("/", async ({ query, tenantId, auth }) => {
     return withTenant(tenantId, async (tx) => {
+      const roleNames = await getFreshRoles(auth!.userId, tenantId);
+      const isAdmin = roleNames.includes("ORG_ADMIN");
+
       const conditions = [eq(auditLogs.tenantId, tenantId)];
+      if (!isAdmin) {
+        const me = await tx.query.users.findFirst({
+          where: eq(users.id, auth!.userId),
+          columns: { sectorId: true },
+        });
+        if (!me?.sectorId) {
+          return { data: [], meta: { total: 0, page: 1, limit: 50 } };
+        }
+        const sectorUserIds = await tx
+          .select({ id: users.id })
+          .from(users)
+          .where(and(eq(users.tenantId, tenantId), eq(users.sectorId, me.sectorId)));
+        conditions.push(sql`${auditLogs.userId} = ANY(${sectorUserIds.map(u => u.id)})`);
+      }
       if (query.action) conditions.push(eq(auditLogs.action, query.action));
       if (query.resource) conditions.push(eq(auditLogs.resource, query.resource));
 
@@ -58,16 +74,22 @@ export const auditModule = new Elysia({ prefix: "/audit" })
       page: t.Optional(t.String()),
       limit: t.Optional(t.String()),
     }),
-    detail: { summary: "Listar logs de auditoria", tags: ["Auditoria"] },
+    detail: { summary: "Listar logs de auditoria (filtrados por sector conforme role)", tags: ["Auditoria"] },
   })
 
-  .get("/export", async ({ query, tenantId, set, request }) => {
+  .get("/export", async ({ query, tenantId, set, request, auth }) => {
     const ip = request.headers.get("x-forwarded-for") || "unknown";
     if (!(await checkRateLimit(`audit:export:${ip}:${tenantId}`, 5, 3_600_000))) {
       set.status = 429;
       return { error: { code: "RATE_LIMITED", message: "Limite de exportações excedido. Tente novamente dentro de 1 hora." } };
     }
 
+    const roleNames = await getFreshRoles(auth!.userId, tenantId);
+    if (!roleNames.includes("ORG_ADMIN")) {
+      set.status = 403;
+      return { error: { code: "FORBIDDEN", message: "Apenas administradores podem exportar auditoria." } };
+    }
+
     // NOTA: usa db.query.* directamente (sem withTenant) porque withTenant
     // envolve as queries numa db.transaction(), que é incompatível com
     // streaming — a transacção fecharia antes de o ReadableStream consumir
diff --git a/apps/api/src/modules/documents.module.ts b/apps/api/src/modules/documents.module.ts
index 83d82d9..c28d872 100644
--- a/apps/api/src/modules/documents.module.ts
+++ b/apps/api/src/modules/documents.module.ts
@@ -4,7 +4,7 @@ import path from "node:path";
 import { attachDocument, getDocumentMeta, downloadDocument, canAccessDocument } from "../services/attachment.service";
 import { getSharedDocIds } from "../services/identifier.service";
 import { requireAuth, getFreshRoles } from "../middleware/auth";
-import { documents, documentShares, approvals, sectors, auditLogs, identifiers, users } from "../db/schema";
+import { documents, documentShares, approvals, sectors, auditLogs, identifiers, users, documentAccessRequests } from "../db/schema";
 import { eq, and, isNull, or, desc } from "drizzle-orm";
 import { notify } from "../services/notification.service";
 import { withTenant } from "../db/withTenant";
@@ -487,6 +487,10 @@ export const documentsModule = new Elysia({ prefix: "/documents" })
             set.status = 422; return { error: { code: "NOT_RESTRICTED", message: "Apenas documentos sector_only necessitam de pedido de acesso." } };
           }
 
+          if (idRow.document.uploadedBy === auth!.userId) {
+            set.status = 422; return { error: { code: "OWN_DOCUMENT", message: "É dono do documento — não precisa de pedir acesso." } };
+          }
+
           const supervisorId = idRow.sector?.supervisorId;
           if (!supervisorId) {
             set.status = 422; return { error: { code: "NO_SUPERVISOR", message: "Sector emitente não tem supervisor definido." } };
@@ -509,40 +513,37 @@ export const documentsModule = new Elysia({ prefix: "/documents" })
             return { error: { code: "ALREADY_HAS_ACCESS", message: "Já tem acesso a este documento." } };
           }
 
-          const existing = await tx.query.approvals.findFirst({
+          const existing = await tx.query.documentAccessRequests.findFirst({
             where: and(
-              eq(approvals.documentId, idRow.document.id),
-              eq(approvals.requesterId, auth!.userId),
-              eq(approvals.type, "access_request"),
-              eq(approvals.status, "pending"),
+              eq(documentAccessRequests.documentId, idRow.document.id),
+              eq(documentAccessRequests.requesterId, auth!.userId),
+              eq(documentAccessRequests.status, "pending"),
             ),
           });
           if (existing) {
             set.status = 409; return { error: { code: "ALREADY_REQUESTED", message: "Já existe um pedido de acesso pendente para este documento." } };
           }
 
-          const [approval] = await tx.insert(approvals).values({
+          const [request] = await tx.insert(documentAccessRequests).values({
             tenantId, documentId: idRow.document.id,
-            sectorId: idRow.sectorId, supervisorId,
-            requesterId: auth!.userId, type: "access_request",
-            notes: body.reason ?? null,
+            requesterId: auth!.userId,
           }).returning();
 
           await notify(tx, {
             type: "access:requested",
             userId: supervisorId,
             tenantId,
-            payload: { documentId: idRow.document.id, identifier: params.param, requesterId: auth!.userId },
+            payload: { documentId: idRow.document.id, identifier: params.param, requesterId: auth!.userId, requestId: request.id },
           });
 
           await tx.insert(auditLogs).values({
             tenantId, userId: auth!.userId, action: "REQUEST_ACCESS",
             resource: "documents", resourceId: idRow.document.id,
-            metadata: JSON.stringify({ identifier: params.param, approvalId: approval.id }),
+            metadata: JSON.stringify({ identifier: params.param, requestId: request.id }),
             ip: clientIp,
           });
 
-          return { data: approval };
+          return { data: request };
         } catch (err: any) {
           console.error("[REQUEST_ACCESS_ERROR]", err);
           throw err;
@@ -558,6 +559,208 @@ export const documentsModule = new Elysia({ prefix: "/documents" })
     detail: { summary: "Solicitar acesso a documento sector_only", tags: ["Documentos"] },
   })
 
+  .get("/:param/access-requests", async ({ tenantId, auth, params, set }) => {
+    try {
+      return await withTenant(tenantId, async (tx) => {
+        try {
+          const idRow = await tx.query.identifiers.findFirst({
+            where: and(eq(identifiers.identifier, params.param), eq(identifiers.tenantId, tenantId)),
+            with: { document: true, sector: true },
+          });
+          if (!idRow?.document) {
+            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
+          }
+
+          const isOwner = idRow.document.uploadedBy === auth!.userId;
+          const isSupervisor = idRow.sector?.supervisorId === auth!.userId;
+
+          if (!isOwner && !isSupervisor) {
+            const myRequests = await tx.query.documentAccessRequests.findMany({
+              where: and(
+                eq(documentAccessRequests.documentId, idRow.document.id),
+                eq(documentAccessRequests.requesterId, auth!.userId),
+              ),
+              with: { requester: true, resolver: true },
+              orderBy: [documentAccessRequests.createdAt],
+            });
+            return { data: myRequests };
+          }
+
+          const allRequests = await tx.query.documentAccessRequests.findMany({
+            where: eq(documentAccessRequests.documentId, idRow.document.id),
+            with: { requester: true, resolver: true },
+            orderBy: [documentAccessRequests.createdAt],
+          });
+          return { data: allRequests };
+        } catch (err: any) {
+          console.error("[ACCESS_REQUESTS_ERROR]", err);
+          throw err;
+        }
+      });
+    } catch (err: any) {
+      set.status = 500;
+      return { error: { code: "ACCESS_REQUESTS_ERROR", message: safeError(err) } };
+    }
+  }, {
+    params: t.Object({ param: t.String() }),
+    detail: { summary: "Listar pedidos de acesso do documento", tags: ["Documentos"] },
+  })
+
+  .patch("/:param/access-requests/:requestId", async ({ tenantId, auth, params, body, set, clientIp }) => {
+    try {
+      return await withTenant(tenantId, async (tx) => {
+        try {
+          const idRow = await tx.query.identifiers.findFirst({
+            where: and(eq(identifiers.identifier, params.param), eq(identifiers.tenantId, tenantId)),
+            with: { document: true, sector: true },
+          });
+          if (!idRow?.document) {
+            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
+          }
+
+          const req = await tx.query.documentAccessRequests.findFirst({
+            where: and(
+              eq(documentAccessRequests.id, params.requestId),
+              eq(documentAccessRequests.documentId, idRow.document.id),
+            ),
+          });
+          if (!req) {
+            set.status = 404; return { error: { code: "NOT_FOUND", message: "Pedido de acesso não encontrado." } };
+          }
+          if (req.status !== "pending") {
+            set.status = 400; return { error: { code: "ALREADY_RESOLVED", message: "Pedido já foi resolvido." } };
+          }
+
+          const isOwner = idRow.document.uploadedBy === auth!.userId;
+          const isSupervisor = idRow.sector?.supervisorId === auth!.userId;
+          if (!isOwner && !isSupervisor) {
+            set.status = 403; return { error: { code: "FORBIDDEN", message: "Apenas o dono do documento ou o supervisor do sector podem resolver este pedido." } };
+          }
+
+          if (body.status === "approved") {
+            const now = new Date();
+            await tx.update(documentAccessRequests)
+              .set({ status: "approved", resolvedBy: auth!.userId, resolvedAt: now })
+              .where(eq(documentAccessRequests.id, params.requestId));
+
+            const [share] = await tx.insert(documentShares).values({
+              documentId: idRow.document.id,
+              sharedBy: auth!.userId,
+              sharedWithUserId: req.requesterId,
+              sourceRequestId: req.id,
+            }).returning();
+
+            await notify(tx, {
+              type: "access:granted",
+              userId: req.requesterId,
+              tenantId,
+              payload: { documentId: idRow.document.id, identifier: params.param, shareId: share.id },
+            });
+
+            await tx.insert(auditLogs).values({
+              tenantId, userId: auth!.userId, action: "ACCESS_APPROVED",
+              resource: "documents", resourceId: idRow.document.id,
+              metadata: JSON.stringify({ requestId: params.requestId }),
+              ip: clientIp,
+            });
+          } else {
+            const now = new Date();
+            await tx.update(documentAccessRequests)
+              .set({ status: "denied", resolvedBy: auth!.userId, resolvedAt: now })
+              .where(eq(documentAccessRequests.id, params.requestId));
+
+            await notify(tx, {
+              type: "access:rejected",
+              userId: req.requesterId,
+              tenantId,
+              payload: { documentId: idRow.document.id, identifier: params.param, notes: body.notes },
+            });
+
+            await tx.insert(auditLogs).values({
+              tenantId, userId: auth!.userId, action: "ACCESS_DENIED",
+              resource: "documents", resourceId: idRow.document.id,
+              metadata: JSON.stringify({ requestId: params.requestId, notes: body.notes }),
+              ip: clientIp,
+            });
+          }
+
+          const updated = await tx.query.documentAccessRequests.findFirst({
+            where: eq(documentAccessRequests.id, params.requestId),
+          });
+          return { data: updated };
+        } catch (err: any) {
+          console.error("[ACCESS_REQUEST_RESOLVE_ERROR]", err);
+          throw err;
+        }
+      });
+    } catch (err: any) {
+      set.status = 400;
+      return { error: { code: "ACCESS_REQUEST_ERROR", message: safeError(err) } };
+    }
+  }, {
+    params: t.Object({ param: t.String(), requestId: t.String() }),
+    body: t.Object({
+      status: t.Union([t.Literal("approved"), t.Literal("denied")]),
+      notes: t.Optional(t.String()),
+    }),
+    detail: { summary: "Aprovar ou rejeitar pedido de acesso", tags: ["Documentos"] },
+  })
+
+  .post("/:param/access-requests/:requestId/cancel", async ({ tenantId, auth, params, set, clientIp }) => {
+    try {
+      return await withTenant(tenantId, async (tx) => {
+        try {
+          const idRow = await tx.query.identifiers.findFirst({
+            where: and(eq(identifiers.identifier, params.param), eq(identifiers.tenantId, tenantId)),
+            with: { document: true },
+          });
+          if (!idRow?.document) {
+            set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
+          }
+
+          const req = await tx.query.documentAccessRequests.findFirst({
+            where: and(
+              eq(documentAccessRequests.id, params.requestId),
+              eq(documentAccessRequests.documentId, idRow.document.id),
+            ),
+          });
+          if (!req) {
+            set.status = 404; return { error: { code: "NOT_FOUND", message: "Pedido de acesso não encontrado." } };
+          }
+          if (req.requesterId !== auth!.userId) {
+            set.status = 403; return { error: { code: "FORBIDDEN", message: "Apenas o requerente pode cancelar o próprio pedido." } };
+          }
+          if (req.status !== "pending") {
+            set.status = 400; return { error: { code: "ALREADY_RESOLVED", message: "Pedido já foi resolvido." } };
+          }
+
+          const [updated] = await tx.update(documentAccessRequests)
+            .set({ status: "cancelled" })
+            .where(eq(documentAccessRequests.id, params.requestId))
+            .returning();
+
+          await tx.insert(auditLogs).values({
+            tenantId, userId: auth!.userId, action: "CANCEL_ACCESS_REQUEST",
+            resource: "documents", resourceId: idRow.document.id,
+            metadata: JSON.stringify({ requestId: params.requestId }),
+            ip: clientIp,
+          });
+
+          return { data: updated };
+        } catch (err: any) {
+          console.error("[CANCEL_ACCESS_REQUEST_ERROR]", err);
+          throw err;
+        }
+      });
+    } catch (err: any) {
+      set.status = 400;
+      return { error: { code: "CANCEL_REQUEST_ERROR", message: safeError(err) } };
+    }
+  }, {
+    params: t.Object({ param: t.String(), requestId: t.String() }),
+    detail: { summary: "Cancelar próprio pedido de acesso", tags: ["Documentos"] },
+  })
+
   .patch("/:param/shares/:shareId/revoke", async ({ tenantId, auth, params, set, clientIp }) => {
     try {
       return await withTenant(tenantId, async (tx) => {
@@ -569,18 +772,24 @@ export const documentsModule = new Elysia({ prefix: "/documents" })
           if (!idRow?.document) {
             set.status = 404; return { error: { code: "NOT_FOUND", message: "Documento não encontrado." } };
           }
-          if (!(await canShareDocument(tx, auth!, idRow.sectorId, idRow.document.uploadedBy))) {
+                    if (!(await canShareDocument(tx, auth!, idRow.sectorId, idRow.document.uploadedBy))) {
             set.status = 403; return { error: { code: "FORBIDDEN", message: "Não tem permissão para revogar partilhas." } };
           }
+
+          const existingShare = await tx.query.documentShares.findFirst({
+            where: and(eq(documentShares.id, params.shareId), eq(documentShares.documentId, idRow.document.id)),
+          });
+          if (!existingShare || existingShare.revokedAt) {
+            set.status = 404; return { error: { code: "NOT_FOUND", message: "Partilha não encontrada ou já revogada." } };
+          }
+          if (existingShare.sourceRequestId) {
+            set.status = 403; return { error: { code: "CANNOT_REVOKE", message: "Acesso concedido por pedido de acesso não pode ser revogado." } };
+          }
+
           const [share] = await tx.update(documentShares)
             .set({ revokedAt: new Date() })
-            .where(and(
-              eq(documentShares.id, params.shareId),
-              eq(documentShares.documentId, idRow.document.id),
-              isNull(documentShares.revokedAt),
-            ))
+            .where(eq(documentShares.id, params.shareId))
             .returning();
-          if (!share) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Partilha não encontrada ou já revogada." } }; }
 
           if (share.sharedWithUserId) {
             await notify(tx, {
diff --git a/apps/api/src/modules/sectors.module.ts b/apps/api/src/modules/sectors.module.ts
index 6b2247c..52aa3dc 100644
--- a/apps/api/src/modules/sectors.module.ts
+++ b/apps/api/src/modules/sectors.module.ts
@@ -2,7 +2,7 @@ import { Elysia, t } from "elysia";
 import { db } from "../db";
 import { sectors, users } from "../db/schema";
 import { eq, and, sql } from "drizzle-orm";
-import { requireAuth, requireRole } from "../middleware/auth";
+import { requireAuth, requireRole, requireSectorScope, getFreshRoles } from "../middleware/auth";
 import { withTenant } from "../db/withTenant";
 import { safeError } from "../lib/errors";
 
@@ -42,8 +42,14 @@ export const sectorsModule = new Elysia({ prefix: "/sectors" })
     detail: { summary: "Detalhe do sector", tags: ["Sectores"] },
   })
 
-  .get("/:id/members", async ({ params, tenantId }) => {
+  .use(requireSectorScope({ bypassRoles: ["ORG_ADMIN"] }))
+  .get("/:id/members", async ({ params, tenantId, sectorScopeId, auth, set }) => {
     return withTenant(tenantId, async (tx) => {
+      const roleNames = await getFreshRoles(auth!.userId, tenantId);
+      if (!roleNames.includes("ORG_ADMIN") && sectorScopeId !== params.id) {
+        set.status = 403;
+        return { error: { code: "FORBIDDEN", message: "Só pode ver membros do seu próprio sector." } };
+      }
       const members = await tx.query.users.findMany({
         where: and(eq(users.tenantId, tenantId), eq(users.sectorId, params.id)),
         columns: { passwordHash: false },
diff --git a/apps/api/src/modules/stats.module.ts b/apps/api/src/modules/stats.module.ts
index 30cc942..1917419 100644
--- a/apps/api/src/modules/stats.module.ts
+++ b/apps/api/src/modules/stats.module.ts
@@ -1,48 +1,73 @@
 import { Elysia, t } from "elysia";
 import { db } from "../db";
-import { identifiers, documents, auditLogs, categories } from "../db/schema";
-import { eq, and, sql } from "drizzle-orm";
-import { requireAuth, requireRole } from "../middleware/auth";
+import { identifiers, documents, auditLogs, categories, users } from "../db/schema";
+import { eq, and, sql, isNotNull } from "drizzle-orm";
+import { requireAuth, getFreshRoles } from "../middleware/auth";
 import { checkRateLimit } from "../middleware/rateLimit";
 import { withTenant } from "../db/withTenant";
 import { safeError } from "../lib/errors";
 
-async function collectStats(tenantId: string) {
+async function collectStats(tenantId: string, sectorId?: string) {
   return withTenant(tenantId, async (tx) => {
+    const idConditions = [eq(identifiers.tenantId, tenantId)];
+    if (sectorId) idConditions.push(eq(identifiers.sectorId, sectorId));
+    const idWhere = and(...idConditions);
+
     const [totalIds] = await tx
       .select({ total: sql`COUNT(*)` })
       .from(identifiers)
-      .where(eq(identifiers.tenantId, tenantId));
+      .where(idWhere);
 
     const byStatus = await tx
       .select({ status: identifiers.status, cnt: sql`COUNT(*)` })
       .from(identifiers)
-      .where(eq(identifiers.tenantId, tenantId))
+      .where(idWhere)
       .groupBy(identifiers.status);
 
     const byCategory = await tx
       .select({ category: categories.name, cnt: sql<number>`COUNT(${identifiers.id})` })
       .from(identifiers)
       .innerJoin(categories, eq(categories.id, identifiers.categoryId))
-      .where(eq(identifiers.tenantId, tenantId))
+      .where(idWhere)
       .groupBy(categories.name)
       .orderBy(sql`count DESC`)
       .limit(10);
 
-    const [totalDocs] = await tx
-      .select({ total: sql`COUNT(*)` })
-      .from(documents)
-      .where(eq(documents.tenantId, tenantId));
+    let totalDocs: { total: number } = { total: 0 };
+    let failedAttach: { total: number } = { total: 0 };
+    if (sectorId) {
+      const [docs] = await tx
+        .select({ total: sql<number>`COUNT(DISTINCT ${documents.id})` })
+        .from(documents)
+        .innerJoin(identifiers, eq(documents.identifierId, identifiers.id))
+        .where(and(eq(identifiers.sectorId, sectorId), eq(identifiers.tenantId, tenantId)));
+      totalDocs = docs;
 
-    const [failedAttach] = await tx
-      .select({ total: sql`COUNT(*)` })
-      .from(auditLogs)
-      .where(
-        and(
+      const [audit] = await tx
+        .select({ total: sql<number>`COUNT(*)` })
+        .from(auditLogs)
+        .innerJoin(documents, sql`${auditLogs.resourceId} = ${documents.id}::text`)
+        .innerJoin(identifiers, eq(documents.identifierId, identifiers.id))
+        .where(and(
           eq(auditLogs.tenantId, tenantId),
-          eq(auditLogs.action, "ATTACH_FAILED")
-        )
-      );
+          eq(auditLogs.action, "ATTACH_FAILED"),
+          eq(identifiers.sectorId, sectorId),
+          eq(identifiers.tenantId, tenantId),
+        ));
+      failedAttach = audit;
+    } else {
+      const [docs] = await tx
+        .select({ total: sql<number>`COUNT(*)` })
+        .from(documents)
+        .where(eq(documents.tenantId, tenantId));
+      totalDocs = docs;
+
+      const [audit] = await tx
+        .select({ total: sql<number>`COUNT(*)` })
+        .from(auditLogs)
+        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, "ATTACH_FAILED")));
+      failedAttach = audit;
+    }
 
     return {
       identifiers: {
@@ -61,15 +86,28 @@ async function collectStats(tenantId: string) {
 export const statsModule = new Elysia({ prefix: "/stats" })
   .use(requireAuth())
 
-  .get("/", async ({ tenantId }) => {
+  .get("/", async ({ tenantId, auth }) => {
     try {
-      const data = await collectStats(tenantId);
-      return { data };
+      const roleNames = await getFreshRoles(auth!.userId, tenantId);
+      let sectorId: string | undefined;
+      if (!roleNames.includes("ORG_ADMIN")) {
+        const me = await withTenant(tenantId, async (tx) => {
+          const u = await tx.query.users.findFirst({
+            where: eq(users.id, auth!.userId),
+            columns: { sectorId: true },
+          });
+          return u?.sectorId;
+        });
+        if (!me) return { data: { identifiers: { total: 0, byStatus: {}, byCategory: [] }, documents: { total: 0, verificationFailures: 0 } } };
+        sectorId = me;
+      }
+      const stats = await collectStats(tenantId, sectorId);
+      return { data: stats };
     } catch (err: any) {
       return { error: { code: "STATS_ERROR", message: safeError(err) } };
     }
   }, {
-    detail: { summary: "Estatísticas do tenant", tags: ["Estatísticas"] },
+    detail: { summary: "Estatísticas (filtradas por sector conforme role)", tags: ["Estatísticas"] },
   })
 
   .get("/export", async ({ query, tenantId, set, request }) => {
diff --git a/apps/api/src/modules/users.module.ts b/apps/api/src/modules/users.module.ts
index e92cc6a..266c0dd 100644
--- a/apps/api/src/modules/users.module.ts
+++ b/apps/api/src/modules/users.module.ts
@@ -1,17 +1,29 @@
 import { Elysia, t } from "elysia";
 import { users, userRoles, sectors, roles } from "../db/schema";
 import { eq, and } from "drizzle-orm";
-import { requireAuth, requireRole } from "../middleware/auth";
+import { requireAuth, getFreshRoles } from "../middleware/auth";
 import { withTenant } from "../db/withTenant";
 import { safeError } from "../lib/errors";
 
 export const usersModule = new Elysia({ prefix: "/users" })
   .use(requireAuth())
 
-  .get("/", async ({ tenantId, query }) => {
+  .get("/", async ({ tenantId, auth, query }) => {
     return withTenant(tenantId, async (tx) => {
+      const roleNames = await getFreshRoles(auth!.userId, tenantId);
+      const isAdmin = roleNames.includes("ORG_ADMIN");
+
       const conditions = [eq(users.tenantId, tenantId)];
-      if (query.sectorId) conditions.push(eq(users.sectorId, query.sectorId));
+      if (isAdmin) {
+        if (query.sectorId) conditions.push(eq(users.sectorId, query.sectorId));
+      } else {
+        const me = await tx.query.users.findFirst({
+          where: eq(users.id, auth!.userId),
+          columns: { sectorId: true },
+        });
+        if (!me?.sectorId) return { data: [], meta: { total: 0, page: 1, limit: 20 } };
+        conditions.push(eq(users.sectorId, me.sectorId));
+      }
       const rows = await tx.query.users.findMany({
         where: and(...conditions),
         with: { sector: true, userRoles: { with: { role: true } } },
@@ -55,23 +67,54 @@ export const usersModule = new Elysia({ prefix: "/users" })
     detail: { summary: "Detalhe do utilizador", tags: ["Utilizadores"] },
   })
 
-  .use(requireRole("ORG_ADMIN"))
-  .post("/", async ({ tenantId, body, set }) => {
+  .post("/", async ({ tenantId, auth, body, set }) => {
     try {
       return await withTenant(tenantId, async (tx) => {
         try {
-          const sector = body.sectorId ? await tx.query.sectors.findFirst({
-            where: eq(sectors.id, body.sectorId),
+          const roleNames = await getFreshRoles(auth!.userId, auth!.tenantId);
+          const isAdmin = roleNames.includes("ORG_ADMIN");
+          const isSupervisor = roleNames.includes("SECTOR_SUPERVISOR");
+          if (!isAdmin && !isSupervisor) {
+            set.status = 403; return { error: { code: "FORBIDDEN", message: "Sem permissão para criar utilizadores." } };
+          }
+
+          let sectorId = body.sectorId;
+          if (isSupervisor && !isAdmin) {
+            const supervisorUser = await tx.query.users.findFirst({
+              where: eq(users.id, auth!.userId),
+              columns: { sectorId: true },
+            });
+            if (!supervisorUser?.sectorId) {
+              set.status = 422; return { error: { code: "NO_SECTOR", message: "Supervisor não tem sector atribuído." } };
+            }
+            sectorId = supervisorUser.sectorId;
+          }
+
+          const sector = sectorId ? await tx.query.sectors.findFirst({
+            where: eq(sectors.id, sectorId),
             columns: { tenantId: true },
           }) : null;
-          if (body.sectorId && (!sector || sector.tenantId !== tenantId)) {
+          if (sectorId && (!sector || sector.tenantId !== tenantId)) {
             set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
           }
+
           const passwordHash = await Bun.password.hash(body.password);
           const [user] = await tx.insert(users).values({
-            tenantId, sectorId: body.sectorId,
+            tenantId, sectorId,
             email: body.email, passwordHash, fullName: body.fullName,
           }).returning();
+
+          if (isSupervisor && !isAdmin) {
+            const memberRole = await tx.query.roles.findFirst({
+              where: and(eq(roles.name, "MEMBER"), eq(roles.tenantId, tenantId)),
+            });
+            if (memberRole) {
+              await tx.insert(userRoles).values({
+                userId: user.id, roleId: memberRole.id, grantedBy: auth!.userId,
+              });
+            }
+          }
+
           const { passwordHash: _, ...safeUser } = user;
           return { data: safeUser };
         } catch (err: any) {
@@ -88,92 +131,42 @@ export const usersModule = new Elysia({ prefix: "/users" })
     detail: { summary: "Criar utilizador", tags: ["Utilizadores"] },
   })
 
-  .patch("/:id", async ({ tenantId, params, body, set }) => {
-    try {
-      return await withTenant(tenantId, async (tx) => {
-        try {
-          const [user] = await tx.update(users).set({ fullName: body.fullName, email: body.email })
-            .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId))).returning();
-          const { passwordHash: _, ...safeUser } = user;
-          return { data: safeUser };
-        } catch (err: any) {
-          console.error("[UPDATE_USER_ERROR]", err);
-          throw err;
-        }
-      });
-    } catch (err: any) {
-      set.status = 400;
-      return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
-    }
-  }, {
-    params: t.Object({ id: t.String() }),
-    body: t.Object({ fullName: t.Optional(t.String()), email: t.Optional(t.String({ format: "email" })) }),
-    detail: { summary: "Editar utilizador", tags: ["Utilizadores"] },
-  })
-
-  .patch("/:id/sector", async ({ tenantId, params, body, set }) => {
-    try {
-      return await withTenant(tenantId, async (tx) => {
-        try {
-          const sector = await tx.query.sectors.findFirst({
-            where: eq(sectors.id, body.sectorId),
-            columns: { tenantId: true },
-          });
-          if (!sector || sector.tenantId !== tenantId) {
-            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
+  .guard({
+    beforeHandle: async ({ auth, set }: any) => {
+      if (!auth) { set.status = 401; return { error: { code: "UNAUTHORIZED", message: "Autenticação necessária." } }; }
+      const roleNames = await getFreshRoles(auth.userId, auth.tenantId);
+      if (!roleNames.includes("ORG_ADMIN")) {
+        set.status = 403; return { error: { code: "FORBIDDEN", message: "Permissão insuficiente." } };
+      }
+    },
+  }, (app: any) => app
+    .patch("/:id", async ({ tenantId, params, body, set }: any) => {
+      try {
+        return await withTenant(tenantId, async (tx) => {
+          try {
+            const [user] = await tx.update(users).set({ fullName: body.fullName, email: body.email })
+              .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId))).returning();
+            const { passwordHash: _, ...safeUser } = user;
+            return { data: safeUser };
+          } catch (err: any) {
+            console.error("[UPDATE_USER_ERROR]", err);
+            throw err;
           }
-          const [user] = await tx.update(users).set({ sectorId: body.sectorId })
-            .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId))).returning();
-          const { passwordHash: _, ...safeUser } = user;
-          return { data: safeUser };
-        } catch (err: any) {
-          console.error("[UPDATE_USER_SECTOR_ERROR]", err);
-          throw err;
-        }
-      });
-    } catch (err: any) {
-      set.status = 400;
-      return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
-    }
-  }, {
-    params: t.Object({ id: t.String() }),
-    body: t.Object({ sectorId: t.String() }),
-    detail: { summary: "Mover utilizador para outro sector", tags: ["Utilizadores"] },
-  })
-
-  .delete("/:id", async ({ tenantId, params, set }) => {
-    try {
-      return await withTenant(tenantId, async (tx) => {
-        try {
-          await tx.update(users).set({ isActive: false })
-            .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId)));
-          return { data: { deleted: true } };
-        } catch (err: any) {
-          console.error("[DELETE_USER_ERROR]", err);
-          throw err;
-        }
-      });
-    } catch (err: any) {
-      set.status = 400;
-      return { error: { code: "DELETE_ERROR", message: safeError(err) } };
-    }
-  }, {
-    params: t.Object({ id: t.String() }),
-    detail: { summary: "Desactivar utilizador", tags: ["Utilizadores"] },
-  })
+        });
+      } catch (err: any) {
+        set.status = 400;
+        return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
+      }
+    }, {
+      params: t.Object({ id: t.String() }),
+      body: t.Object({ fullName: t.Optional(t.String()), email: t.Optional(t.String({ format: "email" })) }),
+      detail: { summary: "Editar utilizador", tags: ["Utilizadores"] },
+    })
 
-  .post("/:id/roles", async ({ tenantId, auth, params, body, set }) => {
-    try {
-      return await withTenant(tenantId, async (tx) => {
-        try {
-          const role = await tx.query.roles.findFirst({
-            where: eq(roles.id, body.roleId),
-            columns: { tenantId: true },
-          });
-          if (!role || (role.tenantId !== null && role.tenantId !== tenantId)) {
-            set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Role não encontrado." } };
-          }
-          if (body.sectorId) {
+    .patch("/:id/sector", async ({ tenantId, params, body, set }: any) => {
+      try {
+        return await withTenant(tenantId, async (tx) => {
+          try {
             const sector = await tx.query.sectors.findFirst({
               where: eq(sectors.id, body.sectorId),
               columns: { tenantId: true },
@@ -181,27 +174,86 @@ export const usersModule = new Elysia({ prefix: "/users" })
             if (!sector || sector.tenantId !== tenantId) {
               set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
             }
+            const [user] = await tx.update(users).set({ sectorId: body.sectorId })
+              .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId))).returning();
+            const { passwordHash: _, ...safeUser } = user;
+            return { data: safeUser };
+          } catch (err: any) {
+            console.error("[UPDATE_USER_SECTOR_ERROR]", err);
+            throw err;
           }
-          const [ur] = await tx.insert(userRoles).values({
-            userId: params.id, roleId: body.roleId, sectorId: body.sectorId, grantedBy: auth!.userId,
-          }).returning();
-          return { data: ur };
-        } catch (err: any) {
-          console.error("[ASSIGN_ROLE_ERROR]", err);
-          throw err;
-        }
-      });
-    } catch (err: any) {
-      set.status = 400;
-      return { error: { code: "ROLE_ERROR", message: safeError(err) } };
-    }
-  }, {
-    params: t.Object({ id: t.String() }),
-    body: t.Object({ roleId: t.String(), sectorId: t.Optional(t.String()) }),
-    detail: { summary: "Atribuir role a utilizador", tags: ["Utilizadores"] },
-  })
+        });
+      } catch (err: any) {
+        set.status = 400;
+        return { error: { code: "UPDATE_ERROR", message: safeError(err) } };
+      }
+    }, {
+      params: t.Object({ id: t.String() }),
+      body: t.Object({ sectorId: t.String() }),
+      detail: { summary: "Mover utilizador para outro sector", tags: ["Utilizadores"] },
+    })
+
+    .delete("/:id", async ({ tenantId, params, set }: any) => {
+      try {
+        return await withTenant(tenantId, async (tx) => {
+          try {
+            await tx.update(users).set({ isActive: false })
+              .where(and(eq(users.id, params.id), eq(users.tenantId, tenantId)));
+            return { data: { deleted: true } };
+          } catch (err: any) {
+            console.error("[DELETE_USER_ERROR]", err);
+            throw err;
+          }
+        });
+      } catch (err: any) {
+        set.status = 400;
+        return { error: { code: "DELETE_ERROR", message: safeError(err) } };
+      }
+    }, {
+      params: t.Object({ id: t.String() }),
+      detail: { summary: "Desactivar utilizador", tags: ["Utilizadores"] },
+    })
+
+    .post("/:id/roles", async ({ tenantId, auth, params, body, set }: any) => {
+      try {
+        return await withTenant(tenantId, async (tx) => {
+          try {
+            const role = await tx.query.roles.findFirst({
+              where: eq(roles.id, body.roleId),
+              columns: { tenantId: true },
+            });
+            if (!role || (role.tenantId !== null && role.tenantId !== tenantId)) {
+              set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Role não encontrado." } };
+            }
+            if (body.sectorId) {
+              const sector = await tx.query.sectors.findFirst({
+                where: eq(sectors.id, body.sectorId),
+                columns: { tenantId: true },
+              });
+              if (!sector || sector.tenantId !== tenantId) {
+                set.status = 400; return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } };
+              }
+            }
+            const [ur] = await tx.insert(userRoles).values({
+              userId: params.id, roleId: body.roleId, sectorId: body.sectorId, grantedBy: auth!.userId,
+            }).returning();
+            return { data: ur };
+          } catch (err: any) {
+            console.error("[ASSIGN_ROLE_ERROR]", err);
+            throw err;
+          }
+        });
+      } catch (err: any) {
+        set.status = 400;
+        return { error: { code: "ROLE_ERROR", message: safeError(err) } };
+      }
+    }, {
+      params: t.Object({ id: t.String() }),
+      body: t.Object({ roleId: t.String(), sectorId: t.Optional(t.String()) }),
+      detail: { summary: "Atribuir role a utilizador", tags: ["Utilizadores"] },
+    })
 
-  .delete("/:id/roles/:roleId", async ({ tenantId, params, set }) => {
+    .delete("/:id/roles/:roleId", async ({ tenantId, params, set }: any) => {
     try {
       return await withTenant(tenantId, async (tx) => {
         try {
@@ -219,4 +271,4 @@ export const usersModule = new Elysia({ prefix: "/users" })
   }, {
     params: t.Object({ id: t.String(), roleId: t.String() }),
     detail: { summary: "Remover role de utilizador", tags: ["Utilizadores"] },
-  });
+  }));
