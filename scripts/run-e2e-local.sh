#!/usr/bin/env bash
# Ejecuta la prueba E2E sin Docker: levanta el mock de documentos y la API
# contra la base indicada en DATABASE_URL (debe ser una base de PRUEBAS).
# Uso: DATABASE_URL=postgres://postgres:postgres@localhost:5432/faktu_e2e scripts/run-e2e-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?Define DATABASE_URL apuntando a una base de pruebas}"
LOG_DIR="${LOG_DIR:-$(mktemp -d)}"
API_PORT="${API_PORT:-4000}"
MOCK_PORT="${MOCK_PORT:-4100}"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT

PORT="$MOCK_PORT" MOCK_DOCUMENT_TOKEN=e2e-token node infra/mock-document-api.mjs > "$LOG_DIR/mock.log" 2>&1 &
MOCK_PID=$!

(
  cd apps/api
  NODE_ENV=test API_PORT="$API_PORT" DB_AUTO_MIGRATE=true JWT_SECRET=e2e-jwt-secret \
  BILLING_PROVIDER=mock DOCUMENT_LOOKUP_PROVIDER=external \
  DOCUMENT_LOOKUP_API_BASE_URL="http://127.0.0.1:$MOCK_PORT" DOCUMENT_LOOKUP_API_TOKEN=e2e-token \
  DOCUMENT_LOOKUP_TIMEOUT_MS=3000 DOCUMENT_LOOKUP_DNI_COST_PEN=0.03 \
  PUBLIC_APP_BASE_URL="http://127.0.0.1:$API_PORT" PUBLIC_RECEIPT_LINK_SECRET=e2e-public-link-secret \
  DELIVERY_PROVIDER=mock RECEIPT_WORKER_ENABLED=false \
  BILLING_ALLOW_SHARED_SANDBOX_TOKEN=true NUBEFACT_API_URL="http://127.0.0.1:$MOCK_PORT/nubefact" NUBEFACT_API_TOKEN=e2e-nubefact-token \
  APISPERU_API_BASE_URL="http://127.0.0.1:$MOCK_PORT/apisperu/" APISPERU_API_TOKEN=e2e-apisperu-token \
  exec ../../node_modules/.bin/tsx src/server.ts
) > "$LOG_DIR/api.log" 2>&1 &
API_PID=$!

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null && curl -sf "http://127.0.0.1:$MOCK_PORT/health" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null; then
  echo "La API no arrancó. Log:" && tail -50 "$LOG_DIR/api.log"
  exit 1
fi

cd apps/api
if ! NODE_ENV=test E2E_API_BASE_URL="http://127.0.0.1:$API_PORT" E2E_MOCK_DOCUMENT_BASE_URL="http://127.0.0.1:$MOCK_PORT" \
  ALLOW_E2E_SEED=true npx tsx src/e2e/fullFlow.ts; then
  echo "--- Log de la API ---" && tail -80 "$LOG_DIR/api.log"
  exit 1
fi
