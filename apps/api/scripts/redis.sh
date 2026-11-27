#!/bin/bash
# Redis da DocID API no alojamento partilhado (cPanel/CloudLinux), sem root nem systemd.
#
#   bash scripts/redis.sh ensure   # arranca se não responder (chamado pelo run.sh a cada minuto e pelo deploy)
#   bash scripts/redis.sh status   # PONG ou erro
#   bash scripts/redis.sh stop
#
# Segurança: o servidor é partilhado com outras contas, por isso NÃO abre porta TCP
# (port 0). Só escuta num socket Unix dentro de redis/ (pasta 700, socket 700) e exige
# REDIS_PASSWORD. A API liga-se com REDIS_URL=<caminho absoluto do socket>.
#
# Variáveis (do .env): REDIS_URL (caminho do socket), REDIS_PASSWORD, REDIS_MAXMEMORY (defeito 64mb).
set -u
APP=$(cd "$(dirname "$0")/.." && pwd)
cd "$APP" || exit 1
if [ -z "${REDIS_PASSWORD:-}" ] && [ -f .env ]; then set -a; . ./.env; set +a; fi

SOCK=${REDIS_URL:-}
case "$SOCK" in
  /*) ;;
  *) echo "redis.sh: REDIS_URL não é um socket (${SOCK:-vazio}); nada a fazer"; exit 0 ;;
esac
[ -n "${REDIS_PASSWORD:-}" ] || { echo "redis.sh: falta REDIS_PASSWORD no .env" >&2; exit 1; }

# Limite do Linux para caminhos de socket Unix (sun_path): acima disto o Redis não arranca.
[ "${#SOCK}" -le 100 ] || { echo "redis.sh: caminho do socket demasiado longo (${#SOCK} > 100): $SOCK" >&2; exit 1; }
DIR=$(dirname "$SOCK")
BIN=$(command -v redis-server || echo /usr/bin/redis-server)
CLI=$(command -v redis-cli || echo /usr/bin/redis-cli)
LOG="$APP/docid-api-watchdog.log"

ping() { REDISCLI_AUTH="$REDIS_PASSWORD" "$CLI" -s "$SOCK" ping 2>/dev/null | grep -q PONG; }
log() { printf '%s redis: %s\n' "$(date -Is)" "$*" >> "$LOG"; }

start() {
  mkdir -p "$DIR/data" && chmod 700 "$DIR"
  # Config regenerada a cada arranque a partir do .env (a password não fica no comando, visível no ps).
  umask 077
  cat > "$DIR/redis.conf" <<EOF
port 0
unixsocket $SOCK
unixsocketperm 700
requirepass $REDIS_PASSWORD
daemonize yes
pidfile $DIR/redis.pid
logfile $DIR/redis.log
dir $DIR/data
# BullMQ exige noeviction: sem isto o Redis podia apagar jobs para libertar memória.
maxmemory ${REDIS_MAXMEMORY:-64mb}
maxmemory-policy noeviction
save 900 1
save 300 100
appendonly no
EOF
  rm -f "$SOCK"
  "$BIN" "$DIR/redis.conf"
  for _ in 1 2 3 4 5 6 7 8 9 10; do ping && return 0; sleep 1; done
  return 1
}

case "${1:-ensure}" in
  ensure)
    ping && exit 0
    if [ -f "$DIR/redis.pid" ] && kill -0 "$(cat "$DIR/redis.pid")" 2>/dev/null; then
      log "não responde (pid $(cat "$DIR/redis.pid")) — a reiniciar"
      kill "$(cat "$DIR/redis.pid")" 2>/dev/null; sleep 2
    else
      log "em baixo — a arrancar"
    fi
    if start; then log "ok"; else log "FALHOU a arrancar — ver $DIR/redis.log"; exit 1; fi
    ;;
  status) ping && echo PONG || { echo "sem resposta"; exit 1; } ;;
  stop) [ -f "$DIR/redis.pid" ] && kill "$(cat "$DIR/redis.pid")" 2>/dev/null; echo parado ;;
  *) echo "uso: redis.sh ensure|status|stop" >&2; exit 2 ;;
esac
