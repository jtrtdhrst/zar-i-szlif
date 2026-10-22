// Wariant 6: tylko kształt eksportów (named + default), zero logiki.
export function createEdgeWorker() {
  return { fetch: () => new Response("probe6-ok", { headers: { "content-type": "text/plain" } }) };
}
export default createEdgeWorker;
