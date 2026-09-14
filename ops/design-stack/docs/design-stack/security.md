# Bezpieczeństwo

- Sekrety poza Git: `.env` / istniejący secret management. Klucze:
  `PLASMIC_EMAIL`/`PLASMIC_PASSWORD` (dedykowany user) lub `PLASMIC_TEAM_TOKEN`,
  `PLASMIC_MCP_TOKEN`, `OPENDESIGN_BRIDGE_TOKEN`, `OD_API_TOKEN`, tokeny GitHub/Vercel.
- MCP HTTP nigdy anonimowo: Bearer + rotowalne credentiale (osobne dla OpenCode/zdalnych klientów),
  rate-limit, limit 1 MB, timeouty, logi bez `Authorization`/cookies/sesji/refresh tokenów/credentiali DB.
- Plasmic: profil dedykowany (osobny user systemowy w kontenerze `mcp`, non-root uid 10001,
  read-only fs, tmpfs, locki). Do kontekstu przeglądarkowego/Studio NIGDY:
  `service_role`, credentiale ownera DB, credentiale migracji. Rozdział client-safe vs server-only
  zgodnie z architekturą aplikacji.
- Sieć: kontenery MCP tylko w `plasmic_default` / `open-design_default`, bez dostępu
  do pozostałych kontenerów; na zewnątrz wyłącznie przez reverse proxy (TLS).
