/**
 * Langfuse MCP — Cloudflare Worker (krawędź wspólna).
 * Silnik: langfuse-basic-shim (Python, contract gateway) w Dockerze,
 * wystawiony przez langfuse-engine.zariszlif.pl.
 */
import { createEdgeWorker } from "../../../worker-edge/src/index.js";

export default createEdgeWorker();
