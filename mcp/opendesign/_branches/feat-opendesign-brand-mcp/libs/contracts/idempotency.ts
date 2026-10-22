import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./sync.ts";

// Idempotencja (Etap 1): idempotencyKey -> zapamiętany wynik.
export async function idempotent<T>(
  dir: string,
  key: string,
  fn: () => Promise<T>,
): Promise<{ result: T; deduped: boolean }> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, sha256(key) + ".json");
  const prev = await readFile(file, "utf8").catch(() => null);
  if (prev !== null) {
    return { result: JSON.parse(prev) as T, deduped: true };
  }
  const result = await fn();
  await writeFile(file, JSON.stringify(result));
  return { result, deduped: false };
}
