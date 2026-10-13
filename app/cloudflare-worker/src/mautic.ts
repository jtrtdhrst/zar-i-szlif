// mautic.ts
// Inert Mautic integration — verified-registration contact upsert (no sends).
//
// MAUTIC_ONBOARDING_ENABLED=false (default): zero requests, zero sends.
// When enabled: idempotent find-then-upsert of the contact by normalized email
// (Mautic dedupes on unique e-mail), tags the contact, never assigns segments,
// never sends e-mail. Sending happens only via Mautic campaigns owned by
// Lifecycle Ops. Unsubscribe/suppression stays native to Mautic
// ({unsubscribe_url} token + Do-Not-Contact respected server-side).
//
// Failure handling: Mautic errors NEVER roll back a locally successful
// registration. The call is fire-and-forget via ctx.waitUntil. Rate-limit
// (429) is logged and dropped, never retried in a loop.
//
// Real Mautic instance: https://mautic.kompaszbiorek.pl (login + /api/ live,
// API credentials NOT provisioned to this runtime — see KOMAA-786).

import type { AuthProps } from "./google-handler";

export interface MauticEnv {
  MAUTIC_ONBOARDING_ENABLED?: string;
  MAUTIC_BASE_URL?: string;
  MAUTIC_USERNAME?: string;
  MAUTIC_PASSWORD?: string;
  MAUTIC_TEST_TAG?: string;
}

const DEFAULT_TEST_TAG = "welcome-test-only";
const TIMEOUT_MS = 4000;

export function isMauticEnabled(env: MauticEnv): boolean {
  return env.MAUTIC_ONBOARDING_ENABLED === "true";
}

export function normalizeEmail(email: string): string | null {
  if (typeof email !== "string") return null;
  const clean = email.trim().toLowerCase();
  if (clean.length === 0 || clean.length > 254) return null;
  const [local, domain] = clean.split("@");
  if (!local || !domain || !domain.includes(".") || clean.includes(" ")) return null;
  return clean;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const masked = local.length <= 2 ? "**" : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const json = await resp.json().catch(() => null);
    return { status: resp.status, json };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timeout);
  }
}

// ponytail: find-then-upsert is two sequential calls; single POST /contacts/new
// would silently fork duplicates on Mautic versions without unique-email merge.
export async function upsertMauticContact(
  user: Pick<AuthProps, "email" | "name">,
  env: MauticEnv,
): Promise<{ ok: boolean; contactId?: number }> {
  const email = normalizeEmail(user.email ?? "");
  if (!email) return { ok: false };
  const base = (env.MAUTIC_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base || !env.MAUTIC_USERNAME || !env.MAUTIC_PASSWORD) return { ok: false };

  const headers = {
    "content-type": "application/json",
    authorization: basicAuth(env.MAUTIC_USERNAME, env.MAUTIC_PASSWORD),
  };
  const tag = env.MAUTIC_TEST_TAG || DEFAULT_TEST_TAG;
  const firstname = (user.name ?? "").trim().split(/\s+/)[0] || undefined;

  const found = await fetchJson(`${base}/api/contacts?search=email:${encodeURIComponent(email)}`, { headers });
  if (found.status === 429) {
    console.error(`mautic: rate-limited (429) for ${maskEmail(email)}, dropping without retry`);
    return { ok: false };
  }
  // Fail-closed: never create blind when the dedupe search itself failed,
  // otherwise a transient search error would fork a duplicate contact.
  if (found.status < 200 || found.status >= 300) {
    console.error(`mautic: contact search failed (${found.status}) for ${maskEmail(email)}, skipping create`);
    return { ok: false };
  }
  const total = (found.json as { total?: string } | null)?.total;
  const existing = (found.json as { contacts?: Record<string, { id: number }> } | null)?.contacts;
  const existingId = total !== "0" && existing ? Number(Object.keys(existing)[0]) : NaN;

  const payload = { email, ...(firstname ? { firstname } : {}), tags: [tag] };
  const result = Number.isFinite(existingId)
    ? await fetchJson(`${base}/api/contacts/${existingId}/edit`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      })
    : await fetchJson(`${base}/api/contacts/new`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

  if (result.status === 429) {
    console.error(`mautic: rate-limited (429) for ${maskEmail(email)}, dropping without retry`);
    return { ok: false };
  }
  if (result.status < 200 || result.status >= 300) {
    console.error(`mautic: API error ${result.status} for ${maskEmail(email)}`);
    return { ok: false };
  }
  const contact = (result.json as { contact?: { id: number } } | null)?.contact;
  console.log(`mautic: contact upserted for ${maskEmail(email)}`);
  return { ok: true, ...(contact?.id ? { contactId: contact.id } : {}) };
}

export async function syncRegistrationToMautic(
  user: Pick<AuthProps, "email" | "name" | "googleSub">,
  env: MauticEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!isMauticEnabled(env)) {
    console.log("mautic: disabled (MAUTIC_ONBOARDING_ENABLED != true), skipping");
    return;
  }
  // googleSub presence = verified registration proof; segment join alone never triggers.
  if (!user.googleSub) {
    console.error("mautic: no verified registration proof (googleSub), skipping sync");
    return;
  }
  ctx.waitUntil(
    (async () => {
      try {
        await upsertMauticContact(user, env);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`mautic: sync failed: ${msg}`);
      }
    })(),
  );
}
