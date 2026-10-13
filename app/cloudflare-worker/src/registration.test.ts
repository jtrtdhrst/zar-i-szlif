import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  attemptEnrollment,
  flushOutboxAttempt,
  makeD1AccountStore,
  registrationEventId,
  type AccountStore,
  type EligibilityStore,
  type OutboxStore,
  type RegistrationCreatedEvent,
} from "./registration";

function memOutbox(seed: Record<string, string> = {}): OutboxStore & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

/** Atomic store: serialized claim models D1 UNIQUE(sub) insert (exactly one winner). */
function atomicAccounts(seed: Record<string, number> = {}): AccountStore & { rows: Map<string, number> } {
  const rows = new Map(Object.entries(seed).map(([k, v]) => [k, v as number]));
  let tail = Promise.resolve();
  return {
    rows,
    claimNewAccount: (sub, createdAt) =>
      (tail = tail.then(() => {
        const hit = rows.get(sub);
        if (hit !== undefined) return { isNew: false, createdAt: hit };
        rows.set(sub, createdAt);
        return { isNew: true, createdAt };
      })),
  };
}

/** Naive get-then-put WITHOUT atomicity: the old KV pseudo-dedupe. Must double-enroll under race. */
function racyAccounts(): AccountStore & { rows: Map<string, number> } {
  const rows = new Map<string, number>();
  return {
    rows,
    claimNewAccount: async (sub, createdAt) => {
      const hit = rows.get(sub);
      await new Promise((r) => setTimeout(r, 0)); // race window: both readers interleave
      if (hit !== undefined) return { isNew: false, createdAt: hit };
      rows.set(sub, createdAt);
      return { isNew: true, createdAt };
    },
  };
}

function eligibility(grantedSubs: string[] = [], suppressedSubs: string[] = []): EligibilityStore {
  return {
    consentGranted: async (sub) => grantedSubs.includes(sub),
    suppressed: async (sub) => suppressedSubs.includes(sub),
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
    segmentEligible: true,
    ...over,
  };
}

/** Provider-side idempotent sink: same eventId delivered twice has ONE effect. */
function idempotentSink() {
  const effected = new Set<string>();
  return {
    effects: effected,
    deliver: async (e: RegistrationCreatedEvent) => {
      effected.add(e.eventId);
      return true;
    },
  };
}

