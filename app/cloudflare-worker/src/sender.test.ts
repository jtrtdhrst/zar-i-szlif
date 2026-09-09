import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncContactToSender, type SenderEnv } from "./sender";

function createMockCtx(): ExecutionContext & { waitUntilCalls: Promise<void>[] } {
  const calls: Promise<void>[] = [];
  return {
    waitUntilCalls: calls,
    waitUntil(promise: Promise<void>) {
      calls.push(promise);
    },
    passThroughOnException() {},
  };
}

const baseUser = { email: "test@example.com", name: "Test User", googleSub: "sub-123" };

describe("sender.ts — dormant integration", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when SENDER_ONBOARDING_ENABLED is false", async () => {
    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test",
      SENDER_ONBOARDING_ENABLED: "false",
    };
    const ctx = createMockCtx();
    await syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext);

    expect(ctx.waitUntilCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when SENDER_ONBOARDING_ENABLED is undefined", async () => {
    const env: SenderEnv = { SENDER_API_TOKEN: "tok_test" };
    const ctx = createMockCtx();
    await syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext);

    expect(ctx.waitUntilCalls).toHaveLength(0);
  });

  it("does nothing when SENDER_API_TOKEN is missing", async () => {
    const env: SenderEnv = { SENDER_ONBOARDING_ENABLED: "true" };
    const ctx = createMockCtx();
    await syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext);

    expect(ctx.waitUntilCalls).toHaveLength(0);
  });

  it("does nothing when email is empty", async () => {
    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test",
      SENDER_ONBOARDING_ENABLED: "true",
    };
    const ctx = createMockCtx();
    await syncContactToSender({ ...baseUser, email: "" }, env, ctx as unknown as ExecutionContext);

    expect(ctx.waitUntilCalls).toHaveLength(0);
  });

  it("calls Sender API when enabled with correct payload", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200 });

    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test_abc",
      SENDER_ONBOARDING_ENABLED: "true",
    };
    const ctx = createMockCtx();
    await syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext);

    expect(ctx.waitUntilCalls).toHaveLength(1);
    await ctx.waitUntilCalls[0];

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.sender.net/v2/subscribers");
    expect(opts.method).toBe("POST");
    expect(opts.headers.authorization).toBe("Bearer tok_test_abc");

    const body = JSON.parse(opts.body);
    expect(body.email).toBe("test@example.com");
    expect(body.groups).toEqual(["onboarding-sekwencja"]);
    expect(body.fields.registered).toBeDefined();
  });

  it("uses custom group name from env", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200 });

    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test",
      SENDER_ONBOARDING_ENABLED: "true",
      SENDER_ONBOARDING_GROUP: "custom-group",
    };
    const ctx = createMockCtx();
    await syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext);
    await ctx.waitUntilCalls[0];

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.groups).toEqual(["custom-group"]);
  });

  it("does not throw on Sender API failure", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("server error") });

    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test",
      SENDER_ONBOARDING_ENABLED: "true",
    };
    const ctx = createMockCtx();
    await expect(
      syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext),
    ).resolves.toBeUndefined();

    await ctx.waitUntilCalls[0];
  });

  it("does not throw on network timeout", async () => {
    fetchSpy.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test",
      SENDER_ONBOARDING_ENABLED: "true",
    };
    const ctx = createMockCtx();
    await expect(
      syncContactToSender(baseUser, env, ctx as unknown as ExecutionContext),
    ).resolves.toBeUndefined();

    await ctx.waitUntilCalls[0];
  });

  it("idempotent — calling twice sends two separate API calls (Sender handles upsert)", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 });

    const env: SenderEnv = {
      SENDER_API_TOKEN: "tok_test",
      SENDER_ONBOARDING_ENABLED: "true",
    };
    const ctx1 = createMockCtx();
    const ctx2 = createMockCtx();

    await syncContactToSender(baseUser, env, ctx1 as unknown as ExecutionContext);
    await syncContactToSender(baseUser, env, ctx2 as unknown as ExecutionContext);

    await Promise.all([...ctx1.waitUntilCalls, ...ctx2.waitUntilCalls]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Both calls should have the same email — idempotency is at Sender API level
    const body1 = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const body2 = JSON.parse(fetchSpy.mock.calls[1][1].body);
    expect(body1.email).toBe(body2.email);
  });
});
