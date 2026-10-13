import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  syncRegistrationToMautic,
  upsertMauticContact,
  normalizeEmail,
  type MauticEnv,
} from "./mautic";

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

const baseUser = { email: "Test@Example.com", name: "Test User", googleSub: "sub-123" };
const enabledEnv: MauticEnv = {
  MAUTIC_ONBOARDING_ENABLED: "true",
  MAUTIC_BASE_URL: "https://mautic.example.test",
  MAUTIC_USERNAME: "api_user",
  MAUTIC_PASSWORD: "s3cret",
};

describe("mautic.ts — inert integration", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when MAUTIC_ONBOARDING_ENABLED is false", async () => {
    const ctx = createMockCtx();
    await syncRegistrationToMautic(baseUser, { ...enabledEnv, MAUTIC_ONBOARDING_ENABLED: "false" }, ctx as unknown as ExecutionContext);
    expect(ctx.waitUntilCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips without verified registration proof (no googleSub)", async () => {
    const ctx = createMockCtx();
    await syncRegistrationToMautic({ ...baseUser, googleSub: "" }, enabledEnv, ctx as unknown as ExecutionContext);
    expect(ctx.waitUntilCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips when credentials are missing", async () => {
    const ctx = createMockCtx();
    await syncRegistrationToMautic(baseUser, { MAUTIC_ONBOARDING_ENABLED: "true" }, ctx as unknown as ExecutionContext);
    await Promise.all(ctx.waitUntilCalls);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates a new contact when search finds none", async () => {
    fetchSpy
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ total: "0", contacts: {} }) })
      .mockResolvedValueOnce({ status: 201, json: () => Promise.resolve({ contact: { id: 7 } }) });
    const ctx = createMockCtx();
    await syncRegistrationToMautic(baseUser, enabledEnv, ctx as unknown as ExecutionContext);
    expect(ctx.waitUntilCalls).toHaveLength(1);
    await ctx.waitUntilCalls[0];

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [searchUrl] = fetchSpy.mock.calls[0];
    expect(searchUrl).toContain("/api/contacts?search=email:test%40example.com");
    const [createUrl, createOpts] = fetchSpy.mock.calls[1];
    expect(createUrl).toBe("https://mautic.example.test/api/contacts/new");
    expect(createOpts.headers.authorization).toMatch(/^Basic /);
    const body = JSON.parse(createOpts.body);
    expect(body.email).toBe("test@example.com");
    expect(body.firstname).toBe("Test");
    expect(body.tags).toEqual(["welcome-test-only"]);
  });

  it("patches the existing contact instead of forking a duplicate", async () => {
    fetchSpy
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ total: "1", contacts: { 42: { id: 42 } } }) })
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ contact: { id: 42 } }) });
    const res = await upsertMauticContact(baseUser, enabledEnv);
    expect(res).toEqual({ ok: true, contactId: 42 });
    const [editUrl, editOpts] = fetchSpy.mock.calls[1];
    expect(editUrl).toBe("https://mautic.example.test/api/contacts/42/edit");
    expect(editOpts.method).toBe("PATCH");
  });

  it("drops on 429 without retry", async () => {
    fetchSpy.mockResolvedValueOnce({ status: 429, json: () => Promise.resolve(null) });
    const res = await upsertMauticContact(baseUser, enabledEnv);
    expect(res).toEqual({ ok: false });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw on API failure or network abort", async () => {
    fetchSpy.mockResolvedValueOnce({ status: 500, json: () => Promise.resolve(null) });
    await expect(upsertMauticContact(baseUser, enabledEnv)).resolves.toEqual({ ok: false });
    fetchSpy.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    const ctx = createMockCtx();
    await syncRegistrationToMautic(baseUser, enabledEnv, ctx as unknown as ExecutionContext);
    await expect(Promise.all(ctx.waitUntilCalls)).resolves.toBeDefined();
  });

  it("rejects malformed emails without any request", async () => {
    for (const bad of ["", "no-at-sign", "a@b", "x @y.pl", "@y.pl", "a@b.c ".repeat(60)]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
    expect(normalizeEmail("__proto__")).toBeNull();
    const res = await upsertMauticContact({ email: "not-an-email", name: "" }, enabledEnv);
    expect(res).toEqual({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never assigns segments or sends: payload carries no segment/campaign id", async () => {
    fetchSpy
      .mockResolvedValueOnce({ status: 200, json: () => Promise.resolve({ total: "0", contacts: {} }) })
      .mockResolvedValueOnce({ status: 201, json: () => Promise.resolve({ contact: { id: 1 } }) });
    await upsertMauticContact(baseUser, enabledEnv);
    const raw = JSON.stringify(fetchSpy.mock.calls.map((c) => [c[0], c[1]?.body]));
    expect(raw).not.toMatch(/segment|campaign|send/i);
  });
});
