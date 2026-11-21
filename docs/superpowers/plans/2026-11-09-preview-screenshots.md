# Xem trước (mức 1: ảnh chụp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm tab "Xem trước" ở trang Run: bấm nút để controller chụp ảnh website (375 px và 1280 px, Edge headless) hoặc cửa sổ phần mềm desktop (helper C# `PrintWindow`), lưu vào thư mục lưu tệp và hiện lưới ảnh.

**Architecture:** Cấu hình `preview` theo Môi trường (cột JSON ở `projects`). Mã thuần `preview-config.ts` (kiểm hợp lệ), `preview-web.ts` / `preview-desktop.ts` (bộ chụp, mọi phụ thuộc truyền vào để test không cần Edge), `preview.ts` (điều phối + ghi `preview.json`). `RunManager` giữ trạng thái đang chụp trong bộ nhớ; ba endpoint dưới `/api/runs/:id/preview`; ô tick quyền `preview` (tắt mặc định) do controller kiểm, không sinh luật `--allowedTools`. Không agent, không MCP, không tạo run.

**Tech Stack:** Node 24 + TypeScript (ESM, `.js` trong import), `node:sqlite`, vitest, React/Vite, Edge/Chrome headless có sẵn, `csc.exe` của .NET Framework có sẵn trong Windows.

**Spec:** `docs/superpowers/specs/2026-11-09-preview-screenshots-design.md`

## Global Constraints

- Nhánh `feat/preview-screenshots`; không đẩy lên remote; chỉ gộp vào `main` khi người dùng yêu cầu.
- Giao diện, thông báo lỗi hiển thị: tiếng Việt. Mã, tên biến, commit message, tên tệp: tiếng Anh. Khóa i18n có cả `vi` và `en` trong `ui/src/i18n.ts`.
- Spawn tiến trình **không qua shell** (CLAUDE.md quy tắc 4); lệnh người dùng khai báo được tách thành chương trình + đối số.
- URL web chỉ `http://localhost|127.0.0.1[:cổng]`. Đường dẫn ASCII, không dấu (quy tắc 10).
- Server chỉ bind `127.0.0.1`, mọi API cần token (quy tắc 5). Chụp phần mềm desktop bị từ chối khi qua đường hầm (`isViaTunnel(req)` ở `src/server/http.ts`).
- **Không sửa** `src/core/mcp-registry.ts`, `ui/src/components/McpSection.tsx` (phiên `agent-desktop-preset` đang làm). Ô tick trong `ui/src/components/GrantsSection.tsx` và `GROUP_FIELDS` **không làm trong kế hoạch này** (chờ nhánh đó gộp); test `grants-ui-logic.test.ts` đòi `GROUP_FIELDS` đúng 8 khóa nên đừng thêm `preview` vào đó. Ô tick tạm đặt trong tab Xem trước.
- Không gọi Claude thật. Máy tải nặng thì chạy test bằng `npx vitest run --maxWorkers=1 --testTimeout=120000`. Không dùng `rm -rf`; xóa thư mục trong mã bằng `fs.rmSync`.
- Commit: `git -c user.name=dev -c user.email=agent@example.com commit -m "<type>(<scope>): <desc>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Không nối `npm test | tail` bằng `&&` rồi commit: đọc dòng "Tests … passed".
- Sửa tệp bằng công cụ Edit/Write; không vá mã có escape bằng heredoc/`node -e` (Bash tool đổi `\n`).
- Chi phí = 0 token. Mọi chạy thật chỉ gọi Edge/Notepad/Calculator cục bộ.

## File Structure

| Tệp | Trách nhiệm |
|---|---|
| `src/core/preview-config.ts` (mới) | `PreviewConfig`, `validatePreview`, `splitCommand`, `pageSlug` |
| `src/core/preview-web.ts` (mới) | `edgeScreenshotArgs`, `waitReady`, `captureWeb` |
| `src/core/preview-desktop.ts` (mới) | `ensureHelper` (biên dịch C#), `captureDesktop` |
| `tools/preview-capture.cs` (mới) | helper `PrintWindow` → PNG, tự phát hiện ảnh rỗng |
| `src/core/preview.ts` (mới) | kiểu `PreviewJson`, `PreviewDeps`, `defaultPreviewDeps`, `runPreview`, `readPreviewJson` |
| `src/core/run-store.ts` | cột `preview`, `getProjectPreview/setProjectPreview` |
| `src/core/grants.ts` | khóa `preview` (tắt mặc định) |
| `src/core/run-manager.ts` | `getPreviewConfig/setPreviewConfig`, `startPreview`, `getPreviewState`, `previewFile` |
| `src/server/http.ts`, `src/server/index.ts` | route + truyền `previewDeps` |
| `scripts/package.ts` | chép `tools/preview-capture.cs` vào bản đóng gói |
| `ui/src/api.ts`, `ui/src/preview.ts`, `ui/src/components/PreviewTab.tsx`, `ui/src/runTabs.ts`, `ui/src/pages/RunPage.tsx`, `ui/src/i18n.ts` | giao diện |
| `tests/preview-*.test.ts`, `tests/preview-api.test.ts` | test |

---

### Task 0: Spike helper PrintWindow trên máy này

Mục đích: biết trước phần desktop có khả thi (Defender, ảnh đen). **Nếu thất bại: DỪNG phần desktop (Task 5), ghi vào SPIKE-RESULTS và hỏi người dùng về Alt+PrintScreen; các Task khác vẫn làm tiếp với desktop tạm trả lỗi "chưa hỗ trợ".**

**Files:**
- Create: `tools/preview-capture.cs`
- Modify: `docs/SPIKE-RESULTS.md` (thêm mục "Spike Xem trước: PrintWindow")

**Interfaces:**
- Produces: dòng lệnh `preview-capture.exe --title <chuỗi> [--pid <số>] --out <png>`; mã thoát `0` ok, `2` không thấy cửa sổ, `3` ảnh rỗng, `4` lỗi khác (thông báo ở stderr).

- [ ] **Step 1: Viết helper**

```csharp
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
            IntPtr found = IntPtr.Zero; IntPtr byPid = IntPtr.Zero;
            EnumWindows((h, l) => {
                if (!IsWindowVisible(h)) return true;
                var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
                if (sb.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) return true;
                uint p; GetWindowThreadProcessId(h, out p);
                if (pid != 0 && p == pid && byPid == IntPtr.Zero) byPid = h;
                if (found == IntPtr.Zero) found = h;
                return true;
            }, IntPtr.Zero);
            IntPtr hwnd = byPid != IntPtr.Zero ? byPid : found;
            if (hwnd == IntPtr.Zero) { Console.Error.WriteLine("window not found"); return 2; }
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
```

- [ ] **Step 2: Biên dịch và chạy trên Notepad** (PowerShell; ghi vào thư mục scratchpad, không vào repo)

```powershell
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$out = "$env:TEMP\tnf-preview-spike"; New-Item -ItemType Directory -Force $out | Out-Null
& $csc /nologo /target:exe /reference:System.Drawing.dll "/out:$out\preview-capture.exe" D:\tnf-claude-controller\tools\preview-capture.cs
$p = Start-Process notepad -PassThru; Start-Sleep 3
& "$out\preview-capture.exe" --title "Notepad" --pid $p.Id --out "$out\notepad.png"; "exit=$LASTEXITCODE"
Stop-Process -Id $p.Id -Force
```
Expected: biên dịch không lỗi, Defender không chặn, `exit=0`, `notepad.png` có nội dung (mở xem bằng công cụ Read).

- [ ] **Step 3: Lặp với Calculator** (`calc.exe`, tiêu đề "Calculator"/"Máy tính"; UWP có thể đổi PID, bỏ `--pid`). Ghi: có đen không, có bị Defender cảnh báo không.

- [ ] **Step 4: Ghi kết quả** vào `docs/SPIKE-RESULTS.md` (lệnh, mã thoát, kích thước ảnh, nhận xét Defender/GPU). Nếu `exit != 0` hoặc ảnh sai: ghi rõ, dừng và hỏi người dùng (xem đầu Task).

- [ ] **Step 5: Commit**

```bash
git add tools/preview-capture.cs docs/SPIKE-RESULTS.md
git -c user.name=dev -c user.email=agent@example.com commit -m "feat(preview): PrintWindow capture helper and spike result" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Cấu hình Xem trước và kiểm hợp lệ

**Files:**
- Create: `src/core/preview-config.ts`
- Test: `tests/preview-config.test.ts`

**Interfaces:**
- Produces:
```ts
export type PreviewConfig =
  | { kind: "none" }
  | { kind: "web"; startCommand: string; url: string; pages: string[]; readyTimeoutSec: number }
  | { kind: "desktop"; exePath: string; args: string[]; windowTitle: string; settleSec: number };
export const NO_PREVIEW: PreviewConfig;
export function validatePreview(raw: unknown, exists?: (p: string) => boolean): PreviewConfig; // throws Error(tiếng Việt)
export function splitCommand(line: string): string[]; // tách theo khoảng trắng, hỗ trợ "..." có khoảng trắng
export function pageSlug(page: string): string;       // "/" -> "home", "/a/b?x=1" -> "a-b-x-1"
```

