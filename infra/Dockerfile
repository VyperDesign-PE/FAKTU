# Imagen de producción de FAKTU: API + app web (PWA) en un solo servicio.
#
#   docker build -f infra/Dockerfile -t faktu .
#   docker run -p 4000:4000 --env-file apps/api/.env faktu
#
# La app web se sirve en el mismo dominio que la API (sin CORS ni configuración
# extra en el navegador). Las migraciones corren al iniciar salvo que
# DB_AUTO_MIGRATE=false (recomendado ejecutarlas como paso separado del deploy).

FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund
COPY apps/mobile apps/mobile
COPY packages packages
RUN npm --workspace @app/mobile run build:web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=4000 \
    WEB_DIST_DIR=/app/web
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
# Solo las dependencias de la API (no Expo ni React Native).
RUN npm ci --workspace @app/api --no-audit --no-fund && npm cache clean --force
COPY apps/api apps/api
COPY --from=web /app/apps/mobile/dist-web /app/web
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/apps/api
CMD ["../../node_modules/.bin/tsx", "src/server.ts"]
