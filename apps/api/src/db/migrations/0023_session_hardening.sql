-- Sessões: momento a partir do qual os tokens deste utilizador são aceites na renovação.
-- Mudar ou repor a password actualiza este valor e invalida todas as sessões anteriores.
-- O default now() faz com que todos os utilizadores tenham de entrar de novo uma vez após esta migração.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokens_valid_after" timestamp with time zone DEFAULT now() NOT NULL;
