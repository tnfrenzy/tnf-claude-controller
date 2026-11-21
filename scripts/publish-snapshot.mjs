// Publish a clean one-commit snapshot of this repo: `npm run publish:snapshot [-- --push --yes]`.
//
// What it does (nothing leaves your machine unless you pass BOTH --push and --yes):
//   1. refuses to run unless you are on the base branch with a clean working tree;
//   2. runs the privacy scan (scripts/privacy-scan.mjs) on the working tree and stops if it finds anything;
//   3. builds an orphan branch `public-snapshot` (a single commit, no old history) in a sibling worktree;
//   4. runs the privacy scan again on that snapshot;
//   5. prints the exact push command, or pushes `public-snapshot:<branch>` with --force when --push --yes is given.
//
// Settings live in `.publish-config.json` (git-ignored; copy `.publish-config.example.json`):
//   { "remote": "origin", "branch": "main", "baseBranch": "main", "expectedRemoteUrl": "https://github.com/me/repo.git",
//     "author": { "name": "me", "email": "me@users.noreply.github.com" }, "snapshotDir": "../repo-public-snapshot" }
// With "expectedRemoteUrl" set, the push is refused when the remote points somewhere else.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scanner = path.join(here, "privacy-scan.mjs");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const repo = path.resolve(value("--repo") ?? process.cwd());
const die = (msg) => { console.error(`\nDỪNG: ${msg}`); process.exit(1); };
const run = (cmd, a, cwd = repo, opts = {}) => spawnSync(cmd, a, { cwd, encoding: "utf8", shell: false, windowsHide: true, ...opts });
const git = (a, cwd = repo) => {
  const r = run("git", a, cwd);
  if (r.status !== 0) die(`git ${a.join(" ")} thất bại: ${(r.stderr || r.stdout || "").trim().slice(0, 300)}`);
  return (r.stdout ?? "").trim();
};

let cfg = {};
const cfgFile = path.join(repo, ".publish-config.json");
if (fs.existsSync(cfgFile)) {
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")); } catch { die(".publish-config.json không đọc được (JSON hỏng)."); }
}
const remote = cfg.remote ?? "origin";
const branch = cfg.branch ?? "main";
const baseBranch = cfg.baseBranch ?? "main";
const author = { name: cfg.author?.name ?? "release", email: cfg.author?.email ?? "agent@example.com" };
const snapDir = path.resolve(repo, cfg.snapshotDir ?? `../${path.basename(repo)}-public-snapshot`);
const SNAP_BRANCH = "public-snapshot";

// 1. state of the repo
const current = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (current !== baseBranch) die(`đang ở nhánh "${current}", cần ở nhánh "${baseBranch}".`);
if (git(["status", "--porcelain"])) die("còn thay đổi chưa commit; commit hoặc bỏ trước.");

// 2 + 4. privacy scan (the scanner reads .privacy-denylist from the folder it scans)
function scan(dir, label) {
  console.log(`\n== Quét riêng tư: ${label}`);
  const deny = path.join(repo, ".privacy-denylist");
  const copy = path.join(dir, ".privacy-denylist");
  const copied = dir !== repo && fs.existsSync(deny) && !fs.existsSync(copy);
  if (copied) fs.copyFileSync(deny, copy);
  try {
    const r = spawnSync(process.execPath, [scanner], { cwd: dir, stdio: "inherit" });
    return r.status === 0;
  } finally {
    if (copied) fs.rmSync(copy, { force: true });
  }
}
if (!scan(repo, "cây làm việc")) die("quét riêng tư tìm thấy chỗ cần xem; sửa rồi chạy lại. Không tạo snapshot.");

// 3. snapshot
const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version ?? "?"; } catch { return "?"; } })();
const name = (() => { try { return JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).name ?? path.basename(repo); } catch { return path.basename(repo); } })();
if (fs.existsSync(snapDir)) { run("git", ["worktree", "remove", "--force", snapDir]); fs.rmSync(snapDir, { recursive: true, force: true }); }
run("git", ["worktree", "prune"]);
run("git", ["branch", "-D", SNAP_BRANCH]);
git(["worktree", "add", "--detach", snapDir, "HEAD"]);
git(["checkout", "--orphan", SNAP_BRANCH], snapDir);
git(["add", "-A"], snapDir);
git(["-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`, "commit", "-q", "-m", `${name} ${version} (public snapshot)`], snapDir);
const sha = git(["rev-parse", "--short", "HEAD"], snapDir);
const files = git(["ls-files"], snapDir).split("\n").filter(Boolean).length;
console.log(`\nSnapshot: ${snapDir}\n  commit ${sha} · ${files} tệp · tác giả ${author.name} <${author.email}> · phiên bản ${version}`);

if (!scan(snapDir, "snapshot")) die("snapshot không sạch; không đẩy.");

// 5. push (only with --push AND --yes)
const pushCmd = `git push ${remote} ${SNAP_BRANCH}:${branch} --force`;
if (!flag("--push")) {
  console.log(`\nChưa đẩy gì. Để đẩy: chạy lại với "-- --push --yes", hoặc tự chạy trong ${snapDir}:\n  ${pushCmd}`);
  process.exit(0);
}
if (!flag("--yes")) die('--push cần thêm --yes để xác nhận (lệnh dùng --force và ghi đè nhánh từ xa).');
const url = run("git", ["remote", "get-url", remote]).stdout?.trim();
if (!url) die(`remote "${remote}" chưa có trong repo (git remote add ${remote} <địa chỉ>).`);
if (cfg.expectedRemoteUrl && url !== cfg.expectedRemoteUrl) die(`remote "${remote}" trỏ tới ${url}, khác expectedRemoteUrl trong .publish-config.json; không đẩy.`);
console.log(`\nĐẩy ${SNAP_BRANCH} -> ${url} (${branch}) ...`);
const p = run("git", ["push", remote, `${SNAP_BRANCH}:${branch}`, "--force"], snapDir, { stdio: "inherit" });
if (p.status !== 0) die("git push thất bại (xem thông báo ở trên; có thể cần đăng nhập GitHub).");
console.log("\nXong. Nhớ tạo Release trên GitHub với tag mới và đính kèm Setup.exe nếu cần.");
