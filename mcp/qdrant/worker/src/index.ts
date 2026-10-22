/**
 * qdrant MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: mcp-qdrant:8000 (Docker) przez qdrant-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../../worker-edge/src/index.js";

export default createEdgeWorker();