- [ ] **Step 1: Viết test (thất bại)**

```ts
// tests/preview-config.test.ts
import { describe, expect, it } from "vitest";
import { NO_PREVIEW, pageSlug, splitCommand, validatePreview } from "../src/core/preview-config.js";

describe("validatePreview", () => {
  it("none / empty -> none", () => {
    expect(validatePreview(undefined)).toEqual(NO_PREVIEW);
    expect(validatePreview({ kind: "none" })).toEqual(NO_PREVIEW);
  });
  it("web: defaults and trimming", () => {
    const c = validatePreview({ kind: "web", startCommand: " npm run dev ", url: "http://localhost:5173", pages: [] });
    expect(c).toEqual({ kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/"], readyTimeoutSec: 60 });
  });
  it("web: rejects remote host, bad pages, empty command, too many pages", () => {
    const ok = { kind: "web", startCommand: "npm run dev", url: "http://localhost:3000", pages: ["/"] };
    expect(() => validatePreview({ ...ok, url: "http://example.com" })).toThrow(/localhost/);
    expect(() => validatePreview({ ...ok, url: "https://localhost:3000" })).toThrow(/http/);
    expect(() => validatePreview({ ...ok, startCommand: "  " })).toThrow(/lệnh/i);
    expect(() => validatePreview({ ...ok, pages: ["login"] })).toThrow(/bắt đầu bằng/);
    expect(() => validatePreview({ ...ok, pages: ["/a/../b"] })).toThrow(/\.\./);
    expect(() => validatePreview({ ...ok, pages: Array.from({ length: 13 }, (_, i) => `/p${i}`) })).toThrow(/12/);
  });
  it("web: timeout clamps to 5..300 via error", () => {
    const ok = { kind: "web", startCommand: "x", url: "http://127.0.0.1:1", pages: ["/"] };
    expect(() => validatePreview({ ...ok, readyTimeoutSec: 2 })).toThrow(/5/);
    expect(validatePreview({ ...ok, readyTimeoutSec: 120 })).toMatchObject({ readyTimeoutSec: 120 });
  });
  it("desktop: needs absolute ASCII existing .exe and a title", () => {
    const exists = () => true;
    const ok = { kind: "desktop", exePath: "C:\\Windows\\notepad.exe", windowTitle: "Notepad" };
    expect(validatePreview(ok, exists)).toEqual({ kind: "desktop", exePath: "C:\\Windows\\notepad.exe", args: [], windowTitle: "Notepad", settleSec: 3 });
    expect(() => validatePreview({ ...ok, exePath: "notepad.exe" }, exists)).toThrow(/tuyệt đối/);
    expect(() => validatePreview({ ...ok, exePath: "C:\\a\\Tài.exe" }, exists)).toThrow(/ASCII|không dấu/);
    expect(() => validatePreview({ ...ok, exePath: "C:\\a\\b.bat" }, exists)).toThrow(/\.exe/);
    expect(() => validatePreview(ok, () => false)).toThrow(/không tồn tại/);
    expect(() => validatePreview({ ...ok, windowTitle: "" }, exists)).toThrow(/tiêu đề/);
    expect(() => validatePreview({ ...ok, settleSec: 99 }, exists)).toThrow(/30/);
  });
  it("unknown kind throws", () => {
    expect(() => validatePreview({ kind: "x" })).toThrow(/loại/);
  });
});

describe("splitCommand / pageSlug", () => {
  it("splits with quotes", () => {
    expect(splitCommand('npm run dev -- --port 5173')).toEqual(["npm", "run", "dev", "--", "--port", "5173"]);
    expect(splitCommand('node "C:\\my app\\s.js" a')).toEqual(["node", "C:\\my app\\s.js", "a"]);
  });
  it("slugs", () => {
    expect(pageSlug("/")).toBe("home");
    expect(pageSlug("/login")).toBe("login");
    expect(pageSlug("/a/b?x=1")).toBe("a-b-x-1");
  });
});
```

- [ ] **Step 2: Chạy, thấy thất bại**

Run: `npx vitest run tests/preview-config.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Cài đặt**

```ts
// src/core/preview-config.ts
import fs from "node:fs";
import path from "node:path";

export type PreviewConfig =
  | { kind: "none" }
  | { kind: "web"; startCommand: string; url: string; pages: string[]; readyTimeoutSec: number }
  | { kind: "desktop"; exePath: string; args: string[]; windowTitle: string; settleSec: number };

export const NO_PREVIEW: PreviewConfig = { kind: "none" };

const ASCII = /^[\x20-\x7E]+$/;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function intIn(v: unknown, def: number, min: number, max: number, label: string): number {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} phải là số nguyên từ ${min} đến ${max}.`);
  return n;
}

export function validatePreview(raw: unknown, exists: (p: string) => boolean = fs.existsSync): PreviewConfig {
  if (raw === undefined || raw === null) return NO_PREVIEW;
  const r = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = r["kind"];
  if (kind === undefined || kind === "none") return NO_PREVIEW;
  if (kind === "web") {
    const startCommand = str(r["startCommand"]);
    if (!startCommand) throw new Error("Thiếu lệnh chạy máy chủ phát triển.");
    if (startCommand.length > 300) throw new Error("Lệnh chạy quá dài.");
    const url = str(r["url"]).replace(/\/+$/, "");
    let u: URL;
    try { u = new URL(url); } catch { throw new Error("Địa chỉ trang không hợp lệ."); }
    if (u.protocol !== "http:") throw new Error("Địa chỉ trang phải dùng http (máy chủ phát triển cục bộ).");
    if (u.hostname !== "localhost" && u.hostname !== "127.0.0.1") throw new Error("Địa chỉ trang chỉ được là localhost hoặc 127.0.0.1.");
    const pagesIn = Array.isArray(r["pages"]) ? (r["pages"] as unknown[]).map(str).filter(Boolean) : [];
    const pages = pagesIn.length ? pagesIn : ["/"];
    if (pages.length > 12) throw new Error("Tối đa 12 trang.");
    for (const p of pages) {
      if (!p.startsWith("/")) throw new Error(`Đường dẫn trang "${p}" phải bắt đầu bằng "/".`);
      if (p.split("/").includes("..")) throw new Error('Đường dẫn trang không được chứa "..".');
      if (!ASCII.test(p) || p.length > 200) throw new Error(`Đường dẫn trang "${p}" chỉ dùng ký tự ASCII, tối đa 200 ký tự.`);
    }
    return { kind: "web", startCommand, url, pages, readyTimeoutSec: intIn(r["readyTimeoutSec"], 60, 5, 300, "Thời gian đợi máy chủ (giây)") };
  }
  if (kind === "desktop") {
    const exePath = str(r["exePath"]);
    if (!exePath) throw new Error("Thiếu đường dẫn tệp .exe.");
    if (!path.win32.isAbsolute(exePath)) throw new Error("Đường dẫn .exe phải là đường dẫn tuyệt đối.");
    if (!ASCII.test(exePath)) throw new Error("Đường dẫn .exe chỉ nên dùng ký tự ASCII không dấu (quy ước của app).");
    if (!/\.exe$/i.test(exePath)) throw new Error("Tệp phải có đuôi .exe.");
    if (!exists(exePath)) throw new Error("Tệp .exe không tồn tại.");
    const windowTitle = str(r["windowTitle"]);
    if (!windowTitle) throw new Error("Thiếu tiêu đề cửa sổ để tìm cửa sổ cần chụp.");
    const args = Array.isArray(r["args"]) ? (r["args"] as unknown[]).map(String) : [];
    if (args.length > 10) throw new Error("Tối đa 10 đối số.");
    return { kind: "desktop", exePath, args, windowTitle, settleSec: intIn(r["settleSec"], 3, 1, 30, "Thời gian chờ cửa sổ vẽ xong (giây)") };
  }
  throw new Error("Loại xem trước không hợp lệ (web, desktop hoặc none).");
}

/** Whitespace split; "double quoted" parts may contain spaces. No escapes, no shell semantics. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]!);
  return out;
}

export function pageSlug(page: string): string {
  const s = page.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return s || "home";
}
```

- [ ] **Step 4: Chạy test, thấy qua**

