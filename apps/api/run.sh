#!/bin/bash
# Arranca/repara a DocID API. Corre a cada minuto pelo cron: se estiver morta ou
# pendurada, repõe-na; se estiver bem, sai sem fazer nada.
# crontab: * * * * * /bin/bash /mnt/homer2/milvendas/didall.milvendas.ao/run.sh >/dev/null 2>&1
cd /mnt/homer2/milvendas/didall.milvendas.ao || exit 1
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
export NODE_ENV=production
set -a && . ./.env && set +a
PIDFILE=docid-api.pid
WATCHLOG=docid-api-watchdog.log
PORT=${PORT:-3000}

# evita dois arranques simultâneos se uma execução demorar mais de 1 minuto
exec 9>watchdog.lock; flock -n 9 || exit 0

log() { printf '%s %s\n' "$(date -Is)" "$*" >> "$WATCHLOG"; }
alive() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
healthy() { curl -fs -m 5 -o /dev/null "http://127.0.0.1:$PORT/health"; }

# Rotação do log: acima de 50 MB guarda os últimos 10 MB em docid-api.log.1 e esvazia o
# original no sítio (a API escreve em modo append, por isso continua sem reiniciar).
# Só lê 10 MB: ler o ficheiro inteiro esbarra no limite de I/O do alojamento (CloudLinux).
if [ -f docid-api.log ] && [ "$(stat -c %s docid-api.log)" -gt $((50 * 1024 * 1024)) ]; then
  tail -c $((10 * 1024 * 1024)) docid-api.log > docid-api.log.1 && truncate -s 0 docid-api.log && log "log rodado (últimos 10 MB em docid-api.log.1)"
fi

# Redis (socket privado, ver scripts/redis.sh): repõe-o mesmo com a API saudável,
# senão a verificação diária das subscrições (BullMQ) deixava de correr sem ninguém notar.
[ -f scripts/redis.sh ] && bash scripts/redis.sh ensure >/dev/null 2>&1

if alive && healthy; then exit 0; fi

if alive; then
  sleep 10  # um health lento não chega para matar: segunda leitura antes de decidir
  if healthy; then log "health recuperou sozinho"; exit 0; fi
  log "pendurado (pid $(cat "$PIDFILE")) — a reiniciar"
  kill "$(cat "$PIDFILE")" 2>/dev/null; sleep 3; kill -9 "$(cat "$PIDFILE")" 2>/dev/null
else
  log "em baixo — a arrancar"
fi

# 9>&- fecha o fd do watchdog.lock no filho: sem isto o node herda o lock e
# nenhum watchdog futuro consegue executar run.sh (flock -n falha sempre).
setsid nohup node dist/index.js 9>&- >> docid-api.log 2>&1 < /dev/null &
echo $! > "$PIDFILE"
sleep 15
if healthy; then log "ok (pid $(cat "$PIDFILE"))"; else log "FALHOU a arrancar — ver docid-api.log"; exit 1; fi
