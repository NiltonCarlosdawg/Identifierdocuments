-- Planos pagos para os testes E2E (iguais aos de produção a 27/11/2026). Idempotente.
INSERT INTO plans (name, price, max_users, monthly_online_identifiers, offline_budget_per_machine, is_free, active)
SELECT v.name, v.price, v.max_users, v.ids, v.offline, false, true
FROM (VALUES
  ('Essencial', 15000, 3, 100, 50),
  ('Profissional', 49990, 10, 500, 100),
  ('Empresarial', 100000, 30, 2000, 200)
) AS v(name, price, max_users, ids, offline)
WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.name = v.name);
