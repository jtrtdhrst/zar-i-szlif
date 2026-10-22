/**
 * plasmic MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: plasmic-mcp:8091 (Docker) przez plasmic-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../worker-edge/src/index.js";

export default createEdgeWorker();
