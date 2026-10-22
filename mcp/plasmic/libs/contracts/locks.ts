import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

// Prosty write-lock per projekt (Etap 17). Ready mogą iść równolegle —
// lock biorą tylko operacje write. Stale locke (>5 min) są przejmowane.
// Atomowość przez O_EXCL (flaga "wx"): tylko jeden proces/proces-wątek wygra.
const STALE_MS = 5 * 60 * 1000;

async function tryAcquire(lockFile: string): Promise<boolean> {
  try {
    await writeFile(lockFile, String(Date.now()), { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  // Lock istnieje — sprawdź staleness i ewentualnie przejmij.
  try {
    const st = await stat(lockFile);
    if (Date.now() - st.mtimeMs > STALE_MS) {
      await rm(lockFile, { force: true });
      try {
        await writeFile(lockFile, String(Date.now()), { flag: "wx" });
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false; // ktoś właśnie zwolnił — spróbuj ponownie
  }
  // Odśwież mtime własnego oczekiwania? Nie — po prostu czekaj.
  void readFile(lockFile, "utf8").catch(() => null);
  return false;
}

export async function withProjectLock<T>(
  dir: string,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const lockFile = join(dir, `plasmic-project-${safe}.lock`);
  await mkdir(dir, { recursive: true });
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (await tryAcquire(lockFile)) break;
    if (Date.now() > deadline) {
      throw new Error(`LOCK_TIMEOUT plasmic-project:${projectId}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    await rm(lockFile, { force: true });
  }
}