Run: `npx vitest run tests/preview-config.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** (`feat(preview): config types and validation`).

---

### Task 2: Lưu cấu hình theo Môi trường + API cấu hình

**Files:**
- Modify: `src/core/run-store.ts` (migration cạnh dòng ~266; thêm hai phương thức cạnh `getProjectGrants`)
- Modify: `src/core/run-manager.ts` (cạnh `getGrants/setGrants`, dòng ~309-330)
- Modify: `src/server/http.ts` (route ngay sau khối `/api/grants`, dòng ~1445)
- Test: `tests/preview-store.test.ts`

**Interfaces:**
- Consumes: `PreviewConfig`, `validatePreview`, `NO_PREVIEW` (Task 1).
- Produces: `RunStore.getProjectPreview(name): PreviewConfig`, `RunStore.setProjectPreview(name, c: PreviewConfig | null): void`; `RunManager.getPreviewConfig(project): PreviewConfig`, `RunManager.setPreviewConfig(project, raw: unknown): PreviewConfig` (ném `Error("Không tìm thấy môi trường.")`); REST `GET /api/projects/<tên>/preview` → `{ preview }`, `PUT` body `{ preview }` → `{ preview }` (400 `bad_request` khi sai).

- [ ] **Step 1: Viết test**

```ts
// tests/preview-store.test.ts — mẫu tạo RunStore: xem tests/grants-store.test.ts (copy cách khởi tạo).
import { describe, expect, it } from "vitest";
// … khởi tạo store như grants-store.test.ts …
describe("project preview column", () => {
  it("defaults to none, round-trips, clears on null", () => {
    const store = makeStore(); // helper cục bộ copy từ grants-store.test.ts
    store.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(store.getProjectPreview("p")).toEqual({ kind: "none" });
    const c = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/"], readyTimeoutSec: 60 } as const;
    store.setProjectPreview("p", c);
    expect(store.getProjectPreview("p")).toEqual(c);
    store.setProjectPreview("p", null);
    expect(store.getProjectPreview("p")).toEqual({ kind: "none" });
  });
  it("migrates an old DB that lacks the column", () => { /* tạo bảng projects thiếu cột preview rồi mở RunStore: không ném */ });
});
```
(Đọc `tests/grants-store.test.ts` để lấy đúng cách khởi tạo và viết ca migration giống ca của cột `grants` nếu có.)

- [ ] **Step 2: Chạy, thấy thất bại** — `npx vitest run tests/preview-store.test.ts` → FAIL.

- [ ] **Step 3: Cài đặt**

`run-store.ts`, ngay sau dòng `if (!pcols.includes("grants")) ...`:
```ts
    if (!pcols.includes("preview")) this.db.exec("ALTER TABLE projects ADD COLUMN preview TEXT");
```
Thêm cạnh `setProjectGrants` (import `validatePreview, NO_PREVIEW, type PreviewConfig` từ `./preview-config.js`):
```ts
  getProjectPreview(name: string): PreviewConfig {
    const r = this.db.prepare("SELECT preview FROM projects WHERE name = ?").get(name) as Row | undefined;
    const raw = r?.["preview"];
    if (typeof raw !== "string" || !raw) return NO_PREVIEW;
    try { return validatePreview(JSON.parse(raw), () => true); } catch { return NO_PREVIEW; }
  }

  setProjectPreview(name: string, c: PreviewConfig | null): void {
    this.db.prepare("UPDATE projects SET preview = ? WHERE name = ?").run(c && c.kind !== "none" ? JSON.stringify(c) : null, name);
  }
```
(Đọc lại bằng `() => true` để không làm hỏng cấu hình đã lưu khi tệp .exe tạm thời không còn.)

`run-manager.ts` cạnh `setGrants`:
```ts
  getPreviewConfig(project: string): PreviewConfig {
    return this.store.getProjectPreview(project);
  }

  setPreviewConfig(project: string, raw: unknown): PreviewConfig {
    if (!this.store.getProject(project)) throw new Error("Không tìm thấy môi trường.");
    const c = validatePreview(raw);
    this.store.setProjectPreview(project, c);
    return c;
  }
```
`http.ts`, sau khối PUT grants (dùng `errorMessage`, `readBody`, `json` có sẵn):
```ts
    const prevM = /^\/api\/projects\/([^/]+)\/preview$/.exec(p);
    if (prevM) {
      const name = decodeURIComponent(prevM[1]!);
      if (method === "GET") {
        if (!manager.store.getProject(name)) return json(res, 404, { error: "not_found", message: "Không tìm thấy môi trường." });
        return json(res, 200, { preview: manager.getPreviewConfig(name) });
      }
      if (method === "PUT") {
        const body = (await readBody(req)) as Record<string, unknown>;
        try {
          return json(res, 200, { preview: manager.setPreviewConfig(name, body["preview"]) });
        } catch (e) {
          return json(res, 400, { error: "bad_request", ...errorMessage(e) });
        }
      }
    }
