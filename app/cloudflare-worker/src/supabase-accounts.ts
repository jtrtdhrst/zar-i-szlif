// Supabase is the canonical account registry. This is an OAuth login *synchronizer*,
// NOT a signup event or permission to send a welcome email.
// After provider-side OIDC verification only; backend secret never leaves the worker.
export interface SupabaseUserEnv {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_USER_SYNC_ENABLED?: string;
}
export interface VerifiedGoogleIdentity {
  googleSub: string;
  email: string;
  emailVerified: boolean;
}

export async function syncVerifiedUserToSupabase(
  user: VerifiedGoogleIdentity,
  env: SupabaseUserEnv,
  request: typeof fetch = fetch,
): Promise<"disabled" | "invalid" | "synced" | "failed"> {
  if (env.SUPABASE_USER_SYNC_ENABLED !== "true") return "disabled";
  const secret = env.SUPABASE_SECRET_KEY;
  const sub = user.googleSub?.trim();
  const email = user.email?.trim().toLowerCase();
  if (!sub || !email || !email.includes("@") || !user.emailVerified || !secret || !env.SUPABASE_URL) {
    return "invalid";
  }
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "invalid";
    url = new URL("/rest/v1/rpc/register_app_user", url);
  } catch {
    return "invalid";
  }
  try {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 4500);
    try {
      // New sb_secret_xxx keys belong only in apikey, not Bearer Authorization.
      const response = await request(url.href, {
        method: "POST",
        headers: { apikey: secret, "content-type": "application/json" },
        body: JSON.stringify({
          p_google_sub: sub,
          p_email: email,
          p_email_verified: true,
          // IMPORTANT: an OAuth login is NOT an authoritative first-registration event.
          p_authoritative_signup: false,
        }),
        signal: abort.signal,
      });
      if (!response.ok) {
        console.error("supabase-account: RPC failed status=" + response.status);
        return "failed";
      }
      return "synced";
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    console.error("supabase-account: network error (login unaffected)");
    return "failed";
  }
}

export function queueVerifiedAccountSync(
  user: VerifiedGoogleIdentity,
  env: SupabaseUserEnv,
  ctx: ExecutionContext,
): void {
  if (env.SUPABASE_USER_SYNC_ENABLED !== "true") return;
  ctx.waitUntil(syncVerifiedUserToSupabase(user, env).then(() => undefined));
}
