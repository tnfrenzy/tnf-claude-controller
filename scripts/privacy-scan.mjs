// Privacy scan before pushing to GitHub: `npm run privacy:scan` (exit 1 when something is found).
// Scans every git-tracked text file (working tree) for personal or company data.
// Your own words (company names, people, domains, machine names) go in `.privacy-denylist` at the repo root,
// one per line, case-insensitive; that file is git-ignored on purpose, so the words never reach the repo.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0").filter(Boolean)
  .filter((f) => !/\.(jpg|jpeg|png|ico|glb|stl|usdz|woff2?|zip|exe)$/i.test(f) && f !== "package-lock.json");

const BS = String.fromCharCode(92);
const SAFE_EMAIL = /@([a-z0-9.-]*example\.(com|org|net)|anthropic\.com|users\.noreply\.github\.com|noreply\.github\.com|[a-z]\.com)$/i;

const RULES = [
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ok: (m) => SAFE_EMAIL.test(m) || /^[a-z]+@(synced|latest|git)$/i.test(m) },
  { name: "windows-user-path", re: new RegExp(`C:(?:${BS}${BS}?|/)Users(?:${BS}${BS}?|/)([A-Za-z0-9._-]+)`, "g"), ok: (m, g) => /^(user|me|\.{3}|<[^>]+>|%[^%]+%|Public|Default)$/i.test(g[1] ?? "") },
  { name: "tailnet-host", re: /[a-z0-9-]+\.[a-z0-9-]+\.ts\.net/gi, ok: (m) => /^(<[^>]+>|x|pc|a|machine|my-pc|example[a-z-]*)\./i.test(m) || /tail1234|tail1\.|\.tailnet\.|\.example\./i.test(m) },
  { name: "api-key", re: /(sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g, ok: (m, g, f) => /^tests\/release\/release-redact/.test(f) },
  { name: "bearer-token", re: /Bearer\s+[A-Za-z0-9._~+/-]{32,}/g, ok: () => false },
  { name: "vn-phone", re: /(?<![0-9A-Za-z-])(?:\+84|0)(?:3|5|7|8|9)[0-9]{1}[ .]?[0-9]{3}[ .]?[0-9]{3,4}(?![0-9A-Za-z-])/g, ok: (m) => /^0900[ .]?000[ .]?000$/.test(m) || /^0+$/.test(m.replace(/\D/g, "")) },
];

let deny = [];
try {
  deny = fs.readFileSync(".privacy-denylist", "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
} catch { /* no denylist yet */ }
if (!deny.length) console.warn("Chưa có .privacy-denylist: chỉ quét theo mẫu chung. Hãy tạo tệp này (mỗi dòng một từ: tên công ty, tên người, tên miền, tên máy).");

const hits = [];
const MAX_SHOWN = 60;
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      if (r.ok(m[0], m, f)) continue;
      hits.push({ f, rule: r.name, text: m[0].slice(0, 60) });
    }
  }
  const lower = text.toLowerCase();
  for (const w of deny) {
    // "re:<regex>" lines are regular expressions; other lines are plain words.
    const found = w.startsWith("re:") ? new RegExp(w.slice(3), "i").test(text) : lower.includes(w.toLowerCase());
    if (found) hits.push({ f, rule: "denylist", text: `"${w}"` });
  }
}

const byKey = new Map();
for (const h of hits) {
  const k = `${h.rule}\t${h.f}`;
  const e = byKey.get(k) ?? { ...h, n: 0, sample: new Set() };
  e.n++; if (e.sample.size < 3) e.sample.add(h.text);
  byKey.set(k, e);
}
const rows = [...byKey.values()];
for (const e of rows.slice(0, MAX_SHOWN)) console.log(`${e.rule.padEnd(18)} ${String(e.n).padStart(4)}  ${e.f}  ${[...e.sample].join(" | ")}`);
if (rows.length > MAX_SHOWN) console.log(`... và ${rows.length - MAX_SHOWN} dòng nữa`);
console.log(rows.length ? `\nTÌM THẤY ${rows.length} chỗ cần xem. Sửa hoặc xác nhận an toàn trước khi đẩy lên GitHub.` : "\nSạch: không thấy dữ liệu cá nhân hoặc công ty trong các tệp được git theo dõi.");
console.log("Nhắc: lịch sử git cũ vẫn giữ nội dung đã xóa; ảnh chụp màn hình phải tự xem bằng mắt; công khai thì đẩy bản snapshot không mang lịch sử.");
process.exit(rows.length ? 1 : 0);
