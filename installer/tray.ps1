# TNF CLI — biểu tượng khay hệ thống (Phase 5.6).
# Chạy server `node.exe dist\cli.js serve` ẩn, ghi log, mở giao diện đúng URL kèm token.
# Dùng:  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File tray.ps1 [-Demo] [-Port 4800] [-NoOpen]
#   -Demo : CLI giả (fixtures), không gọi Claude thật, không tốn hạn mức.
param(
  [switch]$Demo,
  [int]$Port = 4800,
  [switch]$NoOpen
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$app  = $PSScriptRoot
# data/workspace/logs live under %LOCALAPPDATA%\TNF\Controller regardless of where app\ was installed (no drive assumption).
$root = Join-Path $env:LOCALAPPDATA "TNF\Controller"
$data = Join-Path $root "data"
$logs = Join-Path $root "logs"
foreach ($d in @($data, $logs, (Join-Path $root "workspace"))) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }
$node    = Join-Path $app "node.exe"
$cli     = Join-Path $app "dist\cli.js"
$iconFile = Join-Path $app "tnf.ico"
$outLog  = Join-Path $logs "controller.log"
$errLog  = Join-Path $logs "controller.err.log"
$tokenFile = Join-Path $data "controller.token"
$title = "TNF CLI"
if ($Demo) { $title += " (demo)" }

# Một biểu tượng khay duy nhất.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\TNF.Controller.Tray", [ref]$created)
if (-not $created) {
  [System.Windows.Forms.MessageBox]::Show("TNF CLI đã chạy (xem biểu tượng ở khay hệ thống).", $title) | Out-Null
  exit 0
}

$script:server = $null

function Write-TrayLog([string]$msg) {
  Add-Content -Path $outLog -Value ("[{0}] [khay] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg) -Encoding UTF8
}

function Test-PortListening([int]$p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $p); return $true } catch { return $false } finally { $c.Close() }
}

function Get-UiUrl {
  if (-not (Test-Path $tokenFile)) { return $null }
  $tok = (Get-Content $tokenFile -Raw).Trim()
  if (-not $tok) { return $null }
  return "http://127.0.0.1:$Port/#token=$tok"
}

function Show-Balloon([string]$text, [string]$kind = "Info") {
  $icon.BalloonTipTitle = $title
  $icon.BalloonTipText = $text
  $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]$kind
  $icon.ShowBalloonTip(5000)
}

function Start-Server {
  if ($script:server -and -not $script:server.HasExited) { return $true }
  if (Test-PortListening $Port) {
    Write-TrayLog "Cổng $Port đang bận, không khởi động server."
    Show-Balloon "Cổng $Port đang bận (một controller khác đang chạy?). Dừng tiến trình kia rồi chọn 'Chạy lại'." "Error"
    return $false
  }
  if (-not (Test-Path $node) -or -not (Test-Path $cli)) {
    Show-Balloon "Thiếu node.exe hoặc dist\cli.js trong $app. Cài lại bộ cài." "Error"
    return $false
  }
  # Chế độ thuê bao: không để khóa API lọt vào tiến trình con (server cũng tự lọc, đây là lớp thứ hai).
  foreach ($k in @("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
  if ($Demo) {
    $env:TNF_FAKE_CLAUDE = "1"
    if (-not $env:FAKE_CLAUDE_GIT_COMMIT) { $env:FAKE_CLAUDE_GIT_COMMIT = "1" }
  } else {
    Remove-Item Env:TNF_FAKE_CLAUDE -ErrorAction SilentlyContinue
  }
  Add-Content -Path $outLog -Value ("`n==== {0} khởi động (port {1}, demo={2}) ====" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Port, [bool]$Demo) -Encoding UTF8
  $script:server = Start-Process -FilePath $node -ArgumentList @("`"$cli`"", "serve", "--port", "$Port") `
    -WorkingDirectory $app -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "server.out.log") -RedirectStandardError $errLog
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    if ($script:server.HasExited) { break }
    if (Test-PortListening $Port) { break }
  }
  if ($script:server.HasExited -or -not (Test-PortListening $Port)) {
    Write-TrayLog "Server không khởi động được (mã thoát $($script:server.ExitCode)). Xem $errLog"
    Show-Balloon "Server không khởi động được. Chọn 'Xem log' để biết lý do." "Error"
    return $false
  }
  Write-TrayLog "Server PID $($script:server.Id) đang nghe cổng $Port."
  return $true
}

function Stop-Server {
  if ($script:server -and -not $script:server.HasExited) {
    Write-TrayLog "Dừng server PID $($script:server.Id)."
    & taskkill.exe /T /F /PID $script:server.Id 2>&1 | Out-Null
  }
  $script:server = $null
}

function Find-AppBrowser {
  # Thứ tự: msedge.exe rồi chrome.exe; mỗi loại quét PATH, rồi ProgramFiles, ProgramFiles(x86), LOCALAPPDATA.
  $specs = @(
    @{ Exe = "msedge.exe"; Rel = "Microsoft\Edge\Application\msedge.exe" },
    @{ Exe = "chrome.exe"; Rel = "Google\Chrome\Application\chrome.exe" }
  )
  $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ }
  $dirs = @(($env:PATH -split ";") | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })
  foreach ($s in $specs) {
    foreach ($d in $dirs) {
      $p = Join-Path $d $s.Exe
      if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    }
    foreach ($r in $roots) {
      $p = Join-Path $r $s.Rel
      if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    }
  }
  return $null
}

