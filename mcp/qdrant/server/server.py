"""Hybrid LlamaIndex + Qdrant MCP server.

Dense embeddings via local FastEmbed (default BAAI/bge-small-en-v1.5, CPU),
sparse via FastEmbed BM25 (default Qdrant/bm25). No OpenAI dependency.
Exposes full CRUD over a Qdrant collection as MCP tools (stdio or
streamable-http transport).

Verified against: mcp==2.1.1 (SDK v2, MCPServer), llama-index-core==0.10.68,
llama-index-vector-stores-qdrant==0.1.4, fastembed==0.8.0,
qdrant-client==1.19.0.
"""

import hmac
import logging
import os
import sys
import uuid

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from fastembed import SparseTextEmbedding, TextEmbedding
from llama_index.core import Document, VectorStoreIndex
from llama_index.core.embeddings import BaseEmbedding
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.vector_stores.types import VectorStoreQueryMode
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models

logging.basicConfig(stream=sys.stderr, level=logging.INFO)
log = logging.getLogger("mcp-qdrant-hybrid")

# Must match llama-index-vector-stores-qdrant==0.1.4 hybrid collection layout.
DENSE_VECTOR_NAME = "text-dense"
SPARSE_VECTOR_NAME = "text-sparse"

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "hybrid_docs")
DENSE_MODEL = os.getenv("DENSE_MODEL", "BAAI/bge-small-en-v1.5")
SPARSE_MODEL = os.getenv("SPARSE_MODEL", "Qdrant/bm25")
MCP_TRANSPORT = os.getenv("MCP_TRANSPORT", "stdio")
MCP_HOST = os.getenv("MCP_HOST", "0.0.0.0")
MCP_PORT = int(os.getenv("MCP_PORT", "8000"))
# Optional bearer token for the HTTP transport. Required when the server is
# reachable from the internet (the public endpoint is behind the tunnel).
MCP_AUTH_TOKEN = os.getenv("QDRANT_MCP_TOKEN", "").strip()

mcp = MCPServer("qdrant-hybrid")
_index: VectorStoreIndex | None = None
_client: QdrantClient | None = None
_qdrant_error: str | None = None


def _require_qdrant() -> None:
    """Data tools need a reachable Qdrant; fail with a readable message."""
    if _qdrant_error:
        raise ToolError(f"Qdrant is not reachable: {_qdrant_error}")



class FastEmbedDenseEmbedding(BaseEmbedding):
    """Minimal BaseEmbedding wrapper around fastembed TextEmbedding (CPU)."""

    def __init__(self, model_name: str, **kwargs) -> None:
        super().__init__(model_name=model_name, **kwargs)
        # object.__setattr__: works on pydantic v1 and v2 BaseEmbedding alike.
        object.__setattr__(self, "_model", TextEmbedding(model_name=model_name))

    @classmethod
    def class_name(cls) -> str:
        return "FastEmbedDenseEmbedding"

    def _get_text_embedding(self, text: str) -> list[float]:
        return list(self._model.embed([text]))[0].tolist()

    def _get_query_embedding(self, query: str) -> list[float]:
        return list(self._model.embed([query]))[0].tolist()

    async def _aget_query_embedding(self, query: str) -> list[float]:
        return self._get_query_embedding(query)

    async def _aget_text_embedding(self, text: str) -> list[float]:
        return self._get_text_embedding(text)


def _sparse_encode(texts: list[str], model: SparseTextEmbedding):
    embs = list(model.embed(texts))
    return (
        [e.indices.tolist() for e in embs],
        [e.values.tolist() for e in embs],
    )


def _ensure_doc_id_index(client: QdrantClient) -> None:
    """Filter on payload field doc_id needs a keyword index, else Qdrant 400s.

    Without it every get/delete filtered scroll fails with
    'Index required but not found for doc_id', which MCP sanitizes to a bare
    'Error executing tool <name>'. Creating the index is idempotent and
    non-destructive (no data touched).
    """
    try:
        schema = client.get_collection(COLLECTION_NAME).payload_schema or {}
    except Exception:
        log.exception("get payload schema failed")
        raise ToolError("qdrant collection info failed: cannot verify payload index")
    if "doc_id" in schema:
        return
    try:
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="doc_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
        log.info("created payload index doc_id/keyword on %s", COLLECTION_NAME)
    except Exception as exc:
        log.exception("create payload index doc_id failed")
        raise ToolError(
            f"qdrant create index failed for doc_id: {type(exc).__name__}"
        ) from exc


def _validate_doc_id(doc_id: str) -> str:
    if not isinstance(doc_id, str) or not doc_id.strip():
        raise ToolError("doc_id must be a non-empty string (32-hex from insert_document)")
    return doc_id.strip()