```
Kiểm tra `manager.store` có public không (đọc đoạn khai báo); nếu không, thêm phương thức `hasProject(name)` vào `RunManager`.

- [ ] **Step 4: Chạy test + typecheck** — `npx vitest run tests/preview-store.test.ts` và `npm run typecheck`. Expected: PASS, sạch.

- [ ] **Step 5: Commit** (`feat(preview): per-environment preview config and API`).

---

### Task 3: Khóa quyền `preview`

**Files:**
- Modify: `src/core/grants.ts` (interface `Grants`, `BOOL_KEYS`, `DEFAULT_GRANTS`)
- Modify: `ui/src/api.ts` (`GrantsView`)
- Test: `tests/grants.test.ts` (thêm ca)

**Interfaces:**
- Produces: `Grants.preview: boolean` (mặc định `false`). Không ảnh hưởng `grantsToAllowedTools`/`grantsToDisallowedTools`/`GROUP_RULES`.

- [ ] **Step 1: Thêm test vào `tests/grants.test.ts`**

```ts
describe("preview grant", () => {
  it("is off by default and survives sanitize", () => {
    expect(DEFAULT_GRANTS.preview).toBe(false);
    expect(sanitizeGrants({}).preview).toBe(false);
    expect(sanitizeGrants({ preview: true }).preview).toBe(true);
    expect(sanitizeGrants({ preview: "yes" }).preview).toBe(false);
  });
  it("adds no allow/deny rules", () => {
    const on = { ...DEFAULT_GRANTS, preview: true };
    expect(grantsToAllowedTools(on)).toEqual(grantsToAllowedTools(DEFAULT_GRANTS));
    expect(grantsToDisallowedTools(on, "D:/wt")).toEqual(grantsToDisallowedTools(DEFAULT_GRANTS, "D:/wt"));
  });
});
```
(Thêm import `DEFAULT_GRANTS, grantsToAllowedTools, grantsToDisallowedTools, sanitizeGrants` nếu thiếu.)

- [ ] **Step 2: Chạy** — `npx vitest run tests/grants.test.ts` → FAIL (`preview` undefined).

- [ ] **Step 3: Cài đặt** — trong `grants.ts`: thêm `preview: boolean;` vào `Grants` (sau `anyProcess`, với chú thích "controller checks this before launching a dev server/app for Xem trước; no CLI rules"); thêm `"preview"` vào `BOOL_KEYS`; thêm `preview: false,` vào `DEFAULT_GRANTS`. Trong `ui/src/api.ts` thêm `preview: boolean;` vào `GrantsView`.

- [ ] **Step 4: Chạy toàn bộ liên quan** — `npx vitest run tests/grants.test.ts tests/grants-store.test.ts tests/grants-ui-logic.test.ts tests/coding-launch-argv.test.ts` và `npm run typecheck`. Expected: PASS, sạch. Nếu test nào so sánh nguyên đối tượng `Grants` thì cập nhật kỳ vọng thêm `preview: false`.

- [ ] **Step 5: Commit** (`feat(grants): preview tick, off by default`).

---

### Task 4: Bộ chụp website

**Files:**
- Create: `src/core/preview-web.ts`
- Test: `tests/preview-web.test.ts`

**Interfaces:**
- Consumes: `PreviewConfig` (web), `splitCommand`, `pageSlug` (Task 1).
- Produces:
```ts
export interface ProcHandle { pid: number | undefined; onExit(cb: (code: number | null) => void): void; log(): string[]; }
export interface WebDeps {
  browserPath: string | null;
  spawnServer(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ProcHandle;
  killTree(pid: number): void;
  probe(url: string): Promise<number | null>;          // HTTP status or null if unreachable
  runBrowser(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; timedOut: boolean }>;
  sleep(ms: number): Promise<void>;
  fileOk(file: string): boolean;                      // exists and size > 0
  tmpProfile(): string;                               // fresh temp user-data-dir
  rmDir(dir: string): void;
}
export interface Shot { file: string; label: string; width: number; ok: boolean }
export interface WebResult { shots: Shot[]; error: string | null; logTail: string[] }
export const WEB_SIZES: Array<{ width: number; height: number }>; // 375x812, 1280x800
export function edgeScreenshotArgs(profile: string, w: number, h: number, outFile: string, url: string): string[];
export function waitReady(url: string, timeoutMs: number, deps: Pick<WebDeps, "probe" | "sleep">, serverExited: () => boolean): Promise<boolean>;
export function captureWeb(cfg: Extract<PreviewConfig, { kind: "web" }>, ctx: { cwd: string; outDir: string; onStep: (s: string) => void }, deps: WebDeps): Promise<WebResult>;
```

- [ ] **Step 1: Viết test**

```ts
// tests/preview-web.test.ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { captureWeb, edgeScreenshotArgs, waitReady, type WebDeps } from "../src/core/preview-web.js";

const cfg = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/login"], readyTimeoutSec: 5 } as const;

function deps(over: Partial<WebDeps> = {}): { d: WebDeps; calls: string[]; killed: number[]; shots: string[] } {
  const calls: string[] = [], killed: number[] = [], shots: string[] = [];
  const d: WebDeps = {
    browserPath: "C:\\edge.exe",
    spawnServer: (cmd, args, o) => { calls.push(`spawn ${cmd} ${args.join(" ")} @${o.cwd}`); return { pid: 77, onExit: () => undefined, log: () => ["vite ready"] }; },
    killTree: (pid) => { killed.push(pid); },
    probe: async () => 200,
    runBrowser: async (_e, args) => { const f = args.find((a) => a.startsWith("--screenshot="))!.slice(13); shots.push(path.basename(f)); return { code: 0, timedOut: false }; },
    sleep: async () => undefined,
    fileOk: () => true,
    tmpProfile: () => "C:\\tmp\\p",
    rmDir: () => undefined,
    ...over,
  };
  return { d, calls, killed, shots };
}

describe("edgeScreenshotArgs", () => {
  it("builds headless args", () => {
    const a = edgeScreenshotArgs("C:\\p", 375, 812, "C:\\o\\x.png", "http://localhost:5173/");
    expect(a).toContain("--headless");
    expect(a).toContain("--window-size=375,812");
    expect(a).toContain("--screenshot=C:\\o\\x.png");
    expect(a).toContain("--user-data-dir=C:\\p");
    expect(a[a.length - 1]).toBe("http://localhost:5173/");
  });
});

describe("waitReady", () => {
  it("true when probe answers < 500", async () => {
    expect(await waitReady("http://x", 1000, { probe: async () => 404, sleep: async () => undefined }, () => false)).toBe(true);
  });
  it("false on server error / unreachable until timeout", async () => {
    let t = 0;
    const sleep = async (ms: number) => { t += ms; };
    expect(await waitReady("http://x", 2000, { probe: async () => (t > 5000 ? 200 : null), sleep }, () => false)).toBe(false);
  });
  it("false at once when the server already exited", async () => {
    expect(await waitReady("http://x", 60000, { probe: async () => null, sleep: async () => undefined }, () => true)).toBe(false);
  });
});

describe("captureWeb", () => {
  it("captures every page at both widths and kills the server", async () => {
    const { d, calls, killed, shots } = deps();
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toBeNull();
    expect(shots).toEqual(["home-375.png", "home-1280.png", "login-375.png", "login-1280.png"]);
    expect(r.shots.every((s) => s.ok)).toBe(true);
    expect(calls[0]).toBe("spawn npm run dev @D:\\wt");
    expect(killed).toEqual([77]);
  });
  it("reports a clear error and kills the server when it never gets ready", async () => {
    const { d, killed } = deps({ probe: async () => null });
    const r = await captureWeb({ ...cfg, readyTimeoutSec: 5 }, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toMatch(/máy chủ/i);
    expect(r.logTail).toEqual(["vite ready"]);
    expect(r.shots).toEqual([]);
    expect(killed).toEqual([77]);
  });
  it("marks a shot not ok when the browser times out or leaves no file", async () => {
    const { d } = deps({ runBrowser: async () => ({ code: null, timedOut: true }), fileOk: () => false });
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.shots.every((s) => !s.ok)).toBe(true);
  });
  it("errors without a browser, before starting the server", async () => {
    const { d, calls } = deps({ browserPath: null });
    const r = await captureWeb(cfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toMatch(/Edge|Chrome/);
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy** — `npx vitest run tests/preview-web.test.ts` → FAIL.

- [ ] **Step 3: Cài đặt `src/core/preview-web.ts`**

```ts
import path from "node:path";
import { pageSlug, splitCommand, type PreviewConfig } from "./preview-config.js";

export interface ProcHandle { pid: number | undefined; onExit(cb: (code: number | null) => void): void; log(): string[] }
export interface WebDeps {
  browserPath: string | null;
  spawnServer(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): ProcHandle;
  killTree(pid: number): void;
  probe(url: string): Promise<number | null>;
  runBrowser(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; timedOut: boolean }>;
  sleep(ms: number): Promise<void>;
  fileOk(file: string): boolean;
  tmpProfile(): string;
  rmDir(dir: string): void;
}
export interface Shot { file: string; label: string; width: number; ok: boolean }
export interface WebResult { shots: Shot[]; error: string | null; logTail: string[] }

export const WEB_SIZES = [{ width: 375, height: 812 }, { width: 1280, height: 800 }];

export function edgeScreenshotArgs(profile: string, w: number, h: number, outFile: string, url: string): string[] {
  return ["--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run", `--user-data-dir=${profile}`, `--window-size=${w},${h}`, "--virtual-time-budget=5000", `--screenshot=${outFile}`, url];
}

export async function waitReady(url: string, timeoutMs: number, deps: Pick<WebDeps, "probe" | "sleep">, serverExited: () => boolean): Promise<boolean> {
  let waited = 0;
  while (waited <= timeoutMs) {
    if (serverExited()) return false;
    const s = await deps.probe(url);
    if (s !== null && s < 500) return true;
    await deps.sleep(500);
    waited += 500;
  }
  return false;
}

export async function captureWeb(
  cfg: Extract<PreviewConfig, { kind: "web" }>,
  ctx: { cwd: string; outDir: string; onStep: (s: string) => void },
  deps: WebDeps,
): Promise<WebResult> {
  if (!deps.browserPath) return { shots: [], error: "Không tìm thấy Edge hoặc Chrome để chụp ảnh.", logTail: [] };
  const [cmd, ...args] = splitCommand(cfg.startCommand);
  if (!cmd) return { shots: [], error: "Thiếu lệnh chạy máy chủ phát triển.", logTail: [] };
  const port = new URL(cfg.url).port;
  const env: NodeJS.ProcessEnv = { ...process.env, BROWSER: "none", ...(port ? { PORT: port } : {}) };
  ctx.onStep("Đang khởi động máy chủ phát triển");
  const server = deps.spawnServer(cmd, args, { cwd: ctx.cwd, env });
  let exited = false;
  server.onExit(() => { exited = true; });
  const shots: Shot[] = [];
  try {
    ctx.onStep("Đang đợi máy chủ sẵn sàng");
    const ready = await waitReady(cfg.url, cfg.readyTimeoutSec * 1000, deps, () => exited);
    if (!ready) {
      const why = exited ? "Máy chủ phát triển đã thoát trước khi sẵn sàng." : `Máy chủ không phản hồi tại ${cfg.url} sau ${cfg.readyTimeoutSec} giây (kiểm tra lệnh chạy và cổng).`;
      return { shots, error: why, logTail: server.log().slice(-20) };
    }
    const profile = deps.tmpProfile();
    try {
      for (const page of cfg.pages) {
        for (const size of WEB_SIZES) {
          const name = `${pageSlug(page)}-${size.width}.png`;
          const file = path.join(ctx.outDir, name);
          ctx.onStep(`Đang chụp ${page} (${size.width} px)`);
          const r = await deps.runBrowser(deps.browserPath, edgeScreenshotArgs(profile, size.width, size.height, file, cfg.url + page), 40_000);
          shots.push({ file: name, label: page, width: size.width, ok: !r.timedOut && deps.fileOk(file) });
        }
      }
    } finally {
      deps.rmDir(profile);
    }
    return { shots, error: null, logTail: server.log().slice(-20) };
  } finally {
    if (server.pid !== undefined) deps.killTree(server.pid);
  }
}
```

- [ ] **Step 4: Chạy test** — Expected: PASS. Chạy `npm run typecheck`.

- [ ] **Step 5: Commit** (`feat(preview): website capture with headless Edge`).

---

### Task 5: Bộ chụp phần mềm desktop

*Chỉ làm khi Task 0 thành công (hoặc sau khi người dùng chọn phương án khác).*

**Files:**
- Create: `src/core/preview-desktop.ts`
- Test: `tests/preview-desktop.test.ts`
- Modify: `scripts/package.ts` (chép `tools/preview-capture.cs`, cạnh dòng chép `tools/cad`)

**Interfaces:**
- Consumes: `PreviewConfig` (desktop), `Shot`, `ProcHandle` (Task 4).
- Produces:
```ts
export interface DesktopDeps {
  helperExe(): Promise<string>;                         // đường dẫn exe đã biên dịch; ném Error tiếng Việt nếu không biên dịch được
  spawnApp(exe: string, args: string[]): ProcHandle;
  killTree(pid: number): void;
  closeApp(pid: number): Promise<void>;                 // CloseMainWindow rồi taskkill sau 3 giây
  runHelper(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean }>;
  sleep(ms: number): Promise<void>;
  fileOk(file: string): boolean;
}
export interface DesktopResult { shots: Shot[]; error: string | null }
export const HELPER_EXIT_MESSAGES: Record<number, string>; // 2, 3, 4 -> tiếng Việt
export function captureDesktop(cfg: Extract<PreviewConfig, { kind: "desktop" }>, ctx: { outDir: string; onStep: (s: string) => void }, deps: DesktopDeps): Promise<DesktopResult>;
export function compileHelper(srcFile: string, outExe: string, run: (exe: string, args: string[]) => { code: number | null; stderr: string }, cscPath: string | null): void; // ném Error nếu cscPath null hoặc lỗi
export function cscPath(env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean): string | null; // %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

- [ ] **Step 1: Viết test** (`tests/preview-desktop.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { captureDesktop, compileHelper, cscPath, type DesktopDeps } from "../src/core/preview-desktop.js";

const cfg = { kind: "desktop", exePath: "C:\\a\\app.exe", args: ["--x"], windowTitle: "My App", settleSec: 3 } as const;
function deps(over: Partial<DesktopDeps> = {}) {
  const log: string[] = [];
  const d: DesktopDeps = {
    helperExe: async () => "C:\\d\\preview-capture.exe",
    spawnApp: (e, a) => { log.push(`spawn ${e} ${a.join(" ")}`); return { pid: 55, onExit: () => undefined, log: () => [] }; },
    killTree: (p) => { log.push(`kill ${p}`); },
    closeApp: async (p) => { log.push(`close ${p}`); },
    runHelper: async (_e, a) => { log.push(`helper ${a.join("|")}`); return { code: 0, stderr: "", timedOut: false }; },
    sleep: async (ms) => { log.push(`sleep ${ms}`); },
    fileOk: () => true,
    ...over,
  };
  return { d, log };
}

describe("captureDesktop", () => {
  it("launches, waits settle time, captures, closes", async () => {
    const { d, log } = deps();
    const r = await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toBeNull();
    expect(r.shots).toEqual([{ file: "window.png", label: "My App", width: 0, ok: true }]);
    expect(log[0]).toBe("spawn C:\\a\\app.exe --x");
    expect(log).toContain("sleep 3000");
    expect(log.find((l) => l.startsWith("helper"))).toBe("helper --title|My App|--pid|55|--out|D:\\out\\window.png");
    expect(log[log.length - 1]).toBe("close 55");
  });
  it("maps helper exit codes to Vietnamese messages and still closes the app", async () => {
    for (const [code, re] of [[2, /không thấy cửa sổ/i], [3, /rỗng/i], [4, /lỗi/i]] as const) {
      const { d, log } = deps({ runHelper: async () => ({ code, stderr: "boom", timedOut: false }) });
      const r = await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d);
      expect(r.error).toMatch(re);
      expect(r.shots).toEqual([]);
      expect(log[log.length - 1]).toBe("close 55");
    }
  });
  it("reports a helper compile failure without launching the app", async () => {
    const { d, log } = deps({ helperExe: async () => { throw new Error("Không biên dịch được helper chụp cửa sổ."); } });
    const r = await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d);
    expect(r.error).toMatch(/biên dịch/);
    expect(log).toEqual([]);
  });
  it("reports timeout", async () => {
    const { d } = deps({ runHelper: async () => ({ code: null, stderr: "", timedOut: true }) });
    expect((await captureDesktop(cfg, { outDir: "D:\\out", onStep: () => undefined }, d)).error).toMatch(/quá thời gian/);
  });
});

describe("compileHelper / cscPath", () => {
  it("fails clearly without csc", () => {
    expect(() => compileHelper("a.cs", "a.exe", () => ({ code: 0, stderr: "" }), null)).toThrow(/csc/i);
  });
  it("throws on a compiler error with its message", () => {
    expect(() => compileHelper("a.cs", "a.exe", () => ({ code: 1, stderr: "error CS1002" }), "C:\\csc.exe")).toThrow(/CS1002/);
  });
  it("finds csc under WINDIR", () => {
    expect(cscPath({ WINDIR: "C:\\Windows" }, () => true)).toBe("C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe");
    expect(cscPath({ WINDIR: "C:\\Windows" }, () => false)).toBeNull();
  });
});
```

- [ ] **Step 2: Chạy** → FAIL.

- [ ] **Step 3: Cài đặt `src/core/preview-desktop.ts`**

```ts
import path from "node:path";
import type { PreviewConfig } from "./preview-config.js";
import type { ProcHandle, Shot } from "./preview-web.js";

export interface DesktopDeps {
  helperExe(): Promise<string>;
  spawnApp(exe: string, args: string[]): ProcHandle;
  killTree(pid: number): void;
  closeApp(pid: number): Promise<void>;
  runHelper(exe: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean }>;
  sleep(ms: number): Promise<void>;
  fileOk(file: string): boolean;
}
export interface DesktopResult { shots: Shot[]; error: string | null }

export const HELPER_EXIT_MESSAGES: Record<number, string> = {
  2: "Không thấy cửa sổ khớp tiêu đề đã khai báo (kiểm tra tiêu đề cửa sổ, hoặc tăng thời gian chờ).",
  3: "Ảnh rỗng (toàn đen hoặc toàn trắng): ứng dụng có thể vẽ bằng GPU nên không chụp được kiểu này.",
  4: "Lỗi khi chụp cửa sổ.",
};

export function cscPath(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = (p) => require("node:fs").existsSync(p)): string | null {
  const win = env["WINDIR"] ?? env["SystemRoot"];
  if (!win) return null;
  const p = path.win32.join(win, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  return exists(p) ? p : null;
}

export function compileHelper(
  srcFile: string,
  outExe: string,
  run: (exe: string, args: string[]) => { code: number | null; stderr: string },
  csc: string | null,
): void {
  if (!csc) throw new Error("Không tìm thấy csc.exe của .NET Framework để biên dịch helper chụp cửa sổ.");
  const r = run(csc, ["/nologo", "/target:exe", "/reference:System.Drawing.dll", `/out:${outExe}`, srcFile]);
  if (r.code !== 0) throw new Error(`Không biên dịch được helper chụp cửa sổ: ${r.stderr.trim().slice(0, 300)}`);
}

export async function captureDesktop(
  cfg: Extract<PreviewConfig, { kind: "desktop" }>,
  ctx: { outDir: string; onStep: (s: string) => void },
  deps: DesktopDeps,
): Promise<DesktopResult> {
  let helper: string;
  try {
    helper = await deps.helperExe();
  } catch (e) {
    return { shots: [], error: e instanceof Error ? e.message : String(e) };
  }
  ctx.onStep("Đang mở ứng dụng");
  const app = deps.spawnApp(cfg.exePath, cfg.args);
  try {
    ctx.onStep("Đang đợi cửa sổ vẽ xong");
    await deps.sleep(cfg.settleSec * 1000);
    ctx.onStep("Đang chụp cửa sổ");
    const out = path.join(ctx.outDir, "window.png");
    const r = await deps.runHelper(helper, ["--title", cfg.windowTitle, ...(app.pid !== undefined ? ["--pid", String(app.pid)] : []), "--out", out], 30_000);
    if (r.timedOut) return { shots: [], error: "Chụp cửa sổ quá thời gian." };
    if (r.code !== 0) {
      const msg = HELPER_EXIT_MESSAGES[r.code ?? 4] ?? HELPER_EXIT_MESSAGES[4]!;
      return { shots: [], error: r.stderr.trim() && r.code === 4 ? `${msg} (${r.stderr.trim().slice(0, 200)})` : msg };
    }
    if (!deps.fileOk(out)) return { shots: [], error: "Không tạo được tệp ảnh." };
    return { shots: [{ file: "window.png", label: cfg.windowTitle, width: 0, ok: true }], error: null };
  } finally {
    if (app.pid !== undefined) await deps.closeApp(app.pid);
  }
}
```
(Trong repo ESM, thay `require("node:fs")` bằng `import fs from "node:fs"` ở đầu tệp và dùng `fs.existsSync`.)

`scripts/package.ts`: ngay sau dòng chép `tools/cad` thêm
```ts
  fs.mkdirSync(path.join(OUT, "tools"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "tools", "preview-capture.cs"), path.join(OUT, "tools", "preview-capture.cs"));
```
(kiểm `OUT/tools` đã được `copyDir` tạo; nếu có, bỏ dòng `mkdirSync`).

- [ ] **Step 4: Chạy test** → PASS; `npm run typecheck`.

- [ ] **Step 5: Commit** (`feat(preview): desktop window capture via PrintWindow helper`).

---

### Task 6: Điều phối, quản lý trạng thái và API chụp

**Files:**
- Create: `src/core/preview.ts`
- Modify: `src/core/run-manager.ts` (tùy chọn `previewDeps`, ba phương thức)
- Modify: `src/server/index.ts` (truyền `previewDeps`, cạnh `openPath` dòng ~35 và ~52)
- Modify: `src/server/http.ts` (route con của `/api/runs/:id/…`, cạnh `open-output` dòng ~1839)
- Test: `tests/preview-run.test.ts`, `tests/preview-api.test.ts`

**Interfaces:**
- Consumes: `captureWeb/WebDeps`, `captureDesktop/DesktopDeps`, `validatePreview`, `resolveInside` (`outputs.ts`), `Grants.preview`.
- Produces:
```ts
// src/core/preview.ts
export interface PreviewJson { kind: "web" | "desktop"; started_at: number; finished_at: number; status: "ok" | "partial" | "error"; shots: Shot[]; error: string | null; log_tail: string[] }
export interface PreviewDeps { web: WebDeps; desktop: DesktopDeps }
export function defaultPreviewDeps(dataDir: string, repoRoot: string): PreviewDeps; // thật: spawn không shell, taskkill, fetch, csc, locateBrowser
export function runPreview(cfg: PreviewConfig, ctx: { cwd: string; outDir: string; onStep: (s: string) => void }, deps: PreviewDeps, now?: () => number): Promise<PreviewJson>;
export function readPreviewJson(outDir: string): PreviewJson | null;
// RunManager
export type PreviewState = { status: "idle" | "running" | "ok" | "partial" | "error"; step: string | null; result: PreviewJson | null };
startPreview(runId: string, opts: { viaTunnel: boolean }): PreviewState  // ném PreviewError(code, message)
getPreviewState(runId: string): PreviewState
previewFile(runId: string, file: string): string | null // đường dẫn tuyệt đối PNG hợp lệ hoặc null
export class PreviewError extends Error { constructor(public code: "not_found"|"bad_request"|"forbidden"|"conflict", message: string) }
```
- REST: `POST /api/runs/:id/preview` → 202 `{state}`; mã lỗi map: not_found→404, bad_request→400, forbidden→403, conflict→409. `GET /api/runs/:id/preview` → `{ state, config }`. `GET /api/runs/:id/preview/<file>` → `image/png`, `cache-control: no-store`.

Quy tắc `startPreview` (theo thứ tự):
1. Run không tồn tại → `not_found` "Không tìm thấy lần chạy."
2. `run.project` rỗng hoặc cấu hình `none` → `bad_request` "Môi trường chưa khai báo Xem trước."
3. `getGrants(run.project).grants.preview !== true` → `forbidden` "Chưa bật quyền chạy ứng dụng/máy chủ để xem trước (tab Xem trước hoặc Cài đặt > Cấp quyền)."
4. cấu hình `desktop` và `opts.viaTunnel` → `forbidden` "Chụp phần mềm desktop chỉ làm được trên máy chạy app."
5. cấu hình `web` và (`worktree_path` rỗng hoặc `!worktreeExists(run)`) → `bad_request` "Worktree của lần chạy đã bị dọn."
6. đang `running` cho run này → `conflict` "Đang chụp, hãy đợi xong."
7. Xóa `<outputDir>/<runId>/preview/` (nếu có) bằng `fs.rmSync(..., {recursive:true, force:true})`, tạo lại, chạy `runPreview` nền (không await), cập nhật `step`, khi xong ghi `preview.json` và đặt `status`.

- [ ] **Step 1: Test lõi (`tests/preview-run.test.ts`)** — dùng deps giả như Task 4/5:

```ts
import { describe, expect, it } from "vitest";
import { runPreview } from "../src/core/preview.js";
// webDeps()/desktopDeps(): copy hai hàm dựng deps giả từ tests/preview-web.test.ts và tests/preview-desktop.test.ts.

describe("runPreview", () => {
  it("web ok -> status ok, timestamps from now()", async () => {
    let t = 1000; const now = () => (t += 10);
    const j = await runPreview(webCfg, { cwd: "D:\\wt", outDir: "D:\\out", onStep: () => undefined }, { web: webDeps(), desktop: desktopDeps() }, now);
    expect(j).toMatchObject({ kind: "web", status: "ok", error: null });
    expect(j.finished_at).toBeGreaterThan(j.started_at);
    expect(j.shots).toHaveLength(4);
  });
  it("partial when some shots failed", async () => { /* fileOk trả false cho một tệp -> status "partial" */ });
  it("error when the capture reports an error", async () => { /* probe null -> status "error", error có chữ "máy chủ" */ });
  it("desktop ok", async () => { /* status "ok", shots[0].file "window.png" */ });
  it("kind none throws", async () => { await expect(runPreview({ kind: "none" }, ctx, deps)).rejects.toThrow(); });
});
```
(Viết đủ thân từng `it`; không để chú thích thay mã.)

- [ ] **Step 2: Chạy** → FAIL.

- [ ] **Step 3: Cài đặt `src/core/preview.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import type { PreviewConfig } from "./preview-config.js";
import { captureWeb, type ProcHandle, type Shot, type WebDeps } from "./preview-web.js";
import { captureDesktop, compileHelper, cscPath, type DesktopDeps } from "./preview-desktop.js";
import { locateBrowser } from "./browser-locator.js";

export interface PreviewJson { kind: "web" | "desktop"; started_at: number; finished_at: number; status: "ok" | "partial" | "error"; shots: Shot[]; error: string | null; log_tail: string[] }
export interface PreviewDeps { web: WebDeps; desktop: DesktopDeps }

export async function runPreview(cfg: PreviewConfig, ctx: { cwd: string; outDir: string; onStep: (s: string) => void }, deps: PreviewDeps, now: () => number = Date.now): Promise<PreviewJson> {
  if (cfg.kind === "none") throw new Error("Môi trường chưa khai báo Xem trước.");
  const started_at = now();
  const r = cfg.kind === "web"
    ? await captureWeb(cfg, ctx, deps.web)
    : { ...(await captureDesktop(cfg, ctx, deps.desktop)), logTail: [] as string[] };
  const okCount = r.shots.filter((s) => s.ok).length;
  const status: PreviewJson["status"] = r.error || okCount === 0 ? "error" : okCount < r.shots.length ? "partial" : "ok";
  return { kind: cfg.kind, started_at, finished_at: now(), status, shots: r.shots, error: r.error ?? (okCount === 0 ? "Không chụp được ảnh nào." : null), log_tail: r.logTail };
}

export function readPreviewJson(outDir: string): PreviewJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(outDir, "preview.json"), "utf8")) as PreviewJson;
  } catch {
    return null;
  }
}

function logOf(child: ReturnType<typeof spawn>): { lines: string[]; handle: ProcHandle } {
  const lines: string[] = [];
  const push = (b: Buffer) => { for (const l of b.toString("utf8").split(/\r?\n/)) if (l.trim()) { lines.push(l.slice(0, 300)); if (lines.length > 200) lines.shift(); } };
  child.stdout?.on("data", push);
  child.stderr?.on("data", push);
  return { lines, handle: { pid: child.pid, onExit: (cb) => { child.once("exit", cb); child.once("error", () => cb(null)); }, log: () => lines.slice() } };
}

function killTree(pid: number): void {
  try { spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { windowsHide: true }); } catch { /* already gone */ }
}

