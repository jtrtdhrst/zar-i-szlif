import { describe, expect, it } from "vitest";
import {
  HOST_INSPECT_TARGETS,
  HOST_RECREATE_TARGETS,
  HOST_RESTART_TARGETS,
  targetError,
} from "./host-ops";

// KOMAA-1156: the gateway narrowed Mantic reads out of its own allowlist, so the
// Mantic service/image readback could never reach the supervisor even after the
// CTO-owned policy pin lands. This lane is read-only and exact-target.
describe("KOMAA-1156 gateway Mantic read lane", () => {
  it("admits mantic-mcp-http for read-only inspect/logs/status ops", () => {
    for (const op of [
      "inspect",
      "logs",
      "host.container_inspect",
      "host.container_logs",
      "host.service_status",
      "host.service_logs",
    ]) {
      expect(targetError(op, "mantic-mcp-http")).toBeNull();
    }
  });

  it("keeps every other target denied (exact match, no wildcard)", () => {
    for (const target of ["mautic-web", "mantic-mcp", "mantic-mcp-http:latest", "*", "MANTIC-MCP-HTTP", ""]) {
      expect(targetError("host.container_inspect", target)).toMatch(/not_allowlisted/);
    }
    expect(HOST_INSPECT_TARGETS).toContain("mantic-mcp-http");
  });

  it("does not widen any mutation lane for mantic", () => {
    expect(HOST_RESTART_TARGETS).not.toContain("mantic-mcp-http");
    expect(targetError("restart", "mantic-mcp-http")).toMatch(/not_allowlisted/);
    // supervisor v3.8 pins no recreate target -> every deployment plan must still fail closed
    expect(HOST_RECREATE_TARGETS).toEqual([]);
  });
});

// KOMAA-1415: pin the ACTUAL deployed public MCP edge by exact container name.
describe("KOMAA-1415 public gateway read lane", () => {
  it("admits the live and legacy gateway names for read-only inspect/logs/status ops", () => {
    for (const target of ["paperclip-mcp-gateway", "paperclip-mcp-gateway-pub"]) {
      for (const op of ["inspect", "logs", "host.container_inspect", "host.container_logs", "host.service_status", "host.service_logs"]) {
        expect(targetError(op, target)).toBeNull();
      }
      expect(HOST_INSPECT_TARGETS).toContain(target);
    }
  });

  it("admits the verified live gateway name and keeps near-misses denied", () => {
    for (const target of ["paperclip-mcp-gateway", "paperclip-mcp-gateway-pub"]) {
      expect(targetError("host.container_logs", target)).toBeNull();
    }
    for (const target of ["paperclip-mcp-gateway-pub:latest", "paperclip-mcp-gateway:latest", "paperclip-mcp-*", "*", "PAPERCLIP-MCP-GATEWAY", ""]) {
      expect(targetError("host.container_inspect", target)).toMatch(/not_allowlisted/);
    }
  });

  it("does not widen a mutation lane for either gateway", () => {
    for (const target of ["paperclip-mcp-gateway", "paperclip-mcp-gateway-pub"]) {
      expect(HOST_RESTART_TARGETS).not.toContain(target);
      expect(targetError("restart", target)).toMatch(/not_allowlisted/);
    }
    expect(HOST_RECREATE_TARGETS).toEqual([]);
  });
});
