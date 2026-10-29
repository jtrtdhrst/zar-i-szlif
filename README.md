# Żar i Szlif — empty Plasmic workspace

This repository is intentionally an **empty, Plasmic-compatible destination**, not the production source of the application or independent MCP services.

```text
www/
  landing/   # Main marketing website (future Plasmic output)
  mcp/       # MCP informational website (future Plasmic output)
product/     # Product app / panel (future Plasmic output)
mcp/         # Product-owned MCP (future source)
```

All four leaf folders contain only `.gitkeep` so GitHub retains their paths. No build commands, deployments, or workflows are active here. Plasmic can generate files into the dedicated target folder without nested legacy projects.

Existing product sources, recovered landing pages, databases, and product MCP are preserved in [kompaszbiorek-archiwum](https://github.com/miloszspyrka-code/kompaszbiorek-archiwum). Independent MCP services, adapters, Plasmic self-hosting, and recovered infrastructure fixes live in [harness-zar-i-szlif](https://github.com/miloszspyrka-code/harness-zar-i-szlif).

Prior source main: `e3dd9cbb419a39aa6934546a1aa9a310058d6573` (reachable as this commit's parent). Other old branches are inventoried in the Harness repository; they must be deleted after their needed changes have been archived.

**Deployment note:** Existing Coolify and Cloudflare builds previously referenced legacy paths. Their automatic build triggers were temporarily paused before this source cleanup. Do not reactivate them against these empty folders. Reconnect the intended repositories and verify a healthy deployment first.
