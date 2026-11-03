// Realne źródła wiedzy użytkowej (kontrakt V1 KOMAA-308 §2–§3).
// Allowlista jako kod; denylista Paperclip-internals egzekwowana przed odczytem.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ALLOWED_SOURCES, assertAllowedSource, type SourceDocument } from "./pipeline.js";
import { assertNotDenied } from "./denylist.js";

function stripWorkerHtml(workerJs: string): string {
  return workerJs
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\[nrt`$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function runtimeDocSection(doc: string): string {
  // Tylko opis zachowania runtime; historia zmian per issue zostaje poza indeksem.
  const cut = doc.search(/^###?\s+Zmiany/m);
  return (cut === -1 ? doc : doc.slice(0, cut)).trim();
}

/**
 * Ładuje dozwolone dokumenty z checkoutu repo. S1 (katalog RR przez API)
 * i S2/S7 (dane użytkownika) są celowo pominięte: brak live API/migracji
 * w tym wydaniu — indeks zawiera wyłącznie treści globalne S3–S6 + runtime-doc.
 */
export function loadAllowedDocuments(repoRoot: string, sourceVersion: string): SourceDocument[] {
  const docs: SourceDocument[] = [];
  const add = (sourceId: string, documentId: string, relPath: string, text: string) => {
    assertAllowedSource(sourceId);
    assertNotDenied(relPath, text);
    const norm = text.replace(/\s+/g, " ").trim();
    if (!norm) return;
    docs.push({ sourceId, documentId, rawText: norm, sourceVersion });
  };
  const dir = (sourceId: string, relDir: string, docId: (f: string) => string, read: (p: string) => string) => {
    for (const f of readdirSync(join(repoRoot, relDir))) {
      const rel = `${relDir}/${f}`;
      add(sourceId, docId(f), rel, read(join(repoRoot, rel)));
    }
  };
  dir("marketing", "content/marketing", (f) => `marketing/${f}`, (p) => readFileSync(p, "utf8"));
  dir("onboarding-emails", "content/onboarding-emails/plain-text", (f) => `onboarding/${f}`, (p) => readFileSync(p, "utf8"));
  add("help-page", "help-page", "app/cloudflare-worker/strona-pomocy/worker.js",
    stripWorkerHtml(readFileSync(join(repoRoot, "app/cloudflare-worker/strona-pomocy/worker.js"), "utf8")));
  for (const d of ["polityka-prywatnosci", "warunki-korzystania"]) {
    const rel = `app/cloudflare-worker/dokumenty-prawne/${d}/worker.js`;
    add("legal", `legal/${d}`, rel, stripWorkerHtml(readFileSync(join(repoRoot, rel), "utf8")));
  }
  add("runtime-doc", "runtime-doc", "app/documentation.md",
    runtimeDocSection(readFileSync(join(repoRoot, "app/documentation.md"), "utf8")));
  void ALLOWED_SOURCES;
  return docs;
}
