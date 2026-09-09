// sender.ts
// Dormant Sender.net integration — onboarding contact sync after registration.
//
// SENDER_ONBOARDING_ENABLED=false (default): zero requests, zero sends.
// When enabled: idempotent POST /v2/subscribers → contact created/updated,
// added to "onboarding-sekwencja" group → Sender automation triggers sequence.
//
// Failure handling: Sender errors NEVER roll back a locally successful registration.
// The call is fire-and-forget via ctx.waitUntil.

import type { AuthProps } from "./google-handler";

export interface SenderEnv {
  SENDER_API_TOKEN?: string;
  SENDER_ONBOARDING_ENABLED?: string;
  SENDER_ONBOARDING_GROUP?: string;
}

const SENDER_API_URL = "https://api.sender.net/v2/subscribers";
const DEFAULT_GROUP = "onboarding-sekwencja";
const TIMEOUT_MS = 4000;

function isEnabled(env: SenderEnv): boolean {
  return env.SENDER_ONBOARDING_ENABLED === "true";
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const masked = local.length <= 2 ? "**" : local[0] + "*".repeat(local.length - 2) + local[local.length - 1];
  return `${masked}@${domain}`;
}

export async function syncContactToSender(
  user: Pick<AuthProps, "email" | "name" | "googleSub">,
  env: SenderEnv,
  ctx: ExecutionContext,
): Promise<void> {
  if (!isEnabled(env)) {
    console.log("sender: disabled (SENDER_ONBOARDING_ENABLED != true), skipping");
    return;
  }

  if (!env.SENDER_API_TOKEN) {
    console.error("sender: SENDER_API_TOKEN not configured, skipping sync");
    return;
  }

  if (!user.email) {
    console.error("sender: no email, skipping sync");
    return;
  }

  const group = env.SENDER_ONBOARDING_GROUP || DEFAULT_GROUP;

  ctx.waitUntil(
    (async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const resp = await fetch(SENDER_API_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.SENDER_API_TOKEN}`,
          },
          body: JSON.stringify({
            email: user.email,
            fields: {
              registered: new Date().toISOString(),
            },
            groups: [group],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          console.error(
            `sender: API error ${resp.status} for ${maskEmail(user.email)}: ${body.slice(0, 200)}`,
          );
        } else {
          console.log(`sender: contact synced for ${maskEmail(user.email)}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`sender: sync failed for ${maskEmail(user.email)}: ${msg}`);
      }
    })(),
  );
}
