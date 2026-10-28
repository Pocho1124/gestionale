# Pacchetto di rilascio: migrazioni + test + backoffice compilato + installer del server.

# 1. Compilazione del backoffice (gira sull'architettura del runner, i file prodotti valgono per tutte)
FROM --platform=$BUILDPLATFORM node:22-slim AS web
WORKDIR /src
COPY tsconfig.base.json /src/
COPY packages/core /src/packages/core
COPY apps/web/package.json apps/web/package-lock.json /src/apps/web/
RUN cd apps/web && npm ci --no-audit --no-fund
COPY apps/web /src/apps/web
RUN cd apps/web && npm run build

# 2. Immagine finale per il server
FROM postgres:17.6-alpine
COPY deploy/migrator/applica.sh deploy/migrator/test.sh /app/
COPY supabase/migrations /migrations
COPY supabase/tests/database /tests
COPY deploy/pi /deploy
COPY --from=web /src/apps/web/dist /web
COPY apps/bot /bot
ENTRYPOINT ["sh", "/app/applica.sh", "/migrations"]
