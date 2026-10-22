/**
 * supabase MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: supabase-mcp:3100 (Docker) przez supabase-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../../worker-edge/src/index.js";

export default createEdgeWorker();
