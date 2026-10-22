$ErrorActionPreference = "SilentlyContinue"
$logDir = "C:\paperclip\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Listening($port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Start-KompasRegistryMcp {
  if (Listening 4173) { return }

  $node = (Get-Command node -ErrorAction Stop).Source
  $script = "C:\Kompas Zbiórek\scripts\ui-registry\shadcn-registry-server.mjs"
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $node
  $startInfo.Arguments = "`"$script`""
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  [void][System.Diagnostics.Process]::Start($startInfo)
}

Start-KompasRegistryMcp
& "C:\paperclip\start-paperclip.ps1" | Out-Null
& "C:\Kompas Zbiórek\paperclip-mcp\start-paperclip-local-mcp.ps1" | Out-Null

$budget = (Get-Date).AddSeconds(240)
while ((-not (Listening 3100)) -or (-not (Listening 3101))) {
  if ((Get-Date) -gt $budget) { break }
  Start-Sleep 2
}

$line = "{0} autostart: api3100={1} mcp3101={2} shadcn4173={3} storybook6006={4} bridges={5}" -f `
  (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `
  (Listening 3100), (Listening 3101), `
  (Listening 4173), (Listening 6006), `
  ((8931..8945 | Where-Object { Listening $_ }).Count)
Add-Content -Path "$logDir\autostart.log" -Value $line
