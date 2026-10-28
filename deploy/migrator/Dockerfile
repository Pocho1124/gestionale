# Immagine di rilascio per il Pi: contiene migrazioni, test e installer dell'aggiornamento automatico.
FROM postgres:17.6-alpine
COPY deploy/migrator/applica.sh deploy/migrator/test.sh /app/
COPY supabase/migrations /migrations
COPY supabase/tests/database /tests
COPY deploy/pi /deploy
ENTRYPOINT ["sh", "/app/applica.sh", "/migrations"]
