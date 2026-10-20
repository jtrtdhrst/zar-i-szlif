/** Stub modułu `cloudflare:workers` dla vitest.
 *
 *  Node nie umie wczytać modułów workerd (`cloudflare:workers`), a
 *  `@cloudflare/workers-oauth-provider` importuje z niego `WorkerEntrypoint`.
 *  Testy dotyczą warstwy HTTP, więc wystarczy pusta klasa bazowa.
 */
export class WorkerEntrypoint<Env = unknown> {
  ctx: unknown;
  env: Env;
  constructor(ctx: unknown, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