export function defaultPreviewDeps(dataDir: string, repoRoot: string): PreviewDeps {
  const fileOk = (f: string) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const runExe = (exe: string, args: string[], timeoutMs: number) => new Promise<{ code: number | null; stderr: string; timedOut: boolean }>((resolve) => {
    const c = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; let timedOut = false;
    c.stderr?.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
    const t = setTimeout(() => { timedOut = true; if (c.pid) killTree(c.pid); }, timeoutMs);
    c.once("exit", (code) => { clearTimeout(t); resolve({ code, stderr, timedOut }); });
    c.once("error", (e) => { clearTimeout(t); resolve({ code: null, stderr: String(e), timedOut: false }); });
  });
  const web: WebDeps = {
    browserPath: locateBrowser()?.path ?? null,
    spawnServer: (cmd, args, o) => {
      // npm/npx are .cmd shims on Windows; "cmd /c" runs them without composing a shell string from user text.
      const isCmd = /^(npm|npx|pnpm|yarn)$/i.test(cmd);
      const child = isCmd ? spawn("cmd.exe", ["/d", "/s", "/c", cmd, ...args], { cwd: o.cwd, env: o.env, windowsHide: true }) : spawn(cmd, args, { cwd: o.cwd, env: o.env, windowsHide: true });
      return logOf(child).handle;
    },
    killTree,
    probe: async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); return r.status; } catch { return null; } },
    runBrowser: async (exe, args, ms) => { const r = await runExe(exe, args, ms); return { code: r.code, timedOut: r.timedOut }; },
    sleep, fileOk,
    tmpProfile: () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prev-")),
    rmDir: (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
  const desktop: DesktopDeps = {
    helperExe: async () => {
      const src = path.join(repoRoot, "tools", "preview-capture.cs");
      const outExe = path.join(dataDir, "tools", "preview-capture.exe");
      const stamp = outExe + ".stamp";
      const srcHash = require("node:crypto").createHash("sha256").update(fs.readFileSync(src)).digest("hex");
      if (fs.existsSync(outExe) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === srcHash) return outExe;
      fs.mkdirSync(path.dirname(outExe), { recursive: true });
      compileHelper(src, outExe, (exe, a) => { const r = spawnSync(exe, a, { windowsHide: true, encoding: "utf8" }); return { code: r.status, stderr: `${r.stderr ?? ""}${r.stdout ?? ""}` }; }, cscPath());
      fs.writeFileSync(stamp, srcHash);
      return outExe;
    },
    spawnApp: (exe, args) => logOf(spawn(exe, args, { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] })).handle,
    killTree,
    closeApp: async (pid) => {
      spawnSync("powershell.exe", ["-NoProfile", "-Command", `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }`], { windowsHide: true });
      await sleep(3000);
      killTree(pid);
    },
    runHelper: runExe,
    sleep, fileOk,
  };
  return { web, desktop };
}
```
(Thay `require("node:crypto")` bằng `import { createHash } from "node:crypto"`. Lưu ý: `spawn` của `cmd.exe` chỉ dùng cho `npm|npx|pnpm|yarn` và đối số truyền riêng, không nối chuỗi.)

`RunManager`: thêm vào interface tùy chọn (cạnh `openPath`, dòng ~219) `previewDeps?: PreviewDeps;`, trường `private previews = new Map<string, { status: PreviewState["status"]; step: string | null }>()`, và ba phương thức theo "Quy tắc `startPreview`" ở trên. `previewFile`: chỉ nhận tên khớp `/^[A-Za-z0-9._-]+\.png$/`, `resolveInside(path.join(this.outputDir(), runId, "preview"), file)`, tồn tại thì trả đường dẫn. `getPreviewState`: nếu đang chạy trong `previews` thì trả đó; ngược lại đọc `readPreviewJson` và suy `status` từ `result.status`; không có thì `idle`. Mặc định `deps = this.opts.previewDeps ?? defaultPreviewDeps(config.dataDir, config.repoRoot)`.

`server/index.ts`: thêm `previewDeps?: PreviewDeps;` vào opts và `if (opts.previewDeps) mgrOpts.previewDeps = opts.previewDeps;`.

`http.ts` (trong khối xử lý `sub` của `/api/runs/:id/…`):
```ts
    if (sub === "preview" && method === "POST") {
      try {
        return json(res, 202, { state: manager.startPreview(runId, { viaTunnel: isViaTunnel(req) }) });
      } catch (e) {
        if (e instanceof PreviewError) return json(res, { not_found: 404, bad_request: 400, forbidden: 403, conflict: 409 }[e.code], { error: e.code, ...errorMessage(e) });
        throw e;
      }
    }
    if (sub === "preview" && method === "GET") {
      const run = manager.getRun?.(runId); // dùng cách lấy run sẵn có ở các nhánh bên cạnh
      return json(res, 200, { state: manager.getPreviewState(runId), config: run?.project ? manager.getPreviewConfig(run.project) : { kind: "none" } });
    }
    const pf = /^preview\/(.+)$/.exec(rest ?? "");   // đặt theo cách các nhánh `artifacts/<rel>` phân tích phần còn lại của đường dẫn
    if (pf && method === "GET") {
      const file = manager.previewFile(runId, decodeURIComponent(pf[1]!));
      if (!file) return json(res, 404, { error: "not_found", message: "Không tìm thấy ảnh." });
      const data = fs.readFileSync(file);
      res.writeHead(200, { "content-type": "image/png", "content-length": data.length, "cache-control": "no-store" });
      return void res.end(data);
    }
