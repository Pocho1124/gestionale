# Trascrizione vocale locale (Whisper su CPU): nessun audio esce dal server.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_DISABLE_TELEMETRY=1 HOME=/home/voce HF_HOME=/modelli/.hf
RUN useradd -m -u 10001 voce && mkdir -p /modelli && chown voce:voce /modelli
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY server.py /app/
USER voce
EXPOSE 9000
CMD ["python", "/app/server.py"]
