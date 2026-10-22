// Tymczasowa diagnoza: czy Worker w ogóle sięga do silnika przez tunnel i do internetu.
export default {
  async fetch(request: Request, env: { UPSTREAM_URL?: string }): Promise<Response> {
    const out: Record<string, unknown> = {};
    try {
      const r = await fetch("https://example.com", { method: "GET" });
      out.example = { status: r.status };
    } catch (e) {
      out.example = { error: String(e) };
    }
    try {
      const r = await fetch(env.UPSTREAM_URL ?? "https://qdrant-engine.zariszlif.pl/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      const text = (await r.text()).slice(0, 120);
      out.engine = { status: r.status, body: text };
    } catch (e) {
      out.engine = { error: String(e) };
    }
    return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
  },
};
