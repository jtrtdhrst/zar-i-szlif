import { describe, expect, it, vi } from "vitest";
import { syncVerifiedUserToSupabase } from "./supabase-accounts";
const good = { googleSub: "google-identity-1", email: " Example@Example.COM ", emailVerified: true };
const env = { SUPABASE_USER_SYNC_ENABLED: "true", SUPABASE_URL: "https://sandbox.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test_only" };

describe("Supabase registry — zero welcome emails on OAuth login", () => {
  it("defaults OFF, no requests", async () => {
    const fetcher = vi.fn();
    expect(await syncVerifiedUserToSupabase(good, {}, fetcher)).toBe("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects unverified, missing key and insecure URL", async () => {
    const fetcher = vi.fn();
    expect(await syncVerifiedUserToSupabase({ ...good, emailVerified: false }, env, fetcher)).toBe("invalid");
    expect(await syncVerifiedUserToSupabase(good, { ...env, SUPABASE_SECRET_KEY: "" }, fetcher)).toBe("invalid");
    expect(await syncVerifiedUserToSupabase(good, { ...env, SUPABASE_URL: "http://sandbox.supabase.co" }, fetcher)).toBe("invalid");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("calls authenticated RPC only with signup proof FALSE", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    const result = await syncVerifiedUserToSupabase(good, env, fetcher);
    expect(result).toBe("synced");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://sandbox.supabase.co/rest/v1/rpc/register_app_user");
    expect(options.headers.apikey).toBe("sb_secret_test_only");
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      p_google_sub: "google-identity-1",
      p_email: "example@example.com",
      p_email_verified: true,
      p_authoritative_signup: false,
    });
  });
  it("fails closed on provider 401", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    expect(await syncVerifiedUserToSupabase(good, env, fetcher)).toBe("failed");
  });
  it("fails closed on network error", async () => {
    const fetcher = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await syncVerifiedUserToSupabase(good, env, fetcher)).toBe("failed");
  });
});
