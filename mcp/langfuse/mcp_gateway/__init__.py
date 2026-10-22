"""Langfuse MCP contract gateway.

Warstwa kontraktowá między klientem MCP a upstreamowym serwerem Langfuse:
walidacja argumentow, jednolity format bledow i wynikow, limity rozmiaru
odpowiedzi, redakcja danych wrazliwych oraz narzedzia analityczne wyzszego
poziomu (trace tree, porownania metryk, anomalie, diagnostyka).

Upstream Langfuse (obraz `docker.langfuse.com/langfuse/langfuse:4`) jest kodem
producenta i nie jest modyfikowany - gateway dziala wylacznie jako proxy
JSON-RPC w `opslib/langfuse_mcp_shim.py`.
"""

CONTRACT_VERSION = "1.0.0"
