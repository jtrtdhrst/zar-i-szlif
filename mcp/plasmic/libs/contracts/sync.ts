import { createHash } from "node:crypto";

export function sha256(data: string | object): string {
  const s = typeof data === "string" ? data : JSON.stringify(data);
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

export type SyncCheck = { status: "ok" } | { status: "conflict"; diff: string };

export interface SyncHashes {
  source: string;
  target: string;
  lastSync: string | null;
}

/** Etap 13: konflikt gdy obie strony zmieniły się od ostatniego syncu. */
export function checkSyncConflict(h: SyncHashes): SyncCheck {
  if (
    h.lastSync !== null &&
    h.source !== h.lastSync &&
    h.target !== h.lastSync
  ) {
    return {
      status: "conflict",
      diff: `SYNC_CONFLICT source=${h.source} target=${h.target} lastSync=${h.lastSync}`,
    };
  }
  return { status: "ok" };
}
