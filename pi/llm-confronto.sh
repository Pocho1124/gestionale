#!/bin/bash
# Confronto di velocità tra Ollama e llama.cpp con la stessa richiesta del bot (risposta JSON vincolata).
set -euo pipefail
SCHEMA='{"type":"object","properties":{"azione":{"type":"string","enum":["varia_prezzi","imposta_prezzo","disponibilita","completa_schede_vini","nessuna"]},"prodotto":{"type":"string"},"euro":{"type":"number"}},"required":["azione"]}'
SISTEMA="Sei l'assistente del gestionale di un ristorante. Scegli la funzione che corrisponde alla richiesta e compila i campi."
UTENTE="Piatti: Margherita, Diavola, Tagliere della casa, Aglianico\nRichiesta: porta la diavola a nove euro e cinquanta"
prova() {   # $1 nome, $2 url, $3 corpo
  local inizio fine
  inizio=$(date +%s.%N)
  risposta=$(docker run --rm --network supabase_default curlimages/curl:8.11.1 -s --max-time 120 -H "Content-Type: application/json" -d "$3" "$2")
  fine=$(date +%s.%N)
  printf "%-10s %5.1f s  %s\n" "$1" "$(python3 -c "print($fine - $inizio)")" "$(echo "$risposta" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("message",{}).get("content") or d["choices"][0]["message"]["content"])' 2>/dev/null || echo "errore")"
}
OLLAMA=$(printf '{"model":"qwen2.5:3b","stream":false,"options":{"temperature":0},"format":%s,"messages":[{"role":"system","content":"%s"},{"role":"user","content":"%s"}]}' "$SCHEMA" "$SISTEMA" "$UTENTE")
LLAMA=$(printf '{"temperature":0,"response_format":{"type":"json_schema","json_schema":{"name":"r","strict":true,"schema":%s}},"messages":[{"role":"system","content":"%s"},{"role":"user","content":"%s"}]}' "$SCHEMA" "$SISTEMA" "$UTENTE")
echo "Tre prove per motore (la prima può essere più lenta):"
for i in 1 2 3; do
  prova "Ollama" http://ollama:11434/api/chat "$OLLAMA"
  prova "llama.cpp" http://llm:8080/v1/chat/completions "$LLAMA"
done