def _scroll_by_doc_id(doc_id: str):
    """Filtered scroll; Qdrant failure raises ToolError (distinct from not-found)."""
    try:
        points, _ = _client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="doc_id", match=models.MatchValue(value=doc_id)
                    )
                ]
            ),
            limit=100,
            with_payload=True,
        )
        return points
    except Exception as exc:
        # Never log client repr (may carry URL/key); class name is enough.
        log.exception("qdrant scroll failed doc_id=%s: %s", doc_id, type(exc).__name__)
        raise ToolError(
            f"qdrant lookup failed for doc_id={doc_id!r}: {type(exc).__name__}"
        ) from exc


def startup() -> VectorStoreIndex:
    """Connect to Qdrant, ensure the hybrid collection, build the index."""
    try:
        client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)
        client.get_collections()  # fail fast with a clear error
    except Exception as exc:
        raise SystemExit(
            f"ERROR: cannot reach Qdrant at {QDRANT_URL}: {exc}\n"
            "Check QDRANT_URL / QDRANT_API_KEY and that Qdrant is running."
        )

    dense = FastEmbedDenseEmbedding(DENSE_MODEL)
    sparse = SparseTextEmbedding(SPARSE_MODEL)
    dim = len(dense._get_text_embedding("dimension probe"))
    log.info("dense=%s dim=%d sparse=%s", DENSE_MODEL, dim, SPARSE_MODEL)

    if not client.collection_exists(COLLECTION_NAME):
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config={
                DENSE_VECTOR_NAME: models.VectorParams(
                    size=dim, distance=models.Distance.COSINE
                )
            },
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: models.SparseVectorParams(
                    index=models.SparseIndexParams(),
                    modifier=models.Modifier.IDF,
                )
            },
        )
        log.info("created collection %s", COLLECTION_NAME)
    else:
        info = client.get_collection(COLLECTION_NAME)
        names = set((info.config.params.vectors or {}).keys())
        sparse_names = set((info.config.params.sparse_vectors or {}).keys())
        if DENSE_VECTOR_NAME not in names or SPARSE_VECTOR_NAME not in sparse_names:
            raise SystemExit(
                f"ERROR: collection {COLLECTION_NAME!r} exists but lacks "
                f"hybrid vectors {DENSE_VECTOR_NAME!r}/{SPARSE_VECTOR_NAME!r} "
                f"(has dense={sorted(names)} sparse={sorted(sparse_names)}). "
                "Point COLLECTION_NAME at an empty name or delete it first."
            )

    store = QdrantVectorStore(
        collection_name=COLLECTION_NAME,
        client=client,
        enable_hybrid=True,
        sparse_doc_fn=lambda texts: _sparse_encode(texts, sparse),
        sparse_query_fn=lambda texts: _sparse_encode(texts, sparse),
    )
    _ensure_doc_id_index(client)
    index = VectorStoreIndex.from_vector_store(store, embed_model=dense)
    globals()["_client"] = client
    return index


@mcp.tool()
def query(text: str, top_k: int = 5) -> list[dict]:
    _require_qdrant()
    """Hybrid dense+sparse search. Returns [{doc_id, node_id, score, text, metadata}]."""
    retriever = _index.as_retriever(
        similarity_top_k=top_k,
        vector_store_query_mode=VectorStoreQueryMode.HYBRID,
        sparse_top_k=top_k,
    )
    try:
        nodes = retriever.retrieve(text)
    except ValueError as exc:
        if str(exc) != "Vector store query result should return at least one of nodes or ids.":
            raise
        if _client.count(collection_name=COLLECTION_NAME, exact=True).count == 0:
            return []
        raise
    out = []
    for n in nodes:
        out.append(
            {
                "doc_id": n.node.ref_doc_id,
                "node_id": n.node.node_id,
                "score": n.score,
                "text": n.node.get_content(),
                "metadata": dict(n.node.metadata),
            }
        )
    return out


@mcp.tool()
def insert_document(text: str, metadata: dict | None = None) -> str:
    _require_qdrant()
    """Insert one document. Returns its doc_id."""
    if not text or not text.strip():
        raise ValueError("text must not be empty")
    doc_id = uuid.uuid4().hex
    _index.insert(Document(text=text, metadata=metadata or {}, doc_id=doc_id))
    return doc_id


@mcp.tool()
def insert_documents_bulk(items: list[dict]) -> list[str]:
    _require_qdrant()
    """Insert many documents at once. Each item: {"text": str, "metadata"?: dict}."""
    docs = []
    for i, item in enumerate(items):
        text = (item or {}).get("text", "")
        if not text or not text.strip():
            raise ValueError(f"items[{i}].text must not be empty")
        docs.append(
            Document(
                text=text,
                metadata=(item.get("metadata") or {}),
                doc_id=item.get("doc_id") or uuid.uuid4().hex,
            )
        )
    nodes = SentenceSplitter().get_nodes_from_documents(docs)
    _index.insert_nodes(nodes)
    return [d.doc_id for d in docs]


