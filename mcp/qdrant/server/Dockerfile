FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FASTEMBED_CACHE_PATH=/app/model_cache \
    NLTK_DATA=/app/nltk_data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && mkdir -p /app/model_cache /app/nltk_data \
    && python -c "import nltk; nltk.download(['punkt_tab', 'stopwords'], download_dir='/app/nltk_data', quiet=True)"

# Bake embedding models into the image (CPU only, no fastembed-gpu).
ARG DENSE_MODEL=BAAI/bge-small-en-v1.5
ARG SPARSE_MODEL=Qdrant/bm25
RUN python -c "from fastembed import TextEmbedding; list(TextEmbedding('${DENSE_MODEL}').embed(['warmup']))" \
    && python -c "from fastembed import SparseTextEmbedding; list(SparseTextEmbedding('${SPARSE_MODEL}').embed(['warmup']))"

COPY server.py .

EXPOSE 8000

CMD ["python", "server.py"]
