// registration.ts
// Authoritative `registration_created` event + durable exactly-once welcome enrollment.
// (KOMAA-790: transactional first-registration proof. No mail copy, no production send here.)
//
// Model:
// - The ONLY creation proof is an atomic insert into the account store, keyed by
//   verified Google `sub` with a UNIQUE constraint. The insert winner (isNew)
//   with createdAt at/after REGISTRATION_CUTOVER_ISO emits ONE immutable
//   registration_created event (`reg:{sub}`). Losers enroll nothing.
// - OAuth login, segment joins and KV reads are NEVER creation proof. KV holds
//   only the transport outbox (keyed by immutable eventId), never the claim.
// - Transport is at-least-once with an idempotent effect (same eventId ->
//   same outbox key, same Idempotency-Key header at the provider adapter).
// - Failure never rolls back registration: outbox stays `queued`, the next login
//   retries with the SAME eventId (no double enrollment).
// - Pre-cutover accounts (seeded/imported with createdAt < cutover) that log in
//   for the first time since cutover are NOT new: the insert loses (row exists)
//   and the existing createdAt < cutover -> skip `existing-account`.
//
// Production defaults: WELCOME_ENROLLMENT_ENABLED != "true" -> zero store writes,
// zero requests. REGISTRATION_CUTOVER_ISO unset -> zero enrollments (fail-closed).
// No account store binding (D1 `DB`) -> zero enrollments (fail-closed, `no-account-store`).
// Provider transport lives in the Mautic adapter (KOMAA-786); this module never
// calls Sender.net or any mail API directly.

export interface RegistrationCreatedEvent {
  v: 1;
  /** Immutable registration event ID. One per user, forever. Contains no PII. */
  eventId: string;
  /** Verified Google `sub` — the canonical userId. Never an email. */
  userId: string;
  /** First-seen timestamp (ms epoch) at/after the cutover. */
  createdAt: number;
  emailVerified: boolean;
  consent: { marketing: boolean; source: string };
  suppressed: boolean;
}

export interface RegistrationEnv {
  OAUTH_KV: KVNamespace;
  /** Optional D1 binding. Absent -> enrollment fail-closed, login unaffected. */
  DB?: D1Database;
  WELCOME_ENROLLMENT_ENABLED?: string;
  REGISTRATION_CUTOVER_ISO?: string;
}

export interface RegistrationProps {
  googleSub: string;
  email: string;
  emailVerified: boolean;
}

export type EnrollmentDecision =
  | { kind: "enqueue"; event: RegistrationCreatedEvent; retry: boolean }
  | { kind: "skip"; reason: string };

interface OutboxRecord {
  eventId: string;
  userId: string;
  status: "queued" | "acked";
  attempts: number;
  updatedAt: number;
}

