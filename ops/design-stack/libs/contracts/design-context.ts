// Canonical DesignContext — wspólny model wymiany kontekstu (Etap 10).
export interface DesignContext {
  version: string;
  project: { id: string; name: string };
  tokens: Record<string, unknown>;
  components: Array<{
    id: string;
    name: string;
    source: "opendesign" | "repo" | "plasmic";
  }>;
  page?: { id: string; name: string };
  constraints: string[];
  sourceRefs: Array<{ source: string; id: string; hash?: string }>;
}

export const DESIGN_CONTEXT_VERSION = "1";

export function makeDesignContext(
  init: Omit<DesignContext, "version">,
): DesignContext {
  return { version: DESIGN_CONTEXT_VERSION, ...init };
}
