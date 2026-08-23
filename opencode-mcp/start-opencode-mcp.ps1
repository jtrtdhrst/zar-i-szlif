$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $PSScriptRoot ".runtime"
$credentials = Join-Path $runtime "credentials.txt"
$node = (Get-Command node -ErrorAction Stop).Source
$opencode = (Get-Command opencode.cmd -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $runtime | Out-Null

if (-not (Test-Path -LiteralPath $credentials)) {
  $passwordBytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
  $password = [Convert]::ToBase64String($passwordBytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  @(
    "username=operator"
    "password=$password"
  ) | Set-Content -LiteralPath $credentials -Encoding ascii
  & icacls $credentials /inheritance:r /grant:r "$env:USERNAME:(R,W)" | Out-Null
}

$stored = @{}
foreach ($line in Get-Content -LiteralPath $credentials) {
  if ($line -match "^([^=]+)=(.*)$") { $stored[$matches[1]] = $matches[2] }
}
if (-not $stored.password) { throw "Brak hasła OAuth w $credentials." }

$env:OPENCODE_SERVER_USERNAME = "opencode"
$env:OPENCODE_SERVER_PASSWORD = $stored.password
$env:OPENCODE_MCP_USERNAME = $stored.username
$env:OPENCODE_MCP_PASSWORD = $stored.password
$env:OPENCODE_MCP_RUNTIME_DIR = $runtime
$env:OPENCODE_MCP_ISSUER = "https://opencode.kompaszbiorek.pl"
$env:PORT = "4097"
$env:MCP_ISSUER = "https://opencode.kompaszbiorek.pl"

if (-not (Get-NetTCPConnection -State Listen -LocalPort 4096 -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath $opencode -ArgumentList "serve --hostname 127.0.0.1 --port 4096" -WorkingDirectory $root -RedirectStandardOutput (Join-Path $runtime "opencode.out.log") -RedirectStandardError (Join-Path $runtime "opencode.err.log") -WindowStyle Hidden | Out-Null
}

$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$($stored.password)"))
$openCodeReady = $false
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:4096/global/health" -Headers @{ Authorization = "Basic $basic" } -Method Get
    if ($health.healthy) { $openCodeReady = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}
if (-not $openCodeReady) { throw "Serwer OpenCode na porcie 4096 nie odpowiada po 20 sekundach." }

if (Get-NetTCPConnection -State Listen -LocalPort 4097 -ErrorAction SilentlyContinue) {
  try {
    $gatewayHealth = Invoke-RestMethod -Uri "http://127.0.0.1:4097/health" -Method Get
    if ($gatewayHealth.engine -ne "AlaeddineMessadi/opencode-mcp@1.11.0" -or $gatewayHealth.policy -ne "ctb") {
      Get-NetTCPConnection -State Listen -LocalPort 4097 | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
      Start-Sleep -Seconds 1
    }
  } catch {
    Get-NetTCPConnection -State Listen -LocalPort 4097 | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
    Start-Sleep -Seconds 1
  }
}

if (-not (Get-NetTCPConnection -State Listen -LocalPort 4097 -ErrorAction SilentlyContinue)) {
  $gateway = Join-Path $PSScriptRoot "ctb-gateway.mjs"
  Start-Process -FilePath $node -ArgumentList ('"' + $gateway + '"') -WorkingDirectory $root -RedirectStandardOutput (Join-Path $runtime "gateway.out.log") -RedirectStandardError (Join-Path $runtime "gateway.err.log") -WindowStyle Hidden | Out-Null
}

Start-Sleep -Seconds 2
$health = Invoke-RestMethod -Uri "http://127.0.0.1:4097/health" -Method Get
if (-not $health.ok) { throw "Gateway OpenCode MCP nie przeszedł healthchecku." }
if ($health.engine -ne "AlaeddineMessadi/opencode-mcp@1.11.0" -or $health.policy -ne "ctb") { throw "Gateway CTB nie uruchomił engine upstream." }
Write-Output "OpenCode CTB MCP działa na http://127.0.0.1:4097/mcp"