describe("registration.ts — transactional first-registration proof (KOMAA-790)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it("production defaults off: disabled flag -> 0 enrollments, 0 account rows, 0 outbox writes", async () => {
    const accounts = atomicAccounts();
    const outbox = memOutbox();
    const d = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible({ enabled: false }));
    expect(d).toEqual({ kind: "skip", reason: "disabled" });
    expect(accounts.rows.size).toBe(0);
    expect(outbox.map.size).toBe(0);
  });

  it("fail-closed without cutover, without account store, wrong segment -> 0 each, no claim rows", async () => {
    const noCut = await attemptEnrollment(atomicAccounts(), memOutbox(), eligibility([SUB]), NOW, eligible({ cutoverMs: null }));
    expect(noCut).toEqual({ kind: "skip", reason: "no-cutover" });

    const noStore = await attemptEnrollment(null, memOutbox(), eligibility([SUB]), NOW, eligible());
    expect(noStore).toEqual({ kind: "skip", reason: "no-account-store" });

    const store = atomicAccounts();
    const wrongSeg = await attemptEnrollment(store, memOutbox(), eligibility([SUB]), NOW, eligible({ segmentEligible: false }));
    expect(wrongSeg).toEqual({ kind: "skip", reason: "wrong-segment" });
    expect(store.rows.size).toBe(0); // ineligible login never creates a row
  });

  it("1 eligible fresh signup -> 1 queued with immutable eventId; ack; subsequent login -> 0", async () => {
    const accounts = atomicAccounts();
    const outbox = memOutbox();
    const sink = idempotentSink();
    const d = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible());
    expect(d.kind).toBe("enqueue");
    if (d.kind !== "enqueue") return;
    expect(d.retry).toBe(false);
    expect(d.event.eventId).toBe(registrationEventId(SUB));
    expect(d.event.userId).toBe(SUB);
    expect(d.event.createdAt).toBe(NOW);

    expect(await flushOutboxAttempt(outbox, NOW, d.event, sink.deliver)).toBe("acked");
    expect(sink.effects.size).toBe(1);

    const second = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW + 1000, eligible());
    expect(second).toEqual({ kind: "skip", reason: "already-enrolled" });
  });

  it("pre-cutover account logging in first time since cutover is NOT enrolled", async () => {
    const accounts = atomicAccounts({ [SUB]: CUTOVER - 1 }); // seeded backfill
    const outbox = memOutbox();
    const sink = idempotentSink();
    const d = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible());
    expect(d).toEqual({ kind: "skip", reason: "existing-account" });
    expect(sink.effects.size).toBe(0);
    expect([...outbox.map.keys()].filter((k) => k.startsWith("welcome:outbox:")).length).toBe(0);
  });

  it("simultaneous first-event deliveries from two isolates give exactly 1 enrollment", async () => {
    const accounts = atomicAccounts();
    const outbox = memOutbox();
    const sink = idempotentSink();
    const [a, b] = await Promise.all([
      attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible()),
      attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible()),
    ]);
    expect(a.kind).toBe("enqueue");
    expect(b.kind).toBe("enqueue");
    if (a.kind !== "enqueue" || b.kind !== "enqueue") return;
    const fresh = [a, b].filter((x) => !x.retry);
    expect(fresh).toHaveLength(1); // exactly one atomic-claim winner
    expect(a.event.eventId).toBe(b.event.eventId);

    await flushOutboxAttempt(outbox, NOW, a.event, sink.deliver);
    await flushOutboxAttempt(outbox, NOW, b.event, sink.deliver);
    expect(sink.effects.size).toBe(1); // provider-side idempotency on eventId
    const outboxKeys = [...outbox.map.keys()].filter((k) => k.startsWith("welcome:outbox:"));
    expect(outboxKeys).toHaveLength(1);
    expect(JSON.parse(outbox.map.get(outboxKeys[0])!).status).toBe("acked");
  });

  it("regression: naive get-then-put (old KV pseudo-dedupe) double-enrolls under the same race", async () => {
    const accounts = racyAccounts();
    const outbox = memOutbox();
    const [a, b] = await Promise.all([
      attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible()),
      attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible()),
    ]);
    expect(a.kind).toBe("enqueue");
    expect(b.kind).toBe("enqueue");
    if (a.kind !== "enqueue" || b.kind !== "enqueue") return;
    // Both believe they are first — this is the KOMAA-785 bug the atomic claim fixes.
    expect(a.retry).toBe(false);
    expect(b.retry).toBe(false);
  });

  it("crash before remote API: queued, retry reuses same eventId, one ack, attempts counted", async () => {
    const accounts = atomicAccounts();
    const outbox = memOutbox();
    const sink = idempotentSink();
    const first = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible());
    if (first.kind !== "enqueue") return;

    expect(await flushOutboxAttempt(outbox, NOW, first.event, async () => {
      throw new Error("worker crashed before provider call");
    })).toBe("queued");

    const retry = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW + 5000, eligible());
    expect(retry.kind).toBe("enqueue");
    if (retry.kind !== "enqueue") return;
    expect(retry.retry).toBe(true);
    expect(retry.event.eventId).toBe(first.event.eventId);
    expect(retry.event.createdAt).toBe(first.event.createdAt);

    expect(await flushOutboxAttempt(outbox, NOW + 5000, retry.event, sink.deliver)).toBe("acked");
    expect(sink.effects.size).toBe(1);
    const keys = [...outbox.map.keys()].filter((k) => k.startsWith("welcome:outbox:"));
    expect(keys).toHaveLength(1);
    expect(JSON.parse(outbox.map.get(keys[0])!).attempts).toBe(2);
  });

  it("crash after remote API (ack never persisted): redelivery dedupes to 1 provider effect", async () => {
    const accounts = atomicAccounts();
    const outbox = memOutbox();
    const sink = idempotentSink();
    const first = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW, eligible());
    if (first.kind !== "enqueue") return;

    // Provider received it, worker died before writing ack: effect happened, outbox untouched.
    await sink.deliver(first.event);
    expect(outbox.map.size).toBe(0);

    const retry = await attemptEnrollment(accounts, outbox, eligibility([SUB]), NOW + 5000, eligible());
    if (retry.kind !== "enqueue") return;
    expect(await flushOutboxAttempt(outbox, NOW + 5000, retry.event, sink.deliver)).toBe("acked");
    expect(sink.effects.size).toBe(1); // same eventId -> provider dedupes
  });

  it("consent absent / revoked / suppressed / unverified / missing email -> 0 each, no claim rows", async () => {
    for (const [name, over, granted] of [
      ["no-consent-record", {}, []],
      ["consent-revoked", {}, []],
      ["unverified", { emailVerified: false }, [SUB]],
      ["no-email", { email: "" }, [SUB]],
    ] as const) {
      const store = atomicAccounts();
      const d = await attemptEnrollment(store, memOutbox(), eligibility([...granted]), NOW, eligible(over));
      expect(d.kind, name).toBe("skip");
      expect(store.rows.has(SUB), name).toBe(false);
    }
    const suppressed = atomicAccounts();
    const d = await attemptEnrollment(suppressed, memOutbox(), eligibility([SUB], [SUB]), NOW, eligible());
    expect(d).toEqual({ kind: "skip", reason: "suppressed" });
    expect(suppressed.rows.has(SUB)).toBe(false);
  });

  it("D1 store: single-statement atomic claim honors UNIQUE(sub), seeded old rows lose", async () => {
    const rows = new Map<string, number>([[SUB, CUTOVER - 1]]);
    const db = {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            const hit = rows.get(args[0] as string);
            return hit === undefined ? null : { created_at: hit };
          },
          run: async () => {
            if (!sql.includes("INSERT OR IGNORE")) return { meta: { changes: 0 } };
            if (rows.has(args[0] as string)) return { meta: { changes: 0 } };
            rows.set(args[0] as string, args[1] as number);
            return { meta: { changes: 1 } };
          },
        }),
      }),
    };
    const store = makeD1AccountStore(db as unknown as D1Database);
    expect(await store.claimNewAccount(SUB, NOW)).toEqual({ isNew: false, createdAt: CUTOVER - 1 });
    expect(await store.claimNewAccount("fresh-sub", NOW)).toEqual({ isNew: true, createdAt: NOW });
    expect(await store.claimNewAccount("fresh-sub", NOW + 1)).toEqual({ isNew: false, createdAt: NOW });
  });

  it("logs never contain the full email address or tokens", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
    try {
      const d = await attemptEnrollment(
        atomicAccounts(), memOutbox(), eligibility([SUB]), NOW,
        eligible({ email: "sensitive.person@example.com" }),
      );
      expect(d.kind).toBe("enqueue");
      if (d.kind !== "enqueue") return;
      await flushOutboxAttempt(memOutbox(), NOW, d.event, async () => true);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const blob = logs.join("\n");
    expect(blob).not.toContain("sensitive.person@example.com");
    expect(blob).not.toContain("Bearer");
  });
});
