#!/usr/bin/env sh
set -eu
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no esta instalado o no esta disponible en PATH."
  exit 1
fi
cleanup() {
  docker compose -f infra/docker-compose.e2e.yml down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose -f infra/docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e