```
(Đọc nhánh `artifacts/<rel>` ở cùng hàm để bắt chước cách lấy `runId`, `sub`, phần còn lại; điều chỉnh tên biến cho đúng.)

- [ ] **Step 4: Test API (`tests/preview-api.test.ts`)** — copy phần dựng `config` + `startServer` của `tests/mcp-grants-api.test.ts`, truyền `previewDeps` giả (dùng deps của Task 4/5 nhưng trả ngay). Tạo project + run: tham khảo cách `tests/mcp-grants-api.test.ts`/`tests/outputs.test.ts` tạo run (qua `started.manager`/store; nếu cần dùng `store.createRun`). Ca cần có:
  1. không token → 401 cho `POST/GET /api/runs/x/preview`.
  2. run chưa khai báo cấu hình → POST 400.
  3. đã khai báo web nhưng `grants.preview` tắt → 403, thông báo chứa "quyền".
  4. bật quyền (`PUT /api/grants` với `preview: true`), worktree thiếu → 400 "Worktree"; tạo worktree giả (thư mục thật và `worktree_path` trong run) → POST 202, rồi poll `GET` (≤ 3 s) tới `state.status === "ok"`, `result.shots` 4 ảnh; ảnh giả do `runBrowser` giả ghi 1 byte ≥ 1 vào `outDir` (dùng `fs.writeFileSync` trong giả).
  5. POST lần hai khi đang chạy (deps giả đợi một promise) → 409.
  6. `GET /api/runs/:id/preview/home-375.png` → 200 `image/png`; `GET .../preview/..%2Fx.png` và `.../preview/a.txt` → 404.
  7. cấu hình desktop + header `x-forwarded-for` (đường hầm) → 403 "máy chạy app".
  8. `GET` cuối: `config` đúng.

- [ ] **Step 5: Chạy** — `npx vitest run tests/preview-run.test.ts tests/preview-api.test.ts` → PASS; `npm run typecheck` sạch.

- [ ] **Step 6: Commit** (`feat(preview): run preview orchestration and API`).

---

### Task 7: Giao diện tab "Xem trước"

**Files:**
- Modify: `ui/src/api.ts` (kiểu + 5 hàm)
- Create: `ui/src/preview.ts` (logic thuần), `ui/src/components/PreviewTab.tsx`
- Modify: `ui/src/runTabs.ts`, `ui/src/pages/RunPage.tsx`, `ui/src/i18n.ts`, `ui/src/styles` (tệp CSS đang dùng cho RunPage; tìm bằng `grep -n "tab-pane" ui/src/*.css`)
- Test: `tests/preview-ui-logic.test.ts`, cập nhật `tests/run-tabs*.test.ts` nếu có test `runTabIds`

**Interfaces:**
- Consumes: REST của Task 2 và Task 6.
- Produces:
```ts
// ui/src/api.ts
export type PreviewConfigView = { kind: "none" } | { kind: "web"; startCommand: string; url: string; pages: string[]; readyTimeoutSec: number } | { kind: "desktop"; exePath: string; args: string[]; windowTitle: string; settleSec: number };
export interface PreviewShotView { file: string; label: string; width: number; ok: boolean }
export interface PreviewStateView { status: "idle"|"running"|"ok"|"partial"|"error"; step: string | null; result: { kind: "web"|"desktop"; started_at: number; finished_at: number; status: string; shots: PreviewShotView[]; error: string | null; log_tail: string[] } | null }
api.previewGet(runId): Promise<{ state: PreviewStateView; config: PreviewConfigView }>
api.previewStart(runId): Promise<{ state: PreviewStateView }>
api.previewConfigPut(project, preview: PreviewConfigView): Promise<{ preview: PreviewConfigView }>
api.previewImageUrl(runId, file): string   // KHÔNG chứa token: ảnh tải qua fetch có header rồi dùng blob URL (xem getBlobUrl ở api.ts nếu có; nếu chưa có, thêm `previewImageBlob(runId, file): Promise<string>`)
// ui/src/preview.ts
export function groupShots(shots: PreviewShotView[]): Array<{ label: string; items: PreviewShotView[] }>; // theo label, thứ tự xuất hiện, mỗi nhóm sắp theo width tăng dần
export function previewTabVisible(coding: boolean, project: string | null): boolean;                    // coding && !!project (luôn hiện cho run coding có môi trường, xem ghi chú dưới)
export function canStart(state: PreviewStateView, grantOn: boolean): boolean;                            // !running && grantOn
export function configToForm(c: PreviewConfigView): { kind: "none"|"web"|"desktop"; startCommand: string; url: string; pagesText: string; readyTimeoutSec: string; exePath: string; argsText: string; windowTitle: string; settleSec: string };
export function formToConfig(f: ReturnType<typeof configToForm>): PreviewConfigView;                    // pagesText/argsText tách theo dòng, bỏ dòng trống; số rỗng -> bỏ để server dùng mặc định
```

Ghi chú về tab: tab hiện khi `coding` và (đã có cấu hình **hoặc** người dùng muốn khai báo lần đầu). Để người dùng khai báo được lần đầu, tab "Xem trước" luôn hiện cho run coding có `project` (spec §6 nói "chỉ hiện khi môi trường có khai báo", ở đây nới ra: hiện luôn với run coding và trong tab hiển thị biểu mẫu khai báo khi `kind: none`); ghi chú sai khác này vào spec bằng một dòng ở Task 8. Do đó `previewTabVisible(coding, project)` = `coding && !!project`.

- [ ] **Step 1: Viết test logic thuần** (`tests/preview-ui-logic.test.ts`): `groupShots` gom theo trang và sắp 375 trước 1280; `previewTabVisible(true,"p")` true, `(false,"p")` false, `(true,null)` false; `canStart` false khi `running` hoặc `grantOn=false`; `configToForm`/`formToConfig` khứ hồi cho `web` và `desktop`, dòng trống bị bỏ, số rỗng bị bỏ (không gửi `readyTimeoutSec`). Ví dụ:
```ts
expect(formToConfig({ ...configToForm({ kind: "none" }), kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pagesText: "/\n\n/login\n" }))
  .toEqual({ kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/login"] });
```

- [ ] **Step 2: Chạy** → FAIL. **Step 3: Cài `ui/src/preview.ts`** đúng các chữ ký trên.

- [ ] **Step 4: `api.ts`** thêm kiểu và hàm (theo mẫu `grantsGet/grantsPut`, `openOutput`); ảnh: đọc `saveToOutputs` để thấy cách gửi token; thêm
```ts
  previewImageBlob: async (id: string, file: string): Promise<string> => {
    const r = await fetch(`/api/runs/${encodeURIComponent(id)}/preview/${encodeURIComponent(file)}`, { headers: { "x-controller-token": getToken() ?? "" } });
    if (!r.ok) throw new ApiError(r.statusText, r.status);
    return URL.createObjectURL(await r.blob());
  },
```

- [ ] **Step 5: `PreviewTab.tsx`** (props `{ runId: string; project: string }`):
  - Trạng thái: `view` (từ `previewGet`), `grantOn` (từ `api.grantsGet(project)` → `grants.preview`), `form` (từ `configToForm`), `err`, `busy`.
  - Thăm dò `previewGet` mỗi 2000 ms khi `state.status === "running"` (setInterval trong `useEffect`, dọn khi unmount); không dùng WebSocket.
  - Khối "Quyền": checkbox "Cho phép chạy ứng dụng/máy chủ để xem trước" → `grantsGet(project)` rồi `grantsPut(project, {...g, preview: checked})`.
  - Khối "Cấu hình" (mở sẵn khi `kind: none`, thu gọn khi đã có): chọn loại (Không có / Website / Phần mềm), các trường theo loại (nhãn tiếng Việt từ i18n; gợi ý cho `url`: "Phải đúng cổng mà lệnh chạy mở ra"), nút "Lưu" → `previewConfigPut`; lỗi server hiện nguyên thông báo tiếng Việt.
  - Nút "Chụp ảnh" (`disabled={!canStart(...)}`; nếu `!grantOn` hiện câu nhắc bật quyền), dòng bước hiện tại, lưới ảnh theo `groupShots`: mỗi nhóm một tiêu đề trang, các ảnh xếp `grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr))`, nhãn "375 px"/"1280 px" ("Cửa sổ" cho desktop `width: 0`), ảnh nạp qua `previewImageBlob` (thu hồi `URL.revokeObjectURL` khi dọn), bấm ảnh mở lớp phủ xem lớn (nút đóng, phím Esc), ảnh `ok=false` hiện khung "Không chụp được".
  - Lỗi: `result.error` và `result.log_tail` (khối `<pre>` cuộn được).
  - Nút "Mở tệp" → `api.openOutput(runId, "preview/preview.json")`... **không**: dùng `api.openOutput(runId)` mở thư mục run (đã có `syncOutputs`); vì ảnh không phải artifact nên thư mục `preview/` nằm ngay trong `<outputDir>/<runId>/`, mở thư mục này là đủ. Nếu `openOutput` có `scanArtifacts/syncOutputs` thì vô hại với `preview/`.
  - Ghi chú nhỏ: "Ảnh có thể chứa nội dung riêng tư của ứng dụng đã chụp."
  - Nút và ô nhập đủ lớn ở 375 px (min-height 40px), không tràn ngang.

- [ ] **Step 6: Nối tab** — `runTabs.ts`: thêm `"preview"` vào `RunTab`; `runTabIds(coding)` trả `["timeline","result","changes","preview","details"]` cho coding (research không có); `normalizeTab` nhận `"preview"`. Cập nhật test hiện có của `runTabIds`/`normalizeTab`. `RunPage.tsx`: thêm nút tab cạnh dòng ~545 (`{coding && run.project && <button className={curTab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>{t.tab_preview}</button>}`) và vùng nội dung `{curTab === "preview" && run.project && <PreviewTab runId={run.id} project={run.project} />}` (kiểm tên trường `id`/`project` của `RunRecord` ở `ui/src/types.ts`). `i18n.ts`: thêm khóa `tab_preview` ("Xem trước"/"Preview") và mọi khóa `preview_*` dùng trong component, **cả vi và en**.

- [ ] **Step 7: Chạy** — `npx vitest run tests/preview-ui-logic.test.ts tests/run-tabs*.test.ts`, `npm run typecheck`, `npm run build:ui`. Expected: PASS, sạch, build thành công.

- [ ] **Step 8: Commit** (`feat(preview): Xem trước tab on the run page`).

---

### Task 8: Nghiệm thu chạy thật và tài liệu

**Files:**
- Modify: `docs/PROGRESS.md` (mục mới đầu tệp), `docs/superpowers/specs/2026-11-09-preview-screenshots-design.md` (một dòng ghi sai khác ở §6: tab luôn hiện với run coding có môi trường), `CLAUDE.md` (một đoạn "Cập nhật 2026-11-09 (Xem trước)" ngắn, theo mẫu các đoạn hiện có), `docs/HANDOVER.md` (một dòng)
- Create: `docs/screens/8.0-*.jpg`

- [ ] **Step 1: Toàn bộ test** — `npx vitest run --maxWorkers=1 --testTimeout=120000`; đọc dòng "Tests … passed" (không nối `| tail` rồi `&&`). `npm run typecheck`, `npm run build:ui`. Ghi số liệu.

- [ ] **Step 2: Chạy thật website** — tạo thư mục thử trong scratchpad với `package.json` chạy `node server.mjs` (máy chủ HTTP tối thiểu trả HTML có tiêu đề, hai trang `/` và `/about`) trên cổng 5199; chạy demo `.\scripts\start.ps1 -Demo -NoOpen -Port 4811` (cổng khác 4800, KHÔNG chạy `stop.ps1` nếu bản cài thật đang chạy; kiểm `%LOCALAPPDATA%\TNF` và cổng 4800 trước; dừng bằng cách dừng đúng tiến trình node của phiên này). Tạo project trỏ vào repo thử + một run demo coding có worktree (`FAKE_CLAUDE_GIT_COMMIT=1`, theo HANDOVER mục 2 cuối); khai báo Xem trước web; bật quyền; bấm "Chụp ảnh" trên giao diện (trình duyệt nhúng; mở đúng địa chỉ có `#token=`). Xác nhận bốn ảnh xuất hiện và thật sự là trang thử (xem ảnh bằng công cụ Read trên `<outputDir>/<runId>/preview/`).

- [ ] **Step 3: Chạy thật desktop** — khai báo `C:\Windows\System32\notepad.exe`, tiêu đề "Notepad" (hoặc Calculator nếu spike cho thấy Notepad không ổn), bấm chụp, xác nhận `window.png` đúng và Notepad đã đóng.

- [ ] **Step 4: Kiểm giao diện** — `resize_window` 375 px và ≥ 1280 px (đặt lại sau mỗi `navigate`): không tràn ngang, lưới đúng số cột, lớp phủ ảnh đóng được bằng Esc, tab đúng trên cả hai. Chụp ảnh nghiệm thu vào `docs/screens/8.0-preview-375.jpg`, `8.0-preview-1280.jpg`; **cắt bỏ mọi cửa sổ khác của người dùng nếu lộ**.

- [ ] **Step 5: Kiểm quyền và đường hầm** — thử bấm khi quyền tắt (thông báo tiếng Việt); `curl` với `x-forwarded-for: 1.2.3.4` vào cấu hình desktop → 403.

- [ ] **Step 6: Ghi PROGRESS** — mục mới đầu `docs/PROGRESS.md`: phạm vi, lệnh và đầu ra rút gọn của từng bước trên, số test, ảnh, những gì chưa làm (ô tick ở `GrantsSection`, mức 2/3, agent-desktop), rủi ro còn lại (ứng dụng GPU, dev server tự đổi cổng). Cập nhật CLAUDE.md và HANDOVER.

- [ ] **Step 7: Commit** (`docs: record preview screenshots verification`). **Không gộp vào `main`, không đẩy remote**; báo người dùng kèm tên nhánh và hỏi có gộp không.

---

## Self-Review

- **Spec coverage:** §2 khai báo → Task 1–2; §3 web → Task 4, desktop + spike → Task 0, 5; §4 lưu trữ/API → Task 6 (ghi `preview.json`, ba endpoint, mã lỗi 202/409/400/403/404); §5 quyền (khóa `preview`, đường hầm, hoãn UI ở `GrantsSection`) → Task 3, 6, 7; §6 giao diện → Task 7; §7 kiểm thử → từng task + Task 8; §8 rủi ro → Task 0 và Task 8. Sai khác có chủ ý: tab hiện luôn với run coding có môi trường (để khai báo lần đầu) — ghi vào spec ở Task 8.
- **Placeholder scan:** các `it` của Task 2 (migration) và Task 6 mô tả ca bằng lời kèm hướng dẫn copy mẫu từ test có sẵn; người thực thi phải viết thân đầy đủ, không để chú thích. Không còn TBD/TODO.
- **Type consistency:** `PreviewConfig`, `Shot`, `ProcHandle`, `WebDeps`, `DesktopDeps`, `PreviewJson`, `PreviewDeps`, `PreviewState`, `PreviewError` dùng nhất quán; `captureWeb` trả `{ shots, error, logTail }` và `runPreview` đổi thành `log_tail`; `Shot.width = 0` cho desktop khớp `groupShots`/nhãn "Cửa sổ".
