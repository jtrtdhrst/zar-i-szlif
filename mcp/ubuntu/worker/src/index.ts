/**
 * ubuntu MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: ubuntu-mcp-bridge:8765 (Docker) przez ubuntu-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../worker-edge/src/index.js";

export default createEdgeWorker();
