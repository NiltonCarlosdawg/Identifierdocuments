#!/bin/bash
# Deploy da API no servidor (cPanel/CloudLinux). Chamado pelo workflow "Deploy DocID"
# depois de extrair api.tgz para $NEW. Passos:
#   1. recusa se as dependências mudaram (o node_modules do servidor é instalado à mão);
#   2. guarda o código actual (dist, src, package.json) para poder voltar atrás;
#   3. instala o código novo e aplica as migrações pendentes (scripts/apply-migrations.mjs);
#   4. reinicia a API e espera pelo /health; se falhar, repõe o código antigo e reinicia-o.
# As migrações não são revertidas: têm de ser compatíveis com o código anterior.
# Nunca lê o docid-api.log inteiro: a conta tem limite de I/O e um grep nele pendura a API.
set -euo pipefail

APP=${DEPLOY_APP_DIR:-/mnt/homer2/milvendas/didall.milvendas.ao}
NEW=${1:?uso: deploy-server.sh <pasta com o api.tgz extraído>}
cd "$APP"
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
export NODE_ENV=production
set -a && . ./.env && set +a
PORT=${PORT:-3000}
PIDFILE=docid-api.pid

log() { printf '[deploy] %s\n' "$*"; }
healthy() { curl -fs -m 5 -o /dev/null "http://127.0.0.1:$PORT/health"; }

deps() { node -e 'console.log(JSON.stringify(require(process.argv[1]).dependencies))' "$1"; }
if [ "$(deps "$NEW/package.json")" != "$(deps "$APP/package.json")" ]; then
  log "as dependências do package.json mudaram: instale-as no servidor antes do deploy. Nada foi alterado."
  exit 1
fi

# O watchdog (run.sh, cron + supervisor.sh) usa este lock: segurá-lo impede-o de
# reiniciar a API a meio do deploy. Espera até 3 min por uma execução em curso.
exec 9>watchdog.lock
flock -w 180 9 || { log "watchdog ocupado há mais de 3 minutos"; exit 1; }

rm -rf .deploy-prev && mkdir .deploy-prev
cp -a dist src package.json .deploy-prev/

restore() {
  log "a repor o código anterior"
  rm -rf dist src
  cp -a .deploy-prev/dist .deploy-prev/src .
  cp .deploy-prev/package.json package.json
}

stop_api() {
  local pid
  pid=$(cat "$PIDFILE" 2>/dev/null || true)
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || return 0; sleep 1; done
  kill -9 "$pid" 2>/dev/null || true
}

start_api() {
  # Igual ao run.sh: 9>&- para o node não herdar o lock do watchdog.
  setsid nohup node dist/index.js 9>&- >> docid-api.log 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 45); do sleep 2; healthy && return 0; done
  return 1
}

rm -rf src && cp -a "$NEW/src" src
mkdir -p dist scripts
cp "$NEW/dist/index.js" dist/index.js
cp "$NEW/package.json" package.json
cp -a "$NEW/scripts/." scripts/
# Watchdog: substituir por mv (atómico) porque o cron pode estar a executar o run.sh agora.
for f in run.sh supervisor.sh; do
  [ -f "$NEW/$f" ] && cp "$NEW/$f" ".$f.new" && mv ".$f.new" "$f"
done
# Redis antes da API, para o BullMQ (verificação diária das subscrições) ligar à primeira.
bash scripts/redis.sh ensure || log "aviso: Redis não arrancou (a API funciona sem ele, mas sem a verificação diária)"

log "migrações"
if ! node scripts/apply-migrations.mjs; then
  restore
  log "migração falhou: deploy cancelado (a API continua com o código anterior, sem reinício)"
  exit 1
fi

log "a reiniciar a API"
stop_api
if start_api; then
  log "ok: API a responder em /health (pid $(cat "$PIDFILE"))"
  exit 0
fi

log "a API nova não respondeu em 90 s"
stop_api
restore
if start_api; then
  log "código anterior reposto e a responder"
else
  log "o código anterior também não arrancou: o watchdog vai continuar a tentar"
fi
exit 1
