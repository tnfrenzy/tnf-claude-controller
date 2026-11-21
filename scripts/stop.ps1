# Dừng TNF CLI đang lắng nghe trên cổng (mặc định 4800) và các tiến trình claude con của nó.
param([int[]]$Ports = @(4800, 8000))
$conns = foreach ($Port in $Ports) { Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue }
if (-not $conns) { Write-Host "Không có server nào trên cổng $($Ports -join ", ")."; exit 0 }
foreach ($c in $conns | Select-Object -Unique OwningProcess) {
  Write-Host "Dừng cây tiến trình PID $($c.OwningProcess)..."
  taskkill /T /F /PID $c.OwningProcess | Out-Null
}
Write-Host "Đã dừng."
