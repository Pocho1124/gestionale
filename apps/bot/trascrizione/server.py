"""Servizio di trascrizione vocale locale per il bot del gestionale.

POST /trascrivi  (corpo: audio OGG/Opus di Telegram, max 10 MB)  ->  {"testo": "...", "secondi": 2.1, "durata": 4.0}
GET  /salute     ->  {"ok": true, "modello": "small"}
Header facoltativo X-Suggerimento: nomi dei piatti (URL-encoded) per riconoscerli meglio.
"""
import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from faster_whisper import WhisperModel

MODELLO = os.environ.get("MODELLO", "small")
CARTELLA = "/modelli"
MAX_BYTE = 10 * 1024 * 1024
CONTESTO = ("Comandi per il menu di un ristorante italiano: prezzi in euro, piatti, pizze, vini al calice, "
            "esaurito, disponibile, aggiungi, elimina, categoria, descrizione, aumenta, diminuisci, per cento.")


def carica_modello():
    # Prima solo dai file locali: dopo il primo download funziona anche senza internet
    try:
        return WhisperModel(MODELLO, device="cpu", compute_type="int8", download_root=CARTELLA, local_files_only=True)
    except Exception:
        print(f"Modello «{MODELLO}» non presente: lo scarico (serve internet solo la prima volta)...", flush=True)
        return WhisperModel(MODELLO, device="cpu", compute_type="int8", download_root=CARTELLA)


modello = carica_modello()
uno_alla_volta = threading.Lock()   # la CPU è condivisa con il database: una trascrizione per volta
print(f"Trascrizione pronta (modello {MODELLO})", flush=True)


class Gestore(BaseHTTPRequestHandler):
    def _rispondi(self, codice, dati):
        corpo = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        self.send_response(codice)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        if self.path == "/salute":
            return self._rispondi(200, {"ok": True, "modello": MODELLO})
        return self._rispondi(404, {"errore": "percorso sconosciuto"})

    def do_POST(self):
        if self.path != "/trascrivi":
            return self._rispondi(404, {"errore": "percorso sconosciuto"})
        lunghezza = int(self.headers.get("Content-Length") or 0)
        if lunghezza <= 0 or lunghezza > MAX_BYTE:
            return self._rispondi(413, {"errore": "audio vuoto o troppo grande"})
        audio = self.rfile.read(lunghezza)
        suggerimento = unquote(self.headers.get("X-Suggerimento") or "")[:900]
        prompt = f"{CONTESTO} Piatti: {suggerimento}." if suggerimento else CONTESTO
        try:
            with tempfile.NamedTemporaryFile(suffix=".ogg") as f:
                f.write(audio)
                f.flush()
                inizio = time.time()
                with uno_alla_volta:
                    segmenti, info = modello.transcribe(f.name, language="it", beam_size=1,
                                                        vad_filter=True, initial_prompt=prompt)
                    testo = " ".join(s.text.strip() for s in segmenti).strip()
            return self._rispondi(200, {"testo": testo, "secondi": round(time.time() - inizio, 1),
                                        "durata": round(info.duration, 1)})
        except Exception as e:  # audio corrotto o formato non gestito
            return self._rispondi(422, {"errore": f"audio non leggibile: {e.__class__.__name__}"})

    def log_message(self, *args):  # niente audio né testi nei log
        pass


ThreadingHTTPServer(("0.0.0.0", 9000), Gestore).serve_forever()
