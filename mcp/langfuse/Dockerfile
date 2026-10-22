# Langfuse MCP — contract gateway (shim) przed upstreamem Langfuse.
#
# Kontekst budowania: katalog mcp/langfuse/ w repo.
#   docker build -t langfuse-basic-shim:4 .
#
# Warstwa MCP: walidacja argumentów (katalog upstream), jednolity format
# wyników, redakcja sekretów, profile uprawnień (read-only / operator-write /
# full), 14 narzędzi gateway (drzewo trace'a, ścieżka krytyczna, anomalie).
# Klucz projektu wstrzykiwany po stronie serwera (Basic), klient nie podaje
# kredencji upstreamu.
FROM langfuse-basic-shim:2

# Oficjalny SDK Langfuse (Python) - wymagany przez runPromptExperiment
# (Experiment Runner: Langfuse.get_dataset / get_prompt / run_experiment).
# 5.0.3 zweryfikowany wobec serwera Langfuse 4.33.0.
RUN pip install --no-cache-dir "langfuse==5.0.3"

COPY mcp_gateway /mcp_gateway
COPY shim.py /shim.py
COPY catalog/langfuse-mcp-catalog.json /langfuse-mcp-catalog.json

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LANGFUSE_MCP_CATALOG=/langfuse-mcp-catalog.json

EXPOSE 8080
CMD ["python", "/shim.py"]
