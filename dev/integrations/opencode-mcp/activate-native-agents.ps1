# Activates native ctb-* agent governance end-to-end. Run ONLY in a maintenance window:
# step 1 restarts the shared OpenCode backend on 4096, which interrupts any in-flight
# OpenCode sessions (including active Paperclip runs; they recover via process_lost retry).
#
# Sequence (mirrors the audit acceptance list):
#   1. restart backend 4096
#   2. verify backend now exposes ctb-* agents
#   3. restart gateway 4097 with OPENCODE_MCP_NATIVE_AGENTS=on (-NativeAgents)
#   4. print follow-up live probes to run (live-fallback-probe.mjs / live-smoke.mjs)
param([switch]$ConfirmBackendRestart)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

if (-not $ConfirmBackendRestart) {
  Write-Warning "To bezpieczna operacja okienkowa: krok 1 przerywa aktywne sesje OpenCode (process_lost retry je odbuduje)."
  Write-Output "Uruchom ponownie z -ConfirmBackendRestart w zaplanowanym oknie serwisowym."
  exit 1
}

Write-Output "[1/4] Restart backendu OpenCode na 4096..."
Get-NetTCPConnection -State Listen -LocalPort 4096 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
Start-Sleep -Seconds 2
& (Join-Path $PSScriptRoot "start-opencode-mcp.ps1") -Force
Write-Output "[1/4] Backend 4096 uruchomiony ponownie."

Write-Output "[2/4] Weryfikacja agentow ctb-* na backendzie..."
$runtime = Join-Path $PSScriptRoot ".runtime"
$stored = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $runtime "credentials.txt")) {
  if ($line -match "^([^=]+)=(.*)$") { $stored[$matches[1]] = $matches[2] }
}
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$($stored.password)"))
$agents = Invoke-RestMethod -Uri "http://127.0.0.1:4096/agent" -Headers @{ Authorization = "Basic $basic" } -Method Get
$agentNames = @($agents) | ForEach-Object { $_.name ?? $_.id }
$ctbAgents = @($agentNames) | Where-Object { $_ -like "ctb-*" }
if ($ctbAgents.Count -lt 6) {
  throw "Backend nie widzi agentow ctb-* (znalezione: $($ctbAgents -join ', ')). Nie wlaczaj flagi -NativeAgents."
}
Write-Output ("[2/4] Backend widzi: " + ($ctbAgents -join ", "))

Write-Output "[3/4] Restart gatewaya 4097 z OPENCODE_MCP_NATIVE_AGENTS=on..."
& (Join-Path $PSScriptRoot "start-opencode-mcp.ps1") -Force -NativeAgents

Write-Output "[4/4] Uruchom finalne probe live:"
Write-Output "  node opencode-mcp\live-fallback-probe.mjs   # Ox normal -> no fallback; bad Ox -> exactly one Hy3 retry"
Write-Output "  node opencode-mcp\live-smoke.mjs            # READ/DIAGNOSE/PLAN + EXECUTE w worktree issue"
Write-Output "Nastepnie sprawdz w audycie resolvedAgent=ctb-* dla EXECUTE i dead-MCP status po restarcie."
