$ErrorActionPreference = "SilentlyContinue"
$node = "C:\Program Files\nodejs\node.exe"
$gateway = "C:\paperclip\mcp-sse-gateway.mjs"
$envFile = "C:\Users\milos\.paperclip\mcp.env"
$port = 3104
$logDir = "C:\paperclip\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Load-EnvFile($path) {
  if (-not (Test-Path $path)) { return }
  foreach ($line in Get-Content $path) {
    if ($line -match "^\s*([^#=]+)=(.*)$") {
      Set-Item -Path "Env:$($matches[1].Trim())" -Value $matches[2].Trim()
    }
  }
}
Load-EnvFile $envFile

# Lokalna instancja bez logowania: token wylaczony, jak w mostkach narzedzi.
# Publiczna bramka OAuth (3103) i wewnetrzna (3101) zostaja nietknie.
if ([string]::IsNullOrWhiteSpace($env:MCP_STDIO_CMD)) { throw "Brak MCP_STDIO_CMD w $envFile" }

$existing = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "[paperclip-local-mcp] juz dziala (port $port)"
  exit 0
}

$env:PORT = [string]$port
$env:MCP_GATEWAY_TOKEN = ""
Start-Process -FilePath $node -ArgumentList ('"' + $gateway + '"') -WorkingDirectory "C:\paperclip" `
  -RedirectStandardOutput "$logDir\paperclip-local-mcp.out.log" -RedirectStandardError "$logDir\paperclip-local-mcp.err.log" -WindowStyle Hidden | Out-Null

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { break }
  Start-Sleep -Milliseconds 300
}

$up = [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
Add-Content -Path "$logDir\autostart.log" -Value ("{0} paperclip-local-mcp: port{1}={2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $port, $up)
Write-Host "[paperclip-local-mcp] http://127.0.0.1:$port/mcp up=$up"
