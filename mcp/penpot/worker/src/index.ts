/**
 * penpot MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: penpot-frontend:8080 (Docker) przez penpot-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../../worker-edge/src/index.js";

export default createEdgeWorker();
