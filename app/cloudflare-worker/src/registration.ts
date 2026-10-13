// registration.ts
// Authoritative `registration_created` event + durable exactly-once welcome enrollment.
// (KOMAA-785: app-first registration logic. No mail copy, no production send here.)
//
// Model:
// - The ONLY creation proof is a first-seen claim in the account store, keyed by
//   verified Google `sub`, at/after REGISTRATION_CUTOVER_ISO. OAuth login, Mautic
//   segment joins and KV reads elsewhere are NEVER creation proof.
// - Decision is exactly-once per sub (one immutable eventId `reg:{sub}`); transport
//   is at-least-once with an idempotent effect (same eventId -> same outbox key,
//   same Idempotency-Key header, Sender email upsert).
// - Failure never rolls back registration: outbox stays `queued`, the next login
//   retries with the SAME eventId (no double enrollment).
//
// Production defaults: WELCOME_ENROLLMENT_ENABLED != "true" -> zero KV writes,
// zero requests. REGISTRATION_CUTOVER_ISO unset -> zero enrollments (fail-closed).
//
// ponytail: KV has no CAS/transaction, so concurrent first logins share one
// eventId/outbox key instead of a true atomic claim. True exactly-once needs D1
// (or Supabase auth table) with a UNIQUE(sub) insert as the claim — see BLOCKER
// note in maybeEnqueueWelcomeEnrollment. Consent capture UI does not exist yet:
// absent consent record = deny, so enrollment stays at zero until Lifecycle Ops
// ships it.

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
  WELCOME_ENROLLMENT_ENABLED?: string;
  REGISTRATION_CUTOVER_ISO?: string;
  SENDER_API_TOKEN?: string;
  SENDER_ONBOARDING_ENABLED?: string;
  SENDER_ONBOARDING_GROUP?: string;
}

export interface RegistrationProps {
  googleSub: string;
  email: string;
  emailVerified: boolean;
}

export type EnrollmentDecision =
  | { kind: "enqueue"; event: RegistrationCreatedEvent; retry: boolean }
  | { kind: "skip"; reason: string };

interface ClaimRecord {
  eventId: string;
  createdAt: number;
}

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

/** Minimal key-value store surface. Cloudflare KV satisfies it; tests use a Map. */
export interface ClaimStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

const claimKey = (sub: string) => `welcome:claim:${sub}`;
const outboxKey = (eventId: string) => `welcome:outbox:${eventId}`;
const consentKey = (sub: string) => `welcome:consent:${sub}`;
const suppressKey = (sub: string) => `welcome:suppress:${sub}`;

export async function attemptEnrollment(
  store: ClaimStore,
  now: number,
  input: {
    sub: string;
    email: string;
    emailVerified: boolean;
    enabled: boolean;
    cutoverMs: number | null;
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

  const sub = input.sub.trim();
  const [consent, suppressed, claimRaw] = await Promise.all([
    store.get(consentKey(sub)),
    store.get(suppressKey(sub)),
    store.get(claimKey(sub)),
  ]);
  if (suppressed) return { kind: "skip", reason: "suppressed" };
  if (consent !== "granted") return { kind: "skip", reason: "no-consent" };

  const eventId = registrationEventId(sub);
  if (claimRaw) {
    const claim = JSON.parse(claimRaw) as ClaimRecord;
    if (claim.createdAt < input.cutoverMs) return { kind: "skip", reason: "existing-account" };
    const outboxRaw = await store.get(outboxKey(eventId));
    const outbox = outboxRaw ? (JSON.parse(outboxRaw) as OutboxRecord) : null;
    if (outbox?.status === "acked") return { kind: "skip", reason: "already-enrolled" };
    // Claim exists but transport never acked (failure, replay, concurrent first
    // login): retry with the SAME eventId — no second enrollment.
    return {
      kind: "enqueue",
      retry: true,
      event: {
        v: 1,
        eventId,
        userId: sub,
        createdAt: claim.createdAt,
        emailVerified: true,
        consent: { marketing: true, source: "kv-consent-record" },
        suppressed: false,
      },
    };
  }

  // First-seen after cutover with verified email + explicit consent = creation proof.
  const event: RegistrationCreatedEvent = {
    v: 1,
    eventId,
    userId: sub,
    createdAt: now,
    emailVerified: true,
    consent: { marketing: true, source: "kv-consent-record" },
    suppressed: false,
  };
  await store.put(claimKey(sub), JSON.stringify({ eventId, createdAt: now } satisfies ClaimRecord));
  console.log(`registration: created ${eventId} for ${logId}`);
  return { kind: "enqueue", retry: false, event };
}

export async function flushOutboxAttempt(
  store: ClaimStore,
  now: number,
  event: RegistrationCreatedEvent,
  deliver: (event: RegistrationCreatedEvent) => Promise<boolean>,
): Promise<"acked" | "queued"> {
  const key = outboxKey(event.eventId);
  const raw = await store.get(key);
  const prev = raw ? (JSON.parse(raw) as OutboxRecord) : null;
  const attempts = (prev?.attempts ?? 0) + 1;
  let ok = false;
  try {
    ok = await deliver(event);
  } catch (err) {
    console.error(`registration: transport failed for ${event.eventId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  await store.put(
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

/**
 * Worker entry point: call from the OAuth callback AFTER completeAuthorization.
 * Never rejects, never blocks login, never logs email/tokens.
 *
 * BLOCKER (KOMAA-785.5): without a transactional account store this claim is
 * KV read-then-write (eventual consistency, no CAS). Minimal platform change
 * for true exactly-once: add a D1 binding (or Supabase auth table) and make
 * the claim a UNIQUE(sub) insert; keep this KV outbox for transport. Until
 * then WELCOME_ENROLLMENT_ENABLED stays "false" in production.
 */
export async function maybeEnqueueWelcomeEnrollment(
  user: RegistrationProps,
  env: RegistrationEnv,
  ctx: ExecutionContext,
): Promise<void> {
  try {
    const store: ClaimStore = {
      get: (k) => env.OAUTH_KV.get(k),
      put: (k, v) => env.OAUTH_KV.put(k, v),
    };
    const decision = await attemptEnrollment(store, Date.now(), {
      sub: user.googleSub,
      email: user.email,
      emailVerified: user.emailVerified,
      enabled: env.WELCOME_ENROLLMENT_ENABLED === "true",
      cutoverMs: parseCutover(env.REGISTRATION_CUTOVER_ISO),
    });
    if (decision.kind === "skip") return;
    const { event } = decision;
    ctx.waitUntil(
      (async () => {
        await flushOutboxAttempt(store, Date.now(), event, async (e) => {
          if (env.SENDER_ONBOARDING_ENABLED !== "true" || !env.SENDER_API_TOKEN) {
            console.log(`registration: transport disabled, outbox ${e.eventId} stays queued`);
            return false;
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 4000);
          try {
            const resp = await fetch("https://api.sender.net/v2/subscribers", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${env.SENDER_API_TOKEN}`,
                "idempotency-key": e.eventId,
              },
              body: JSON.stringify({
                email: user.email,
                fields: { registered: new Date(e.createdAt).toISOString(), registration_event_id: e.eventId },
                groups: [env.SENDER_ONBOARDING_GROUP || "onboarding-sekwencja"],
              }),
              signal: controller.signal,
            });
            if (!resp.ok) {
              console.error(`registration: sender API ${resp.status} for ${e.eventId}`);
              return false;
            }
            return true;
          } catch {
            return false;
          } finally {
            clearTimeout(timeout);
          }
        });
      })(),
    );
  } catch (err) {
    console.error(`registration: enrollment failed closed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
