# Dừng mọi tiến trình của bản cài TNF CLI (khay + server). Dùng khi gỡ cài / cài đè.
param([int]$Port = 4800)
$ErrorActionPreference = "SilentlyContinue"
$app = $PSScriptRoot
$nodeExe = Join-Path $app "node.exe"
$trayScript = Join-Path $app "tray.ps1"

$pids = @()
foreach ($p in Get-CimInstance Win32_Process) {
  if ($p.ExecutablePath -and ($p.ExecutablePath -ieq $nodeExe)) { $pids += $p.ProcessId }
  elseif ($p.CommandLine -and ($p.CommandLine -ilike "*$trayScript*") -and $p.ProcessId -ne $PID) { $pids += $p.ProcessId }
}
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen
if ($conn) { $pids += ($conn | Select-Object -ExpandProperty OwningProcess) }
foreach ($id in ($pids | Sort-Object -Unique)) {
  Write-Host "Dừng PID $id"
  & taskkill.exe /T /F /PID $id | Out-Null
}
if (-not $pids) { Write-Host "Không có tiến trình nào đang chạy." }
exit 0