function Open-Ui {
  if (-not (Test-PortListening $Port)) {
    if (-not (Start-Server)) { return }
  }
  $url = Get-UiUrl
  if (-not $url) { Show-Balloon "Chưa có mã truy cập (data\controller.token). Thử lại sau vài giây." "Warning"; return }
  $browser = Find-AppBrowser
  if ($browser) {
    $profile = Join-Path $data "app-profile"
    Start-Process -FilePath $browser -ArgumentList @("--app=$url", "--window-size=1280,860", "--user-data-dir=`"$profile`"")
  } else {
    Show-Balloon "Không tìm thấy Edge/Chrome, mở bằng trình duyệt mặc định." "Warning"
    Start-Process $url
  }
}

function Update-Menu {
  $running = $script:server -and -not $script:server.HasExited
  $miStop.Visible = [bool]$running
  $miStart.Visible = -not [bool]$running
  $icon.Text = if ($running) { "$title — đang chạy (cổng $Port)" } else { "$title — đã dừng" }
}

# ---- Khay ----
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = if (Test-Path $iconFile) { New-Object System.Drawing.Icon($iconFile) } else { [System.Drawing.SystemIcons]::Application }
$icon.Text = $title
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen  = $menu.Items.Add("Mở giao diện")
$miLog   = $menu.Items.Add("Xem log")
$miStop  = $menu.Items.Add("Dừng server")
$miStart = $menu.Items.Add("Chạy lại server")
$menu.Items.Add("-") | Out-Null
$miExit  = $menu.Items.Add("Thoát")
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$icon.ContextMenuStrip = $menu

$miOpen.add_Click({ Open-Ui; Update-Menu })
$miLog.add_Click({ if (Test-Path $outLog) { Start-Process notepad.exe $outLog } else { Show-Balloon "Chưa có log." } })
$miStop.add_Click({ Stop-Server; Update-Menu; Show-Balloon "Đã dừng server. Chọn 'Chạy lại server' để bật lại." })
$miStart.add_Click({ if (Start-Server) { Show-Balloon "Server đang chạy trên cổng $Port." }; Update-Menu })
$miExit.add_Click({ Stop-Server; $icon.Visible = $false; $icon.Dispose(); [System.Windows.Forms.Application]::Exit() })
$icon.add_DoubleClick({ Open-Ui; Update-Menu })

$ok = Start-Server
Update-Menu
if ($ok) {
  Show-Balloon "Đang chạy ở khay hệ thống. Nhấp đúp để mở giao diện."
  if (-not $NoOpen) { Open-Ui }
}

try {
  [System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))
} finally {
  Stop-Server
  $icon.Visible = $false
  $mutex.ReleaseMutex() | Out-Null
}
