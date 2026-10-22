import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEntry {
  timestamp: string;
  agent?: string;
  run?: string;
  project?: string;
  tool: string;
  target?: string;
  beforeHash?: string;
  afterHash?: string;
  ok: boolean;
  error?: string;
}

/** Etap 1: audit log dla każdej operacji write. Bez sekretów i danych użytkowników. */
export async function auditLog(
  file: string,
  entry: Omit<AuditEntry, "timestamp">,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(
    file,
    JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n",
  );
}
