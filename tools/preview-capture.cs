// tools/preview-capture.cs — compiled by csc.exe at runtime (see src/core/preview-desktop.ts).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

static class Program {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

    static int Main(string[] a) {
        string title = null, outFile = null; uint pid = 0;
        for (int i = 0; i + 1 < a.Length; i += 2) {
            if (a[i] == "--title") title = a[i + 1];
            else if (a[i] == "--out") outFile = a[i + 1];
            else if (a[i] == "--pid") uint.TryParse(a[i + 1], out pid);
        }
        if (title == null || outFile == null) { Console.Error.WriteLine("usage: --title T [--pid N] --out F"); return 4; }
        try {
            SetProcessDPIAware();
            IntPtr found = IntPtr.Zero; IntPtr byPid = IntPtr.Zero; bool sawMinimized = false;
            EnumWindows((h, l) => {
                if (!IsWindowVisible(h)) return true;
                var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
                if (sb.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) return true;
                if (IsIconic(h)) { sawMinimized = true; return true; }
                uint p; GetWindowThreadProcessId(h, out p);
                if (pid != 0 && p == pid && byPid == IntPtr.Zero) byPid = h;
                if (found == IntPtr.Zero) found = h;
                return true;
            }, IntPtr.Zero);
            IntPtr hwnd = byPid != IntPtr.Zero ? byPid : found;
            if (hwnd == IntPtr.Zero) { Console.Error.WriteLine(sawMinimized ? "window minimized" : "window not found"); return 2; }
            RECT r; GetWindowRect(hwnd, out r);
            int w = r.R - r.L, hgt = r.B - r.T;
            if (w < 10 || hgt < 10) { Console.Error.WriteLine("window too small"); return 2; }
            using (var bmp = new Bitmap(w, hgt, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                bool ok = PrintWindow(hwnd, hdc, 2 /* PW_RENDERFULLCONTENT */);
                g.ReleaseHdc(hdc);
                if (!ok) { Console.Error.WriteLine("PrintWindow failed"); return 4; }
                if (IsBlank(bmp)) { Console.Error.WriteLine("blank image"); return 3; }
                bmp.Save(outFile, ImageFormat.Png);
            }
            return 0;
        } catch (Exception e) { Console.Error.WriteLine(e.Message); return 4; }
    }

    // Blank = every sampled pixel equals the first (all black or all white), on a 16x16 grid.
    static bool IsBlank(Bitmap b) {
        Color first = b.GetPixel(0, 0);
        for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
            Color c = b.GetPixel(x * (b.Width - 1) / 15, y * (b.Height - 1) / 15);
            if (c.ToArgb() != first.ToArgb()) return false;
        }
        return true;
    }
}
