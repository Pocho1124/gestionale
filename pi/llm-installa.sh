#!/bin/bash
# IA locale con llama.cpp (llama-server), affiancata a Ollama per il confronto. Il bot passa a llama.cpp solo
# quando lo decidi tu (vedi il messaggio finale). Modello: Qwen2.5 3B Instruct, quantizzazione Q4_K_M (ufficiale Qwen).
# Uso:
#   sudo docker run --rm --entrypoint cat ghcr.io/pocho1124/gestionale-migrator:latest /deploy/llm-installa.sh > /tmp/llm-installa.sh && sudo bash /tmp/llm-installa.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Lancia con sudo"; exit 1; }
DIR=/opt/gestionale/llm
MODELLO=qwen2.5-3b-instruct-q4_k_m.gguf
URL=https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/$MODELLO
mkdir -p "$DIR/modelli"

echo "== 1/4 Modello ($MODELLO, circa 2 GB, solo la prima volta)"
if [[ ! -s "$DIR/modelli/$MODELLO" ]]; then
  curl -fL --retry 3 -o "$DIR/modelli/$MODELLO.parziale" "$URL"
  # Il file deve essere un GGUF vero (firma «GGUF») e di dimensione plausibile
  [[ "$(head -c 4 "$DIR/modelli/$MODELLO.parziale")" == "GGUF" ]] || { echo "Il file scaricato non è un modello GGUF"; rm -f "$DIR/modelli/$MODELLO.parziale"; exit 1; }
  (( $(stat -c %s "$DIR/modelli/$MODELLO.parziale") > 1500000000 )) || { echo "Download incompleto"; exit 1; }
  mv "$DIR/modelli/$MODELLO.parziale" "$DIR/modelli/$MODELLO"
fi
sha256sum "$DIR/modelli/$MODELLO" | tee "$DIR/modelli/$MODELLO.sha256"

echo "== 2/4 Immagine di llama.cpp (fissata per impronta digitale)"
docker pull -q ghcr.io/ggml-org/llama.cpp:server >/dev/null
IMMAGINE=$(docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/ggml-org/llama.cpp:server)
echo "$IMMAGINE"

echo "== 3/4 Avvio (un thread per core fisico, rete interna)"
CORE=$(lscpu -p=CORE,SOCKET | grep -v '^#' | sort -u | wc -l)
cat > "$DIR/docker-compose.yml" <<YML
# llama-server: raggiungibile solo dai servizi interni come http://llm:8080 (nessuna porta pubblicata)
name: gestionale-llm
services:
  llm:
    container_name: gestionale-llm
    image: $IMMAGINE
    restart: unless-stopped
    command: ["-m", "/modelli/$MODELLO", "--host", "0.0.0.0", "--port", "8080", "-c", "8192", "-t", "$CORE", "-np", "2"]
    volumes:
      - $DIR/modelli:/modelli:ro
    read_only: true
    mem_limit: 6g
    networks:
      supabase_default:
        aliases: [llm]
networks:
  supabase_default:
    external: true
YML
(cd "$DIR" && docker compose up -d >/dev/null)
printf "Attendo il caricamento del modello"
for i in $(seq 1 60); do
  docker run --rm --network supabase_default curlimages/curl:8.11.1 -sf http://llm:8080/health >/dev/null 2>&1 && { echo " pronto"; break; }
  printf "."; sleep 3
  [[ $i -eq 60 ]] && { echo; docker logs --tail 20 gestionale-llm; exit 1; }
done

echo "== 4/4 Confronto con Ollama: sudo bash /tmp/llm-confronto.sh (vedi messaggio nella chat)"
echo
echo "llama.cpp attivo come http://llm:8080 ($CORE thread). Il bot usa ancora Ollama finché non lo cambi in /opt/gestionale/bot.env:"
echo "  LLM_TIPO=llamacpp"
echo "  LLM_URL=http://llm:8080"