@mcp.tool()
def delete_document(doc_id: str) -> bool:
    _require_qdrant()
    """Delete a document (all its chunks) by doc_id. Returns True if gone."""
    doc_id = _validate_doc_id(doc_id)
    points = _scroll_by_doc_id(doc_id)
    if not points:
        return False  # already gone; Qdrant failure raises above, so distinct
    try:
        _client.delete(
            collection_name=COLLECTION_NAME,
            points_selector=models.Filter(
                must=[
                    models.FieldCondition(
                        key="doc_id", match=models.MatchValue(value=doc_id)
                    )
                ]
            ),
        )
    except Exception as exc:
        log.exception("qdrant delete failed doc_id=%s: %s", doc_id, type(exc).__name__)
        raise ToolError(
            f"qdrant delete failed for doc_id={doc_id!r}: {type(exc).__name__}"
        ) from exc
    try:
        _index.delete_ref_doc(doc_id, delete_from_docstore=True)
    except Exception:
        log.exception("index cleanup failed doc_id=%s", doc_id)
    return len(_scroll_by_doc_id(doc_id)) == 0


@mcp.tool()
def get_document(doc_id: str) -> dict:
    _require_qdrant()
    """Get full text + metadata of a document by doc_id."""
    doc_id = _validate_doc_id(doc_id)
    points = _scroll_by_doc_id(doc_id)
    if not points:
        raise ToolError(f"document {doc_id!r} not found")
    chunks = []
    for p in points:
        payload = p.payload or {}
        text = payload.get("text")
        if text is None and isinstance(payload.get("_node_content"), str):
            import json

            try:
                text = json.loads(payload["_node_content"]).get("text", "")
            except (ValueError, AttributeError):
                text = ""
        chunks.append(
            {
                "node_id": str(p.id),
                "text": text or "",
                "metadata": {
                    k: v
                    for k, v in payload.items()
                    if not k.startswith("_")
                    and k not in ("doc_id", "document_id", "ref_doc_id")
                },
            }
        )
    first_meta = chunks[0]["metadata"]
    return {
        "doc_id": doc_id,
        "text": "\n".join(c["text"] for c in chunks),
        "metadata": first_meta,
        "num_chunks": len(chunks),
    }


@mcp.tool()
def list_collection_info() -> dict:
    _require_qdrant()
    """Collection stats: point count, dense/sparse vector config, status."""
    info = _client.get_collection(COLLECTION_NAME)
    params = info.config.params
    vectors = {}
    for name, cfg in (params.vectors or {}).items():
        vectors[name] = {"size": cfg.size, "distance": str(cfg.distance)}
    sparse = {}
    for name, cfg in (params.sparse_vectors or {}).items():
        sparse[name] = {"modifier": str(getattr(cfg, "modifier", None))}
    return {
        "name": COLLECTION_NAME,
        "points_count": info.points_count,
        "vectors": vectors,
        "sparse_vectors": sparse,
        "status": str(info.status),
    }


class _BearerAuth:
    """Pure-ASGI bearer gate (no buffering, so SSE responses stream through)."""

    def __init__(self, app, token):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            headers = {k.lower(): v for k, v in (scope.get("headers") or [])}
            raw = headers.get(b"authorization", b"").decode("latin-1")
            supplied = raw[7:] if raw[:7].lower() == "bearer " else ""
            if not supplied or not hmac.compare_digest(supplied, self.token):
                body = b'{"error":"unauthorized"}'
                await send(
                    {
                        "type": "http.response.start",
                        "status": 401,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


def main() -> None:
    if MCP_TRANSPORT not in ("stdio", "streamable-http"):
        raise SystemExit(
            f"ERROR: MCP_TRANSPORT={MCP_TRANSPORT!r} not supported "
            "(use 'stdio' or 'streamable-http')"
        )
    try:
        globals()["_index"] = startup()
    except SystemExit as exc:
        # Qdrant unreachable (e.g. the cloud cluster is down): keep the MCP
        # endpoint alive so tools/list still works, and fail the data tools loudly.
        globals()["_qdrant_error"] = str(exc)
        log.error("%s (server stays up; data tools fail until Qdrant is back)", exc)
    except Exception as exc:
        globals()["_qdrant_error"] = f"ERROR during startup: {exc}"
        log.error("%s (server stays up; data tools fail until Qdrant is back)", exc)
    log.info("serving transport=%s collection=%s", MCP_TRANSPORT, COLLECTION_NAME)
    if MCP_TRANSPORT == "stdio":
        mcp.run(transport="stdio")
    else:
        import uvicorn

        app = mcp.streamable_http_app(
            streamable_http_path="/mcp", stateless_http=True, host=MCP_HOST
        )
        if MCP_AUTH_TOKEN:
            app.add_middleware(_BearerAuth, token=MCP_AUTH_TOKEN)
            log.info("bearer auth enabled")
        uvicorn.run(app, host=MCP_HOST, port=MCP_PORT, log_level="info")


if __name__ == "__main__":
    main()