export function registrationEventId(sub: string): string {
  return `reg:${sub.trim()}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const masked = local.length <= 2 ? "**" : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

/**
 * Authoritative account store. The ONLY creation proof.
 * Implementations MUST make `claimNewAccount` atomic: exactly one concurrent
 * caller per sub observes `isNew: true` (SQL UNIQUE(sub) insert, D1 batch
 * transaction, or equivalent). Callers must never implement get-then-put.
 */
export interface AccountStore {
  claimNewAccount(sub: string, createdAt: number): Promise<{ isNew: boolean; createdAt: number }>;
}

/** Minimal key-value surface for the transport outbox only. Cloudflare KV satisfies it. */
export interface OutboxStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

/** Minimal eligibility reads (consent + suppression). Absent record = deny. */
export interface EligibilityStore {
  consentGranted(sub: string): Promise<boolean>;
  suppressed(sub: string): Promise<boolean>;
}

const outboxKey = (eventId: string) => `welcome:outbox:${eventId}`;
const consentKey = (sub: string) => `welcome:consent:${sub}`;
const suppressKey = (sub: string) => `welcome:suppress:${sub}`;

/** D1-backed account store. Requires migration `migrations/0001_accounts.sql`. */
export function makeD1AccountStore(db: D1Database): AccountStore {
  return {
    async claimNewAccount(sub: string, createdAt: number) {
      const existing = await db
        .prepare("SELECT created_at FROM accounts WHERE sub = ?1")
        .bind(sub)
        .first<{ created_at: number }>();
      if (existing) return { isNew: false, createdAt: existing.created_at };
      // Atomic claim: UNIQUE(sub) insert wins exactly once under concurrency.
      // INSERT OR IGNORE + affected-rows check keeps this a single statement.
      const res = await db
        .prepare("INSERT OR IGNORE INTO accounts (sub, created_at) VALUES (?1, ?2)")
        .bind(sub, createdAt)
        .run();
      if ((res.meta.changes ?? 0) === 1) return { isNew: true, createdAt };
      const winner = await db
        .prepare("SELECT created_at FROM accounts WHERE sub = ?1")
        .bind(sub)
        .first<{ created_at: number }>();
      return { isNew: false, createdAt: winner?.created_at ?? createdAt };
    },
  };
}

export async function attemptEnrollment(
  accounts: AccountStore | null,
  outbox: OutboxStore,
  eligibility: EligibilityStore,
  now: number,
  input: {
    sub: string;
    email: string;
    emailVerified: boolean;
    enabled: boolean;
    cutoverMs: number | null;
    /** Onboarding-segment eligibility. False (wrong segment) -> skip, no claim. */
    segmentEligible: boolean;
  },
): Promise<EnrollmentDecision> {
  const logId = maskEmail(input.email);
  if (!input.enabled) return { kind: "skip", reason: "disabled" };
  if (!input.sub.trim() || !input.email) {
    console.error(`registration: missing identity for ${logId}, skipping`);
    return { kind: "skip", reason: "missing-identity" };
  }
  if (!input.emailVerified) return { kind: "skip", reason: "email-unverified" };
  if (input.cutoverMs === null || Number.isNaN(input.cutoverMs)) {
    console.error("registration: REGISTRATION_CUTOVER_ISO unset/invalid, skipping (fail-closed)");
    return { kind: "skip", reason: "no-cutover" };
  }
  if (now < input.cutoverMs) return { kind: "skip", reason: "pre-cutover" };
  if (!input.segmentEligible) return { kind: "skip", reason: "wrong-segment" };
  if (!accounts) {
    console.error("registration: no account store binding, skipping (fail-closed)");
    return { kind: "skip", reason: "no-account-store" };
  }

  const sub = input.sub.trim();
  // Consent/suppression gate runs BEFORE the claim so an ineligible login
  // never creates an account row; absent consent record = deny.
  const [granted, isSuppressed] = await Promise.all([
    eligibility.consentGranted(sub),
    eligibility.suppressed(sub),
  ]);
  if (isSuppressed) return { kind: "skip", reason: "suppressed" };
  if (!granted) return { kind: "skip", reason: "no-consent" };

  // Atomic claim: exactly one concurrent first login per sub wins.
  const claim = await accounts.claimNewAccount(sub, now);
  if (!claim.isNew) {
    if (claim.createdAt < input.cutoverMs) return { kind: "skip", reason: "existing-account" };
    const outboxRaw = await outbox.get(outboxKey(registrationEventId(sub)));
    const prev = outboxRaw ? (JSON.parse(outboxRaw) as OutboxRecord) : null;
    if (prev?.status === "acked") return { kind: "skip", reason: "already-enrolled" };
    // Post-cutover claim exists but transport never acked (failure, replay,
    // concurrent first login): retry with the SAME eventId — no second enrollment.
    return {
      kind: "enqueue",
      retry: true,
      event: {
        v: 1,
        eventId: registrationEventId(sub),
        userId: sub,
        createdAt: claim.createdAt,
        emailVerified: true,
        consent: { marketing: true, source: "consent-record" },
        suppressed: false,
      },
    };
  }

  const event: RegistrationCreatedEvent = {
    v: 1,
    eventId: registrationEventId(sub),
    userId: sub,
    createdAt: claim.createdAt,
    emailVerified: true,
    consent: { marketing: true, source: "consent-record" },
    suppressed: false,
  };
  console.log(`registration: created ${event.eventId} for ${logId}`);
  return { kind: "enqueue", retry: false, event };
}

export async function flushOutboxAttempt(
  outbox: OutboxStore,
  now: number,
  event: RegistrationCreatedEvent,
  deliver: (event: RegistrationCreatedEvent) => Promise<boolean>,
): Promise<"acked" | "queued"> {
  const key = outboxKey(event.eventId);
  const raw = await outbox.get(key);
  const prev = raw ? (JSON.parse(raw) as OutboxRecord) : null;
  const attempts = (prev?.attempts ?? 0) + 1;
  let ok = false;
  try {
    ok = await deliver(event);
  } catch (err) {
    console.error(`registration: transport failed for ${event.eventId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await outbox.put(
    key,
    JSON.stringify({ eventId: event.eventId, userId: event.userId, status: ok ? "acked" : "queued", attempts, updatedAt: now } satisfies OutboxRecord),
  );
  // eventId carries no PII; email is never logged here.
  console.log(`registration: outbox ${event.eventId} -> ${ok ? "acked" : "queued"} (attempt ${attempts})`);
  return ok ? "acked" : "queued";
}

function parseCutover(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function kvEligibility(kv: KVNamespace): EligibilityStore {
  return {
    consentGranted: async (sub) => (await kv.get(consentKey(sub))) === "granted",
    suppressed: async (sub) => (await kv.get(suppressKey(sub))) !== null,
  };
}

/**
 * Worker entry point: call from the OAuth callback AFTER completeAuthorization.
 * Never rejects, never blocks login, never logs email/tokens.
 * Transport (`deliver`) is injected by the caller (Mautic adapter, KOMAA-786);
 * this module performs zero provider API calls itself.
 */
export async function maybeEnqueueWelcomeEnrollment(
  user: RegistrationProps,
  env: RegistrationEnv,
  ctx: ExecutionContext,
  opts?: {
    accounts?: AccountStore;
    segmentEligible?: boolean;
    deliver?: (event: RegistrationCreatedEvent) => Promise<boolean>;
  },
): Promise<void> {
  try {
    const outbox: OutboxStore = {
      get: (k) => env.OAUTH_KV.get(k),
      put: (k, v) => env.OAUTH_KV.put(k, v),
    };
    const decision = await attemptEnrollment(
      opts?.accounts ?? (env.DB ? makeD1AccountStore(env.DB) : null),
      outbox,
      kvEligibility(env.OAUTH_KV),
      Date.now(),
      {
        sub: user.googleSub,
        email: user.email,
        emailVerified: user.emailVerified,
        enabled: env.WELCOME_ENROLLMENT_ENABLED === "true",
        cutoverMs: parseCutover(env.REGISTRATION_CUTOVER_ISO),
        segmentEligible: opts?.segmentEligible ?? false,
      },
    );
    if (decision.kind === "skip") return;
    const { event } = decision;
    const deliver = opts?.deliver ?? (async (e) => {
      console.log(`registration: no transport adapter, outbox ${e.eventId} stays queued`);
      return false;
    });
    ctx.waitUntil(
      (async () => {
        await flushOutboxAttempt(outbox, Date.now(), event, deliver);
      })(),
    );
  } catch (err) {
    console.error(`registration: enrollment failed closed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
