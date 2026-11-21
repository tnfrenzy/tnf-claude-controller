# Builds the app icons from installer/logo-source.png (black logo on a white background, roughly square).
# The logo is turned white on a transparent background (alpha = darkness of the source pixel).
# Outputs: ui/public/logo.png (128 px, white), ui/public/favicon-tn-*.png, icon-tn-*.png, favicon.ico (white logo on a black disc), installer/logo-256.png (white),
#          installer/tnf.ico (16..256 px: the white logo on a black disc, so the icon stays visible on light backgrounds).
# Run once after changing the source image, then commit the results. Windows PowerShell 5.1, ASCII only on purpose.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
public static class LogoWhite {
  // Centre-crop to a square, then white pixels whose alpha comes from how dark the source pixel is.
  public static Bitmap Make(string path, int outSize) { return Make(path, outSize, true); }
  public static Bitmap Make(string path, int outSize, bool white) {
    byte ink = white ? (byte)255 : (byte)0;
    using (Bitmap src = new Bitmap(path)) {
      int side = Math.Min(src.Width, src.Height);
      int ox = (src.Width - side) / 2, oy = (src.Height - side) / 2;
      Bitmap sq = new Bitmap(side, side, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(sq)) {
        g.Clear(Color.White);
        g.DrawImage(src, new Rectangle(0, 0, side, side), new Rectangle(ox, oy, side, side), GraphicsUnit.Pixel);
      }
      Rectangle r = new Rectangle(0, 0, side, side);
      BitmapData d = sq.LockBits(r, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      byte[] buf = new byte[d.Stride * side];
      Marshal.Copy(d.Scan0, buf, 0, buf.Length);
      for (int i = 0; i < buf.Length; i += 4) {
        double lum = 0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2]; // BGRA
        double a = (255.0 - lum) / 255.0;
        a = a < 0.04 ? 0 : (a > 0.96 ? 1 : a); // clean the paper noise and the solid core
        buf[i] = ink; buf[i + 1] = ink; buf[i + 2] = ink; buf[i + 3] = (byte)Math.Round(255 * a);
      }
      Marshal.Copy(buf, 0, d.Scan0, buf.Length);
      sq.UnlockBits(d);
      Bitmap big = new Bitmap(outSize, outSize, PixelFormat.Format32bppArgb);
      using (Graphics g = Graphics.FromImage(big)) {
        g.Clear(Color.Transparent);
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
        g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        g.DrawImage(sq, new Rectangle(0, 0, outSize, outSize));
      }
      sq.Dispose();
      return big;
    }
  }
}
"@ -ReferencedAssemblies System.Drawing

$srcFile = Join-Path $PSScriptRoot "logo-source.png"
if (-not (Test-Path $srcFile)) { throw "Missing $srcFile" }
$master = [LogoWhite]::Make($srcFile, 1024)

function Get-PngBytes([int]$size, [bool]$onDisc) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($onDisc) {
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 0, 0))
    $g.FillEllipse($brush, 0, 0, $size - 1, $size - 1)
    $brush.Dispose()
  }
  $g.DrawImage($master, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  return ,$ms.ToArray()
}

# ICO with PNG frames (Vista+): 6-byte header + 16 bytes per frame + data.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = foreach ($s in $sizes) { ,(Get-PngBytes $s $true) }
$out = Join-Path $PSScriptRoot "tnf.ico"
$fs = [System.IO.File]::Create($out)
$w = New-Object System.IO.BinaryWriter($fs)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $frames[$i].Length
  $b = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$b); $w.Write([byte]$b)
  $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
  $w.Write([uint32]$len); $w.Write([uint32]$offset)
  $offset += $len
}
foreach ($f in $frames) { $w.Write($f) }
$w.Close()
Write-Host "Wrote $out ($((Get-Item $out).Length) bytes)"

$pub = Join-Path (Split-Path $PSScriptRoot -Parent) "ui\public"
New-Item -ItemType Directory -Force $pub | Out-Null
[System.IO.File]::WriteAllBytes((Join-Path $pub "logo.png"), (Get-PngBytes 128 $false))
[System.IO.File]::WriteAllBytes((Join-Path $PSScriptRoot "logo-256.png"), (Get-PngBytes 256 $false))
# Browser tab and window icons: the white logo on a black disc (a white logo alone vanishes on a light tab).
# New file names (tn-*) so browsers do not keep serving a cached old favicon.
[System.IO.File]::WriteAllBytes((Join-Path $pub "favicon-tn-32.png"), (Get-PngBytes 32 $true))
[System.IO.File]::WriteAllBytes((Join-Path $pub "favicon-tn-64.png"), (Get-PngBytes 64 $true))
[System.IO.File]::WriteAllBytes((Join-Path $pub "icon-tn-192.png"), (Get-PngBytes 192 $true))
[System.IO.File]::WriteAllBytes((Join-Path $pub "icon-tn-512.png"), (Get-PngBytes 512 $true))
Copy-Item (Join-Path $PSScriptRoot "tnf.ico") (Join-Path $pub "favicon.ico") -Force
$master.Dispose()
Write-Host "Wrote ui/public/logo.png, favicon-tn-32/64.png, icon-tn-192/512.png, favicon.ico, installer/logo-256.png"

# README logos (GitHub light and dark themes): docs/assets/logo-white.png and logo-black.png, 512 px, transparent.
$assets = Join-Path (Split-Path $PSScriptRoot -Parent) "docs\assets"
New-Item -ItemType Directory -Force $assets | Out-Null
foreach ($pair in @(@("logo-white.png", $true), @("logo-black.png", $false))) {
  $b = [LogoWhite]::Make($srcFile, 512, [bool]$pair[1])
  $b.Save((Join-Path $assets $pair[0]), [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
}
Write-Host "Wrote docs/assets/logo-white.png, docs/assets/logo-black.png"
