#!/usr/bin/env bash
# Copia de seguridad diaria de PostgreSQL (conserva 14 días). Úsalo con cron:
#   0 3 * * * /opt/faktu/scripts/backup-db.sh >> /var/log/faktu-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-/var/backups/faktu}"
mkdir -p "$DEST"
FILE="$DEST/faktu-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T postgres \
  pg_dump -U faktu faktu | gzip > "$FILE"
find "$DEST" -name 'faktu-*.sql.gz' -mtime +14 -delete
echo "Backup listo: $FILE ($(du -h "$FILE" | cut -f1))"
