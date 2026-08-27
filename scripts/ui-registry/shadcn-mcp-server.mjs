import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const port = parseInt(process.env.PORT || "4173", 10);

const registry = JSON.parse(readFileSync("C:\\Kompas Zbiórek\\registry.json", "utf-8"));
const kompasDir = "C:\\Kompas Zbiórek\\registry\\kompas";

function getComponents(dir) {
  const results = [];
  const entries = readFileSync(dir, "utf-8");
  // Parse the registry.json inside kompas dir
  try {
    const inner = JSON.parse(entries);
    for (const [key, value] of Object.entries(inner)) {
      if (value && typeof value === "object" && value.name) {
        results.push({ name: key, ...value });
      }
    }
  } catch {}
  return results;
}

// Build component list from registry structure
const components = [
  { name: "kompas-button", type: "registry:ui", title: "Przycisk Kompas", description: "Przycisk akcji głównej" },
  { name: "brand-header", type: "registry:component", title: "Nagłówek marki", description: "Nagłówek wizualny komponentów marki" },
  { name: "stage-checklist", type: "registry:block", title: "Checklista etapów", description: "Lista zadań z postępem" },
  { name: "app-shell", type: "registry:component", title: "Powłoka aplikacji", description: "Ogólna struktura aplikacji" }
];

function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname === "/mcp" && req.method === "GET") {
    const response = {
      success: true,
      result: {
        tools: components.map(c => ({
          name: c.name,
          description: c.description,
          ...c
        })),
        resources: []
      }
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
}

createServer(handleRequest).listen(port, () => {
  console.log(`[shadcn-mcp-server] listening on http://127.0.0.1:${port}/mcp`);
});