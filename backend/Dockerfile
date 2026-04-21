FROM python:3.11-slim

# Set work directory
WORKDIR /app

# Install system dependencies (needed for some Python packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (better Docker cache)
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY . .

# Railway sets $PORT env variable — we bind uvicorn to it
ENV PORT=8001
EXPOSE 8001

# Healthcheck (optional but nice)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/ || exit 1

# Start FastAPI with uvicorn
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8001}"]
