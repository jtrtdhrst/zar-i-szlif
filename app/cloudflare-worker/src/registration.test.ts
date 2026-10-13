import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  attemptEnrollment,
  flushOutboxAttempt,
  registrationEventId,
  type ClaimStore,
} from "./registration";

function memStore(seed: Record<string, string> = {}): ClaimStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const CUTOVER = Date.parse("2026-10-13T00:00:00Z");
const NOW = CUTOVER + 60_000;
const SUB = "google-sub-123";

function eligible(over: Record<string, unknown> = {}) {
  return {
    sub: SUB,
    email: "fresh@example.com",
    emailVerified: true,
    enabled: true,
    cutoverMs: CUTOVER,
    ...over,
  };
}

async function grantConsent(store: ClaimStore, sub = SUB) {
  await store.put(`welcome:consent:${sub}`, "granted");
}

describe("registration.ts — registration_created + exactly-once enrollment", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it("production defaults off: disabled flag -> 0 queued, 0 KV writes", async () => {
    const store = memStore();
    const d = await attemptEnrollment(store, NOW, eligible({ enabled: false }));
    expect(d).toEqual({ kind: "skip", reason: "disabled" });
    expect(store.map.size).toBe(0);
  });

  it("fail-closed without cutover -> 0 queued", async () => {
    const store = memStore();
    await grantConsent(store);
    const d = await attemptEnrollment(store, NOW, eligible({ cutoverMs: null }));
    expect(d).toEqual({ kind: "skip", reason: "no-cutover" });
  });

  it("1 eligible fresh signup -> 1 queued with immutable eventId", async () => {
    const store = memStore();
    await grantConsent(store);
    const d = await attemptEnrollment(store, NOW, eligible());
    expect(d.kind).toBe("enqueue");
    if (d.kind !== "enqueue") return;
    expect(d.retry).toBe(false);
    expect(d.event.eventId).toBe(registrationEventId(SUB));
    expect(d.event.userId).toBe(SUB);
    expect(d.event.createdAt).toBe(NOW);
    expect(d.event.consent).toEqual({ marketing: true, source: "kv-consent-record" });

    const out = await flushOutboxAttempt(store, NOW, d.event, async () => true);
    expect(out).toBe("acked");
    expect(store.map.get(`welcome:outbox:${d.event.eventId}`)).toContain('"acked"');
  });

  it("subsequent login after ack -> 0", async () => {
    const store = memStore();
    await grantConsent(store);
    const first = await attemptEnrollment(store, NOW, eligible());
    expect(first.kind).toBe("enqueue");
    if (first.kind !== "enqueue") return;
    await flushOutboxAttempt(store, NOW, first.event, async () => true);

    const second = await attemptEnrollment(store, NOW + 1000, eligible());
    expect(second).toEqual({ kind: "skip", reason: "already-enrolled" });
  });

  it("replay / concurrent first logins converge on the same eventId, one outbox key", async () => {
    const store = memStore();
    await grantConsent(store);
    const [a, b] = await Promise.all([
      attemptEnrollment(store, NOW, eligible()),
      attemptEnrollment(store, NOW, eligible()),
    ]);
    expect(a.kind).toBe("enqueue");
    expect(b.kind).toBe("enqueue");
    if (a.kind !== "enqueue" || b.kind !== "enqueue") return;
    // Same immutable eventId regardless of interleaving -> idempotent effect.
    expect(a.event.eventId).toBe(b.event.eventId);
    const outboxKeys = [...store.map.keys()].filter((k) => k.startsWith("welcome:outbox:"));
    expect(outboxKeys).toHaveLength(0); // outbox written only by flush
    const claimKeys = [...store.map.keys()].filter((k) => k.startsWith("welcome:claim:"));
    expect(claimKeys).toEqual([`welcome:claim:${SUB}`]);
  });

  it("existing account (pre-cutover claim) -> 0, zero retroactive sends", async () => {
    const store = memStore({
      [`welcome:claim:${SUB}`]: JSON.stringify({ eventId: registrationEventId(SUB), createdAt: CUTOVER - 1 }),
    });
    await grantConsent(store);
    const d = await attemptEnrollment(store, NOW, eligible());
    expect(d).toEqual({ kind: "skip", reason: "existing-account" });
  });

  it("wrong consent/suppression/unverified/missing email -> 0 each", async () => {
    for (const [name, over, seed] of [
      ["no-consent-record", {}, {}],
      ["consent-revoked", {}, { [`welcome:consent:${SUB}`]: "revoked" }],
      ["suppressed", {}, { [`welcome:consent:${SUB}`]: "granted", [`welcome:suppress:${SUB}`]: "1" }],
      ["unverified", { emailVerified: false }, { [`welcome:consent:${SUB}`]: "granted" }],
      ["no-email", { email: "" }, { [`welcome:consent:${SUB}`]: "granted" }],
    ] as const) {
      const store = memStore({ ...seed });
      const d = await attemptEnrollment(store, NOW, eligible(over));
      expect(d.kind, name).toBe("skip");
      expect(store.map.has(`welcome:claim:${SUB}`), name).toBe(false);
    }
  });

  it("failure retry reuses the same eventId, no double enrollment", async () => {
    const store = memStore();
    await grantConsent(store);
    const first = await attemptEnrollment(store, NOW, eligible());
    expect(first.kind).toBe("enqueue");
    if (first.kind !== "enqueue") return;

    // Transport fails: outbox stays queued, claim kept.
    expect(await flushOutboxAttempt(store, NOW, first.event, async () => false)).toBe("queued");

    // Next login retries with the SAME eventId (retry: true), not a new enrollment.
    const retry = await attemptEnrollment(store, NOW + 5000, eligible());
    expect(retry.kind).toBe("enqueue");
    if (retry.kind !== "enqueue") return;
    expect(retry.retry).toBe(true);
    expect(retry.event.eventId).toBe(first.event.eventId);
    expect(retry.event.createdAt).toBe(first.event.createdAt);

    // Recovery succeeds: exactly one acked outbox record, attempts counted.
    expect(await flushOutboxAttempt(store, NOW + 5000, retry.event, async () => true)).toBe("acked");
    const outboxKeys = [...store.map.keys()].filter((k) => k.startsWith("welcome:outbox:"));
    expect(outboxKeys).toHaveLength(1);
    expect(JSON.parse(store.map.get(outboxKeys[0])!).attempts).toBe(2);

    // And now subsequent logins are 0.
    expect(await attemptEnrollment(store, NOW + 6000, eligible())).toEqual({
      kind: "skip",
      reason: "already-enrolled",
    });
  });

  it("logs never contain the full email address or tokens", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
    try {
      const store = memStore();
      await grantConsent(store);
      const d = await attemptEnrollment(store, NOW, eligible({ email: "sensitive.person@example.com" }));
      expect(d.kind).toBe("enqueue");
      if (d.kind !== "enqueue") return;
      await flushOutboxAttempt(store, NOW, d.event, async () => true);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const blob = logs.join("\n");
    expect(blob).not.toContain("sensitive.person@example.com");
    expect(blob).not.toContain("Bearer");
  });
});
