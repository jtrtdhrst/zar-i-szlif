# Language and Content Preservation Policy — v1.0 (2026-10-16)

**Status:** ACTIVE / company-wide. Applies to all current and future Paperclip agents, their instructions, skills, routines, reviews, handoffs and generated output. This page is the canonical reference. The user's explicit content-language decision takes precedence over older, conflicting style instructions. Do not change product meaning.

## Mandatory language routing

**ENGLISH — internal operational material (newly authored):**
- Agent operational reports, summaries, daily/weekly recaps, progress updates, diagnostics, postmortems, incident and recovery reports.
- Technical comments on issues, status explanations, review decisions, acceptance and verification notes, release/deploy reports, code-review comments and handoffs.
- Routine and heartbeat prompts/output, operator summaries, testing plans and results, QA evidence, CI summaries, tool/MCP diagnostics, agent run narratives.
- Agent operating instructions, system prompts, skill descriptions/SKILL.md process guidance, internal documentation, architectural decision records and engineering task descriptions.
- New technical issue titles, where authored by agents, should also be English.

**POLISH — customer/product-facing creative content (preserve verbatim unless explicitly authorized to edit):**
- Brand and proper names, especially **Żar i Szlif**, names of characters, places, proprietary concepts, products and features. Never rename or translate merely to satisfy operational language rules.
- Marketing/editorial copy, headlines, CTA button text, onboarding and in-app UI messages, validation/error/help text intended for Polish users.
- Product descriptions, requirements that define literal Polish copy, campaign content, story/lore, dialogue, character speech, and game narrative.
- User-facing marketing emails, subject lines, preheaders, buttons, unsubscribe wording and approved customer-facing message content.

## Mixed artifacts: write in two clearly separated lanes

1. Write the explanation, implementation plan, metadata and validation evidence in **English**.
2. Keep the product's literal text and final deliverables in **Polish**, preserving their exact approved spelling, punctuation, diacritics and placeholders.
3. When citing existing Polish customer copy or requirements inside an English report, quote the original Polish excerpt without translating it. English commentary may surround the quote.
4. Do not auto-translate existing history, past tickets, original logs, code snippets, shell output, API fields, data payloads, identifiers, paths, hashes, language-specific test fixtures or external evidence. Preserve them verbatim as evidence; summarize in English.
5. Respect an explicit per-artifact localized target in a particular approved task. A new intentional product locale requires a separately approved product decision, not an incidental agent style change.
6. If an issue contains both product copy and operational reporting, the **operation** is English and the **literal copy** remains Polish. This policy does not mandate translating Paperclip's own built-in status enums, UI chrome or pre-existing database history.

## Examples

- English report: `Verified production email rendering on Gmail and Outlook; the approved CTA is "Rozpocznij budowę obozowiska".`
- Polish app: `Rozpocznij budowę obozowiska` (do not replace with `Start building the camp`).
- English QA: `FAIL: The Polish welcome email subject was overwritten. Restore the exact approved Polish copy.`
- Brand: `Żar i Szlif` remains `Żar i Szlif`.

## Pre-publication quality gate

Before writing any issue comment, review, report, agent message or routine result, classify its intended audience. Operational text must be in English; user/product creative text for the Polish market must remain Polish. Before committing product files or publishing creative, compare all modified literal text and verify no unrequested translation. When reporting exceptions, mention them in English, give artifact location, and keep the original content intact.

## Deployment scope and precedence

Implement this policy in every agent's *effective* instructions or persistent capability contract and in active routine prompts plus company-created skills where needed. Update existing content non-destructively, without wiping role-specific guardrails or changing run schedules, review ownership, security, model configuration or production gates. Avoid changes to Paperclip core. New agents, skills and routines must inherit the rule. Do not treat the presence of this page alone as proof that the rule reached an agent runtime: verify effective config and outputs.
