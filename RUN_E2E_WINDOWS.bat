@echo off
setlocal
where docker >nul 2>&1
if errorlevel 1 (
  echo Docker no esta instalado o no esta disponible en PATH.
  echo Instala/inicia Docker Desktop y vuelve a ejecutar este archivo.
  echo.
  pause
  exit /b 1
)

echo Iniciando prueba integral MVP 0.12.2...
docker compose -f infra\docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from e2e
set RESULT=%ERRORLEVEL%

if not "%RESULT%"=="0" (
  echo.
  echo ============================================================
  echo DIAGNOSTICO AUTOMATICO - NO CIERRES ESTA VENTANA
  echo ============================================================
  echo.
  docker compose -f infra\docker-compose.e2e.yml ps -a
  echo.
  echo ----- LOGS mock-document-api -----
  docker compose -f infra\docker-compose.e2e.yml logs --no-color --tail=120 mock-document-api
  echo.
  echo ----- LOGS api -----
  docker compose -f infra\docker-compose.e2e.yml logs --no-color --tail=120 api
  echo.
  echo ----- LOGS e2e -----
  docker compose -f infra\docker-compose.e2e.yml logs --no-color --tail=160 e2e
  echo.
)

echo Limpiando ambiente de prueba...
docker compose -f infra\docker-compose.e2e.yml down -v

if not "%RESULT%"=="0" (
  echo.
  echo PRUEBA E2E: FALLIDA
  echo Haz una captura de esta ventana y enviala para revisar el diagnostico.
  echo.
  pause
  exit /b %RESULT%
)

echo.
echo PRUEBA E2E: APROBADA
echo.
pause
exit /b 0
