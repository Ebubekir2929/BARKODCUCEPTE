FROM python:3.11-slim

WORKDIR /app

# v21 (2026-09-21) — apt-get adımı KALDIRILDI: tüm bağımlılıklar hazır wheel olarak
# geliyor (derleyici gerekmez). Railway build daemon'unda "No space left on device"
# hatasının kaynağı bu adım + 123 paketlik requirements idi.

# Copy requirements first (better Docker cache)
COPY requirements.txt .

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Railway sets $PORT env variable — we bind uvicorn to it
ENV PORT=8001
# 2026-08 — Railway OOM fix: glibc arena parçalanmasını azalt (RSS şişmesini önler)
ENV MALLOC_ARENA_MAX=2
EXPOSE 8001

# Healthcheck — curl yerine python (imajda curl yok)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request;urllib.request.urlopen('http://localhost:%s/api/' % os.environ.get('PORT','8001'),timeout=8)" || exit 1

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8001}"]
