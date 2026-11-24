#!/bin/bash
# Supervisor de backup do watchdog: enquanto o cron do host não dispara a
# crontab do utilizador, este loop executa run.sh de 60 em 60 segundos.
# Coexiste com o cron sem conflito — run.sh usa flock (watchdog.lock).
# arranque: setsid nohup bash supervisor.sh >> supervisor.log 2>&1 < /dev/null &
cd /mnt/homer2/milvendas/didall.milvendas.ao || exit 1
exec 9>supervisor.lock; flock -n 9 || exit 0
echo "$$" > supervisor.pid
while true; do
  timeout 180 /bin/bash run.sh
  sleep 60
done
