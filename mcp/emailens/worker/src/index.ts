/**
 * emailens MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: emailens-mcp-bridge:3100 (Docker) przez emailens-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../../worker-edge/src/index.js";

export default createEdgeWorker();
