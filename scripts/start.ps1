# Khởi động TNF CLI.
# Dùng:  .\scripts\start.ps1            -> chạy thật (tốn hạn mức thuê bao khi ra lệnh)
#        .\scripts\start.ps1 -Demo      -> CLI giả, phát lại fixture, không tốn token
#        .\scripts\start.ps1 -Port 4801
#        Không có -NoOpen: tự mở app trong cửa sổ riêng (Edge/Chrome --app) qua `tnf open`.
# Dừng:  Ctrl+C, hoặc .\scripts\stop.ps1 -Ports <cổng>  (stop.ps1 trần dừng cả 4800 và 8000).
param(
  [switch]$Demo,
  [int]$Port = 4800,
  [switch]$NoOpen
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if ($env:ANTHROPIC_API_KEY -and -not $Demo) {
  Write-Host "ANTHROPIC_API_KEY đang được đặt trong môi trường: chạy claude sẽ TÍNH PHÍ API." -ForegroundColor Red
  Write-Host "Gỡ biến (Remove-Item Env:ANTHROPIC_API_KEY) rồi chạy lại, hoặc dùng -Demo." -ForegroundColor Red
  exit 2
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Host "Cổng $Port đang bận (PID $($listener.OwningProcess)). Dùng -Port khác hoặc .\scripts\stop.ps1." -ForegroundColor Yellow
  exit 2
}

if (-not (Test-Path "$root\node_modules")) { npm install --no-fund --no-audit }
if (-not (Test-Path "$root\ui\dist\index.html")) { npm run build:ui }

if ($Demo) { $env:TNF_FAKE_CLAUDE = "1" } else { Remove-Item Env:TNF_FAKE_CLAUDE -ErrorAction SilentlyContinue }

$tsxArgs = @("src/cli.ts", "serve", "--port", "$Port")

# Mở app trong cửa sổ riêng: job nền chờ cổng lắng nghe rồi chạy `tnf open`; serve vẫn chạy tiền cảnh.
$openJob = $null
if (-not $NoOpen) {
  $openJob = Start-Job -ArgumentList $root, $Port -ScriptBlock {
    param($r, $p)
    $ErrorActionPreference = "SilentlyContinue"
    Set-Location $r
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      if (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) {
        npx tsx src/cli.ts open --port $p
        return
      }
      Start-Sleep -Milliseconds 500
    }
  }
}
try {
  npx tsx @tsxArgs
} finally {
  if ($openJob) { Remove-Job -Job $openJob -Force -ErrorAction SilentlyContinue }
}
