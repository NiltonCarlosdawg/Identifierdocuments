-- 0030_order_leads.sql
-- Pedidos de quem ainda não tem conta (clientes novos que chegam pelo site). Antes, um pedido
-- exigia uma organização existente e o formulário recusava todos os clientes novos.
-- Um pedido sem organização guarda o nome da empresa e do contacto; a provedora cria a
-- organização quando fechar o negócio. Compatível com o código anterior (que preenche sempre
-- tenant_id). `orders` é uma tabela da plataforma, sem RLS.

ALTER TABLE orders ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_tenant_or_company;
ALTER TABLE orders ADD CONSTRAINT orders_tenant_or_company
  CHECK (tenant_id IS NOT NULL OR company_name IS NOT NULL);
