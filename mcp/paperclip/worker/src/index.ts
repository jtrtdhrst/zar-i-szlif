/**
 * paperclip MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: paperclip:3101 (Docker) przez paperclip-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../worker-edge/src/index.js";

export default createEdgeWorker();
