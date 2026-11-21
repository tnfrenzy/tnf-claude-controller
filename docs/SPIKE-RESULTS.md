# SPIKE-RESULTS — Phase 0 (một phần), 2026-10-20

Phiên làm việc này bị bộ phân loại auto mode của Claude Code **chặn spawn `claude.exe`**, nên chỉ kiểm chứng được những mục không cần chạy `claude -p`. Các mục còn lại chờ người dùng chạy `npm run smoke -- --yes` (xem cột "Cách kiểm").

| V | Kết quả | Bằng chứng / cách kiểm |
|---|---|---|
| V1 | **ĐÚNG** | `claude --version` → 2.1.301 (≥ 2.1.281). Node v24.19.0, npm 11.17.0. **Không có** uv, python, bun → claude-office (Phase 3) chưa chạy được. `claude` trên PATH là shim npm `claude.cmd` → exe thật: `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe` (controller tự resolve, spawn không shell). |
| V2 | **ĐÚNG** | `claude auth status` → `loggedIn: true`, `authMethod: "claude.ai"`, `subscriptionType: "team"`. `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` **không** được đặt. Gói Team → có tín dụng API tháng nhưng không liên quan khi dùng đăng nhập claude.ai. |
| V3 | **ĐÚNG** (14:07, người dùng chạy `npm run smoke -- --yes`) | `claude -p` chạy bằng đăng nhập claude.ai; prompt qua stdin hoạt động (không có cảnh báo "no stdin"); run `20261020-140701-91a698` → `done`, result "Chào bạn, mình có thể giúp gì cho bạn hôm nay?", 2,7 s. |
| V4 | **ĐÚNG** | Stream thật lưu ở `fixtures/real-hello.stream.jsonl` (27 dòng). Tên trường khớp: `session_id`, `total_cost_usd` (0.0048), `usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, `parent_tool_use_id`, `permission_denials`, `modelUsage`, `subagent_stats`. **Khác tài liệu:** (1) có thêm `system/hook_started`, `hook_response`, `status`, `thinking_tokens` và `rate_limit_event` → parser đã bỏ qua/parse; (2) mỗi API message sinh nhiều dòng `assistant` cùng `message.id` (thinking, text) kèm usage **tạm** (output_tokens chưa đủ) — số cuối nằm ở `stream_event/message_delta` → parser gộp theo `message.id`/`api_message_id`, lấy phần chênh lệch (test `real-stream.test.ts`). |
| V5 | **ĐÚNG** (14:15, `npm run smoke -- --yes --roles`, run `20261020-141506-da532a`) | `--agents config/roles.json` được chấp nhận; `system/init` liệt kê `agents: [analyzer, searcher, synthesizer, …]`. Stream thật lưu ở `fixtures/real-roles.stream.jsonl` (720 dòng, 428 KB). |
| V6 | **ĐÚNG** | Coordinator tự giao đúng thứ tự: 2 searcher **song song** (nội dung · SEO) → analyzer → synthesizer; đúng 4 lần gọi (`subagent_stats.spawned: 4`). Trả lời cuối ≤ 10 dòng tiếng Việt. |
| V7 | **ĐÚNG một phần** | Subagent dùng được WebFetch/WebSearch/Read dưới `dontAsk` + allowlist phiên chính; `permission_denials: []`. Searcher ghi được `notes/site_content.md`, `notes/seo_basic.md`. **NHƯNG** CLI 2.1.301 từ chối subagent ghi file "báo cáo": `<tool_use_error>Subagents should return findings as text, not write report files</tool_use_error>` (analyzer → `notes/analysis.md`, synthesizer → `report.md`). Đây là chặn của CLI, không phải permission. **Cách xử lý đã làm:** prompt vai bảo trả toàn văn khi bị từ chối; controller lưu toàn văn từ `task_notification.summary` thành `report.md` / `notes/analysis.md` (`run-manager.salvageSubagentOutputs`, `npm run reparse`). Đã kiểm: `report.md` 9,4 KB được tạo. |
| V8 | CHƯA RÕ | Chưa thử giới hạn `Write(./**)` / `WebFetch(domain:…)`. |
| V9 (3 vai) | **ĐÚNG** | Tác vụ chuẩn, 3 vai: 268 s API, 9 lượt coordinator, **$0.486 ước tính** (sonnet $0.458: cache đọc 363k · ghi 68k · ra 19,5k; haiku $0.028: vào 72,8k · ra 33,3k). Phần đắt là **coordinator** (sonnet) vì mỗi lượt chờ/thức dậy lại đọc ~40k context nền. Hạn mức 5 giờ tăng 17 % → 22 % cho run này. **Chưa có đối chứng agent đơn** (`--single`). Gợi ý: `defaults.model: "haiku"` cho coordinator hoặc `extraArgs` cắt hook. |
| V9 (run rỗng) | **ĐÚNG, đáng lo** | "chào" với haiku tốn **input 2 + cache ghi 22 965 + cache đọc 17 004 + output 92** ≈ 40k token, $0.0048 ước tính. Nguyên nhân thấy trong stream: hook `SessionStart` toàn cục (superpowers) nạp nội dung lớn, cùng danh sách tool/plugin/MCP. Thử cắt bằng `defaults.extraArgs` trong `config/controller.json` (ví dụ `["--setting-sources","project"]`) và đo lại; **chưa thử**. |
| V10 | **ĐÚNG (giả lập)** | Hủy bằng `taskkill /T /F /PID` dừng sạch tiến trình con treo (test `cancels a hanging run cleanly`); resume dùng `--resume <session_id>` cùng run dir (test `follow-up resumes…`). Chưa kiểm với claude thật. |
| V11 | **ĐÚNG** (cài 15:31, người dùng duyệt) | 11 hook được thêm vào `~/.claude/settings.json` (sao lưu `settings.json.bak` + `settings.json.pre-office-20261020-153145.bak`). **Hai bẫy Windows:** (1) Claude Code ở máy này chạy hook qua **Git Bash** (`/usr/bin/bash`), đường dẫn `C:\Users\...` bị nuốt dấu `\` → "command not found" → phải dùng `C:/Users/user/.local/bin/claude-office-hook.exe`; (2) độ trễ hook (Python) đo được **1,9–4,7 s** → vượt timeout 2 s mặc định → đã nâng `timeout: 10` cho 11 hook. Sau sửa: run `20261020-153536-147c19` của controller hiện trong văn phòng với **đúng session_id** (không gộp "default"), `projectName` = tên thư mục run nhờ `CLAUDE_OFFICE_STRIP_PREFIXES`. Cấu hình hook ở `~/.claude/claude-office-config.env`. Phiên Claude Code Desktop cũng hiện trong văn phòng (hook toàn cục). |
| V12 | **ĐÚNG** | claude-office chạy trên Windows: backend `uv sync` (56 gói, Python 3.13), frontend `bun run build` (static export) → `backend/static`, `SERVE_STATIC=1` qua **env** (không phải `.env`, Settings từ chối khóa lạ), uvicorn 127.0.0.1:8000. **Iframe nhúng được** sau khi nới CSP của controller (connect-src/frame-src thêm origin :8000). **Bẫy:** đặt `CLAUDE_OFFICE_API_KEY` tường minh làm backend đòi `X-API-Key` cho cả trang static → iframe 401; vì vậy để trống key (backend tự sinh, chỉ thao tác thay đổi trạng thái mới cần). `SUMMARY_ENABLED=false` có hiệu lực (không thấy gọi `claude --bare`). Không cần cổng 3000. |
| V13 | CHƯA RÕ | Chạy `claude agents --json` khi có thể. |
| V14 | **ĐÚNG** | Stream có `rate_limit_event` với `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}`, `overageStatus: "rejected"`, `overageDisabledReason: "org_level_disabled"` (extra usage đang TẮT ở cấp tổ chức → không thể bị tính thêm). Lúc 14:07: 5 giờ 17 %, 7 ngày 32 %. Controller lưu snapshot gần nhất, trả qua `/api/status`, hiện trên banner. |
| V15 | CHƯA RÕ | Chỉ đọc tài liệu; `--bare` đã bị cấm trong `billing-guard.ts`. |
| V16 | **ĐÚNG** | `Agent` trong `--allowedTools` cùng `dontAsk` cho phép coordinator gọi subagent không bị hỏi; `permission_denials: []`. |

## A/B tác vụ chuẩn (§6.5) — "Phân tích website example.com từ góc độ nội dung, SEO cơ bản và thông điệp bán hàng"

| | (a) Agent đơn `--single` (sonnet) | (b) Coordinator + 3 vai `--roles` |
|---|---|---|
| Run | `20261020-143428-65d7b2` | `20261020-141506-da532a` |
| Chi phí ước tính | **$0.177** | $0.486 (×2,7) |
| Token vào / ra | 18,4k / 12,0k | 72,8k / 52,8k |
| Cache đọc / ghi | 96k / 31k | 423k / 97k |
| Lượt API | 7 | 9 (coordinator) + 4 subagent |
| Thời gian | 47 s | ≈ 270 s |
| Nguồn đã đọc | trang chủ, robots.txt, sitemap.xml (3) | trang chủ, giới thiệu, liên hệ, sản phẩm, 2 trang sản phẩm, dịch vụ, robots, sitemap, sitemap_index (10) |
| Sản phẩm | `report.md` 64 dòng (lưu từ trả lời cuối) | `report.md` 102 dòng + `notes/site_content.md`, `notes/seo_basic.md`, `notes/analysis.md` có nguồn, ngày truy cập |
| Điểm chất lượng 1–5 (người dùng chấm) | _chưa_ | _chưa_ |

Nhận xét của người soạn: (b) đắt gấp 2,7 lần và chậm gấp 5,7 lần, nhưng đọc nhiều trang hơn gấp 3 và để lại notes có nguồn để tra lại; (a) nhanh, rẻ, nhưng tự nhận chỉ đọc 3 URL. Chi phí (b) nằm chủ yếu ở coordinator sonnet thức dậy 5 lần (cache đọc 363k). Quyết định theo §6.5 chờ điểm chất lượng của người dùng; nếu giữ (b) thì bước tối ưu đầu tiên là coordinator → haiku (dự kiến giảm phần lớn $0.458).

## Khác biệt định dạng stream CLI 2.1.301 so với đặc tả (đã xử lý trong parser, có test `real-stream.test.ts`, `real-roles.test.ts`)

1. Subagent chạy **nền (async)**: tool_result của `Agent` trả ngay "Async agent launched successfully…"; vòng đời thật qua `system/task_started` → `task_progress` (usage.total_tokens, tool_uses, last_tool_name) → `task_notification` (status, **summary = toàn văn trả lời**, `output_file` **rỗng**) → `task_updated`, `background_tasks_changed`.
2. Mỗi lần coordinator thức dậy sau thông báo là một **segment**: CLI in nhiều dòng `result` (có `result_index`, `origin.kind: "task-notification"`) **dồn ở cuối** khi thoát; `total_cost_usd` tích lũy, `num_turns`/`duration_ms` theo segment, `modelUsage` là tổng toàn run. Parser gom thành `run.segment`, chốt `run.result` khi tiến trình thoát.
3. `system/init` lặp lại cho mỗi subagent (cùng `session_id`, không có `parent_tool_use_id`).
4. `stream_event` của subagent có `parent_tool_use_id: null` → không dùng để quy token cho vai; dòng `assistant` của subagent có `parent_tool_use_id` nhưng usage chỉ là snapshot tạm → **token theo vai lấy từ `task_progress.usage.total_tokens`**, token toàn run lấy từ `modelUsage`.
5. Thêm `system/hook_started|hook_response|status|thinking_tokens` và `rate_limit_event`.

## Thay đổi đề xuất cho CONTEXT-SPEC

1. Đổi mọi tên `corp-*` → `tnf-*` (đã làm theo yêu cầu người dùng).
2. Mục 8: `claude` cài qua npm trên máy này (không phải native installer); controller resolve shim `.cmd` → `bin/claude.exe`.
3. Mục 4.3/9: Phase 3 cần cài thêm uv, Python 3.14, bun — chưa có trên máy.

## Spike lập trình S1–S3 (2026-10-21) — quyền công cụ, deny, commit trong worktree

Cách chạy: `npm run spike:setup` rồi `npm run spike -- --yes --variant a|b|c` (haiku, max-turns 10, budget $0.5). Repo đích: `D:\tnf-claude-workspace\spike-repo`, worktree `D:\tnf-claude-workspace\worktrees\<run-id>`, nhánh `tnf/<run-id>`. Bằng chứng: `data/spikes/<run-id>/summary.json` + `stream.jsonl`. Cả ba run cùng base `e1f7e3c` (main của spike-repo).

| Spike | Biến thể / run | Kết quả | Bằng chứng |
|---|---|---|---|
| S1 Edit + Bash(npm test*) dưới dontAsk | a / `spike-a-20261021040034` | ĐÚNG | implementer: Read ×3, Edit `src/math.js`, Edit `tests/math.test.js`, Bash `npm test` (pass 2 fail 0), Bash `git add -A && git commit` đều chạy được, không có `permission.denied` cho Edit hay npm test; controller chạy lại `npm test` trong worktree: exit 0, pass 2 fail 0 |
| S1b `--allowedTools` phiên chính là trần chung? | b / `spike-b-20261021040140` | ĐÚNG: trần chung | phiên chính không cấp Edit, role `tools` vẫn liệt kê Edit: Edit bị `permission.denied` ×2 ("running in don't ask mode"), sau khi bị từ chối implementer chuyển sang phương án dự phòng và không sửa file nào (git log rỗng, status sạch); `result.permission_denials` có mục Edit |
| S2 deny `git push` qua `--disallowedTools` | a | ĐÚNG: deny thắng allow | cấp `Bash(git *)` nhưng deny `Bash(git push*)`: `permission.denied` cho `cd "<worktree>" && git push origin HEAD` (khớp cả khi có tiền tố `cd "<worktree>" &&`); bare remote chỉ có `* main`, không có `tnf/spike-a-20261021040034` |
| S2b deny qua `--settings` | c / `spike-c-20261021040254` | ĐÚNG | `config/spike/deny-settings.json`, không dùng `--disallowedTools`: `permission.denied` cho `git push origin HEAD`; bare remote chỉ có `* main`; commit `8cd1acf` trên `tnf/spike-c-20261021040254`, npm test exit 0 |
| S3 `git commit` trong worktree với GIT_* env | a (và c) | ĐÚNG | a: commit `efa5243` "feat(math): add sub function with tests", author `TNF Agent <agent@example.com>` (máy không có git identity toàn cục), `git status` sạch, diff-stat `src/math.js` +4, `tests/math.test.js` +8/-1; c: commit `8cd1acf`, cùng dạng |
| Chi phí (ước tính, không phải hóa đơn) | | a $0.0150, b $0.0085, c $0.0090; tổng ≈ $0.0325 | 2–3 lượt mỗi run, haiku |

Phát hiện thêm:
- Dưới `dontAsk`, lệnh Bash chỉ đọc (ví dụ `cat package.json`) vẫn được cho phép dù allowlist chỉ có `Bash(npm test*)` và `Bash(git *)` (run b). Allowlist không phải cổng duy nhất cho Bash.
- `result.permission_denials` không đầy đủ: rỗng ở run a và c dù Bash `git push` bị từ chối; sự kiện `permission.denied` thì có. Controller phải dựa vào sự kiện, không chỉ vào trường tổng kết.
- Sự kiện `permission.denied` mang `agent_id` "coordinator" dù subagent là bên gọi (lệch quy gán).
- Stream có sự kiện mới `system/vcs_state_changed` (`kind: "commit"`, `branch: "tnf/spike-a-20261021040034"`), parser hiện ghi là event lạ.

Kết luận cho thiết kế B/C:
- B (phân quyền): `--allowedTools` của phiên chính là trần chung, role `tools` chỉ thu hẹp. Vậy allowlist phiên chính phải là hợp của `tools` mọi vai; thu hẹp theo vai làm trong `roles.json`. Không coi allowlist là rào duy nhất cho Bash vì lệnh chỉ đọc luôn qua.
- C (deny/bảo vệ git): cả `--disallowedTools` lẫn `--settings` với `permissions.deny` đều chặn `git push` ngay cả khi `Bash(git *)` được cấp, và khớp qua tiền tố `cd "<worktree>" &&`. Chọn `--settings <file>` cho danh sách deny đầy đủ (dễ bảo trì, đúng quy tắc 4), có thể thêm `--disallowedTools` cho vài lệnh then chốt (đai và dây lưng). `Bash(git *)` chỉ dùng để thử deny, không đưa vào cấu hình thật.
- S3: agent commit được trong worktree khi controller truyền `GIT_*` env (identity "TNF Agent"); push vẫn bị chặn.
- Chi phí một tác vụ code nhỏ với implementer haiku ≈ $0.01–0.015 (ước tính).

## Spike lập trình S4–S7 (2026-10-21, Phase 5.0) — thuế khởi động, vòng đủ vai, deny mở rộng, lệnh ghép

Cách chạy: `npm run spike -- --yes --variant d|e|f|s4|s4p|s5`. Repo đích `D:\tnf-claude-workspace\spike-repo` (đã thêm `CLAUDE.md` ở `145c65d`), worktree `D:\tnf-claude-workspace\worktrees\<run-id>`. Bằng chứng: `data/spikes/<run-id>/summary.json` + `stream.jsonl`. Cấu hình: `config/spike/{deny-settings-v1.json,roles-probe.json,roles-coding.json,coordinator-coding.md}`.

| Spike | Run | Kết quả | Bằng chứng |
|---|---|---|---|
| S6 deny `git -C … push`, `git -c … push`, `git reset --hard` qua file deny v1 + `--disallowedTools` | d `spike-d-20261021042427` ($0.0111 ước tính) | **ĐÚNG** | 3 `permission.denied` đúng ba lệnh probe; bare remote chỉ `main`; repo gốc status trước/sau rỗng, HEAD `145c65d` không đổi |
| S7 allowlist hẹp (§4.2, không `Bash(git *)`) với lệnh ghép | d, e, f | **ĐÚNG** | `npm test 2>&1 \| tail -n 5`, `git add -A && git commit -m …`, `cd "<wt>" && npm test …` đều được phép; commit `70a3d3a` (d), `0a6b71a` (e), `b4c264e` (f) |
| S6b giới hạn `Edit(<worktree>/**)` | e `spike-e-20261021042602` ($0.0104) | **ĐÚNG một phần** | Edit trong worktree chạy (cú pháp được nhận); probe Edit ngoài worktree lỗi "File has not been read yet" trước khi tới bước quyền → chưa kết luận |
| S6c giới hạn `Edit(<wt>/**)` + `Write(<wt>/**)`, probe Read→Edit và Write ngoài worktree | f `spike-f-20261021042751` ($0.0102) | **ĐÚNG** | `permission.denied` cho Edit `spike-repo/README.md` và Write `spike-repo/probe.txt`; Edit/Write trong worktree bình thường; Read ngoài worktree **được phép** (chỉ đọc) |
| S4 thuế khởi động, prompt "chào", cwd worktree có CLAUDE.md, mặc định | s4 `spike-s4-20261021042912` | 1 lượt, $0.0054 | usage: cache_write **25 484**, cache_read 25 298, out 172 (≈ 50,8k token) |
| S4 cùng prompt với `--setting-sources project` | s4p `spike-s4p-20261021042946` | 1 lượt, $0.0015 (**−72 %**) | cache_write **5 994**, cache_read 28 604, out 116 (≈ 34,6k). Phần đọc cache ~25–28k là system prompt + tool, không cắt được |
| S5 vòng đủ 6 vai, "thêm lệnh CLI version", coordinator sonnet, vai haiku | s5 #1 `spike-s5-20261021043016` ($0.4346, 15 lượt, 6 lần gọi) | **CHƯA ĐỦ** | Chuỗi analyst → planner → critic (NEEDS_REVISION) → planner ×2 → critic (NEEDS_REVISION) → implementer chạy đúng thứ tự; implementer viết `src/cli.js`, `tests/cli.test.js`, sửa README nhưng bị từ chối `node src/cli.js …` (không có trong allowlist) rồi **bỏ luôn** npm test và commit. Planner không đọc được `notes/analysis.md`, `notes/critic.md` (controller chỉ lưu sau run). `notes/` nằm trong worktree → untracked trong `git status` |
| S5 lần 2 sau vá: thêm `Bash(node *)`, `notes/` vào `info/exclude` của worktree, vai chỉ đọc bàn giao bằng văn bản | s5 #2 `spike-s5-20261021043600` ($0.3220, 13 lượt, 6 lần gọi) | **CHƯA ĐỦ** | Bàn giao văn bản chạy tốt (planner viết `notes/plan.md` ngay); `git status` không còn `notes/`; implementer vẫn bị từ chối 2 lệnh ghép: một có `git ls-files` (ngoài allowlist) và `$'\r'`, một có `${PIPESTATUS[0]}` → CLI từ chối cả lệnh khi một đoạn không khớp hoặc có mở rộng biến; implementer (haiku) lại dừng không commit |
| Chi phí Phase 5.0 | 8 run (1 lỗi cấu hình, $0) | **≈ $0,795 ước tính** | d 0,0111 · e 0,0104 · f 0,0102 · s4 0,0054 · s4p 0,0015 · s5 0,4346 · s5 0,3220 |

Bẫy mới: khóa `$comment` trong file `--agents` làm CLI thoát mã 1 không có stream (bị coi là một vai thiếu prompt) — file roles không được chứa khóa lạ. `result.ok = true` dù việc dở dang → trạng thái run phải suy từ verdict/commit, không từ `ok`.

Kết luận cho đặc tả v1:
1. **Allowlist theo ngôn ngữ repo đích**: thêm `Bash(node *)` (hoặc `python`, `dotnet`…) qua `project.allowed_commands`; vẫn không `Bash(git *)`.
2. **Lệnh đơn**: prompt implementer/qa/debug bắt buộc một lệnh mỗi lần gọi Bash, không `;`, không `$(`, `${`, `$'`; chỉ cho phép `2>&1 | tail -n N`. Từ chối chỉ áp dụng cho lệnh đó, phải tiếp tục. Cân nhắc implementer = sonnet (haiku bỏ dở sau từ chối ở cả hai lần).
3. **Notes**: controller lưu `notes/<vai>.md` **ngay khi nhận `task_notification`** (không đợi hết run) và ghi `notes/` vào `info/exclude` của worktree; hoặc để notes ở thư mục run và truyền đường dẫn tuyệt đối. Vai chỉ đọc bàn giao bằng văn bản trong prompt là chấp nhận được (ngắn).
4. **Giới hạn Edit/Write theo đường dẫn** dùng được: `Edit(<worktree>/**)`, `Write(<worktree>/**)` (dấu `/`). Read toàn cục.
5. **`--setting-sources project`** giảm ~72 % chi phí run rỗng; dùng mặc định cho run lập trình, kiểm lại deny vẫn hiệu lực ở smoke 5.2.
6. Vòng critic: controller đếm số vòng (coordinator đã gọi planner 2 lần dù quy tắc 1). Chi phí coordinator sonnet thức dậy 13–15 lượt ≈ $0,3–0,4; cân nhắc coordinator haiku hoặc gộp analyst+planner.

## Smoke 5.2 — bộ vai lập trình hoàn chỉnh (chiều 2026-10-21)

Cách chạy: `npm run smoke -- --yes --coding --project spike --prompt "Thêm lệnh CLI version: node src/cli.js version in ra version trong package.json, kèm test tests/cli.test.js, cập nhật README một dòng, chạy npm test, commit."`. Cấu hình thật: `config/roles-coding.json` (analyst/critic/qa haiku, planner/implementer/debug sonnet; một lệnh Bash đơn mỗi lần gọi), `config/coordinator-coding.md` (`{{maxRoleCalls}}` = 8), coordinator sonnet, trần $1/run, allowlist §4.2 + `Bash(node *)` của project, deny §4.3, `--setting-sources project`.

| Lần | Run | Chi phí ước tính | Lượt | Gọi vai | Verdict | Commit | Kết quả |
|---|---|---|---|---|---|---|---|
| 1 | `20261021-130531-432628` | **$0,4062** (in 66, out 15 329, cache_read 632 929, cache_write 104 465) | 11 | 5: analyst → planner → critic → implementer → qa | critic APPROVED_WITH_CONCERNS · qa **PASS** | `af19ec7 feat(cli): add version command`, `164c02b docs(readme): document version command` (tác giả TNF Agent) | **ĐẠT** lần đầu, 130 s |

Bằng chứng controller thu (độc lập với báo cáo agent): 0 `permission.denied`; `git status` worktree sạch; `diff --stat` = README.md +1, src/cli.js +12, tests/cli.test.js +28; bare remote chỉ có `refs/heads/main`; repo gốc HEAD `145c65d` và status không đổi trước/sau; `test-result.txt` = lần `npm test` cuối thành công; controller chạy lại `npm test` trong worktree: exit 0, `tests 4 pass 4 fail 0`. Artifact: `diff.patch`, `diff-stat.txt`, `git-log.txt`, `git-status.txt`, `repo-check.txt`, `test-result.txt`, `notes/{analyst,planner,critic,implementer,qa}.md`. Stream lưu thành `fixtures/real-coding-pass.stream.jsonl` (716 dòng, 435 KB), test `tests/real-coding.test.ts`.

So với S5 (haiku implementer, lệnh ghép): không còn từ chối quyền, implementer sonnet commit đủ hai task, không cần vòng debug. Chi phí tương đương S5 ($0,32–0,43) nhưng hoàn tất trọn vòng.

Phát hiện: sự kiện `vcs.commit` được quy cho `coordinator` (CLI phát `system/vcs_state_changed` không có `task_id`), dù implementer mới là vai commit — UI nên suy vai từ agent đang chạy lúc đó (việc cho 5.3). Model haiku ở analyst/critic/qa đủ dùng cho tác vụ nhỏ; bảng §5.1 ghi sonnet là trần, không bắt buộc.

## Spike 5.6 — đóng gói runtime: Node SEA hay kèm node.exe (2026-10-21)

Thử nghiệm nhỏ ở scratchpad: script `app.mjs` mở `node:sqlite` (`DatabaseSync` in-memory, insert/select) và `ws` (WebSocketServer + client trên 127.0.0.1), bundle CJS bằng `esbuild` (có sẵn trong `node_modules` qua vite), rồi `node --experimental-sea-config`.
- `node bundle.cjs` → `SEA-SPIKE OK sqlite=42 ws=hello-42` (bundle CJS 129 KB chạy đúng với Node 24.19.0).
- `node --experimental-sea-config sea-config.json` → `Wrote single executable preparation blob to sea-prep.blob` (129 298 byte).
- Bước nhúng blob vào `node.exe` cần `postject` (`Cannot find module 'postject'`): không có trong `node_modules` lẫn npm đi kèm Node → phải `npm install` (quy tắc 6: không cài khi chưa hỏi) → **dừng spike ở đây**.
- Kết luận: chọn **kèm `node.exe` + `dist/`** (`npm run package` → `build/app/`, 91,3 MB trong đó `node.exe` 88,5 MB; Setup nén lzma2 còn nhỏ hơn nhiều). Lý do ngoài `postject`: (1) chế độ demo chạy `process.execPath fixtures/fake-claude.mjs` nên dù có SEA vẫn phải kèm `node.exe` thật; (2) mã là ESM dùng `import.meta.url` để suy `REPO_ROOT`, SEA chỉ nhận CJS → phải bundle và vá đường dẫn; (3) `--allowedTools` cho agent có `Bash(node *)` không liên quan vì agent dùng Node của máy đích. SEA để lại cho bước sau nếu cần một exe duy nhất.
- Bằng chứng chạy bản đóng gói ngoài repo (`scratchpad\inst\app`, không npm/tsx): `node.exe dist\cli.js version` → `tnf: 0.1.0 / claude: 2.1.301`; `serve --port 4811` → tự tạo `..\data` cạnh `app\`, `GET /api/status` (header token) 200 `loggedIn: true`, `GET /` 200 (UI).

## MCP (2026-11-09)

Script: `scripts/spike-mcp.mts` (haiku, `--max-turns 2`, cwd tạm ngoài repo, `claude` 2.1.301, desktop-commander 0.3.1, `bypassPermissions` + `--setting-sources project`). Chỉ đọc sự kiện `system/init`. **Lưu ý:** cả 4 lượt trả `Failed to authenticate: OAuth session expired` (cost 0; `claude auth status` báo `loggedIn:false`) nên không có lượt trả lời thật của model; init vẫn phát đủ nên (a)–(d) kiểm được từ init. Cần đăng nhập lại CLI trước khi chạy thật.

- **(a) ĐÚNG.** `--mcp-config <file> --strict-mcp-config` nạp được Desktop Commander qua `cmd /c npx -y ...`: `mcp_servers: [{"name":"desktop-commander","status":"connected","source":"dynamic"}]`, 24 công cụ tên `mcp__desktop-commander__*` (read_file, write_file, start_process, ...). Hệ quả: tên máy chủ trong mcp.json = tên trong `mcp__<tên>__*`.
- **(b) ĐÚNG, không nuốt giá trị.** `--mcp-config f --setting-sources project` (biến thể B) và `--mcp-config f --setting-sources project --strict-mcp-config` (D) đều nạp đúng máy chủ, các cờ sau vẫn có hiệu lực (D vẫn chỉ có desktop-commander). Không cần đặt `--mcp-config` đặc biệt; vẫn nên để ngay trước một cờ khác cho chắc.
- **(c) ĐÚNG.** `--disallowedTools mcp__desktop-commander__start_process` dưới `bypassPermissions`: công cụ biến mất khỏi danh sách (`start_process present: false`, 24 thay vì 25 công cụ). Prefix `mcp__desktop-commander` loại cả máy chủ (0 công cụ `mcp__`, dù status vẫn `connected`). Chặn ở mức danh sách công cụ, đáng tin hơn chặn lúc gọi.
- **(d) ĐÚNG một phần.** Không `--strict-mcp-config` + `--setting-sources project` (biến thể B): `mcp_servers` chỉ có `desktop-commander` (25 công cụ, thêm start_process); không có máy chủ plugin nào (data/sales/marketing...). Connector claude.ai cũng không xuất hiện, nhưng lúc chạy CLI chưa đăng nhập nên lượt này **không chứng minh được** điều gì về connector (kết luận đầy đủ ở đoạn "Task 4 verification" bên dưới: việc nạp connector khi không strict là có điều kiện). Hệ quả: nhánh `kind:"cli"` (máy chủ do controller cấp qua mcp.json) dùng được và plugin không rò vào run; vẫn dùng `--strict-mcp-config` để chắc chắn.
- **(e) SAI.** Không có biến môi trường hay tham số dòng lệnh để giới hạn thư mục (`index.js` chỉ nhận `setup|remove|remote|--no-onboarding`). `allowedDirectories` nằm trong `~/.claude-server-commander/config.json` (đường dẫn từ `os.homedir()`, mặc định `[]` = toàn bộ ổ đĩa), chỉ đặt qua tool `set_config_value` hoặc sửa file; README nói rõ nó **chỉ hạn chế thao tác file, không hạn chế lệnh terminal** (`start_process` vẫn đọc ngoài). Hệ quả: UI Cấp quyền hiện cảnh báo "Desktop Commander có quyền toàn bộ ổ đĩa" thay cho giới hạn thư mục; chặn `start_process` bằng `--disallowedTools` giữ lại phần file. Hướng chưa thử: đặt `USERPROFILE` riêng cho tiến trình con để có config tách biệt từng run.

**Task 4 verification (2026-11-09, haiku, `--max-turns` 1–2, cwd tạm ngoài repo, đã xóa khóa API; kết luận đã đối chiếu với lượt chạy lại của controller sau khi đăng nhập CLI).** (a) `-p --setting-sources project --permission-mode bypassPermissions --strict-mcp-config` KHÔNG kèm `--mcp-config`: CLI chạy bình thường (exit 0), init có `mcp_servers: []`, 0 công cụ `mcp__`; vậy không cần file `mcp.json` rỗng. (b) Việc nạp connector claude.ai khi KHÔNG có `--strict-mcp-config` là **có điều kiện/phụ thuộc thời điểm**: không strict và không `--mcp-config` thì init `mcp_servers: []` (0 công cụ `mcp__`); lượt chạy lại của controller (đã đăng nhập, CÓ `--mcp-config`, không strict) nạp các connector claude.ai Claude Docs, Odoo, wpvibe MCP, Microsoft 365 với 121 công cụ `mcp__`; bỏ luôn `--setting-sources project` thì init liệt kê hàng chục máy chủ plugin/claude.ai ở trạng thái `pending/needs-auth/failed`. Chỉ `--strict-mcp-config` loại connector một cách đáng tin (kể cả khi không có `--mcp-config`: 0 máy chủ). (c) Tiền tố công cụ connector **đã xác nhận bằng công cụ thật**: `mcp__claude_ai_<Tên, khoảng trắng thành _>__<công cụ>`, ví dụ `mcp__claude_ai_Odoo__*`, `mcp__claude_ai_Microsoft_365__*`; `mcpPrefix()` (thay ký tự ngoài `[A-Za-z0-9_-]` bằng `_`) khớp. Hệ quả: run coding luôn phát `--strict-mcp-config` trừ khi có tick connector (connector mặc định TẮT).

## Spike Xem trước: PrintWindow (2026-11-09)

Helper `tools/preview-capture.cs` (C#, `PrintWindow` với `PW_RENDERFULLCONTENT`, không dùng CopyFromScreen). Máy: Windows 10 Home 10.0.19045, ra ảnh vào `%TEMP%\tnf-preview-spike` (ngoài repo).
- Biên dịch: `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:exe /reference:System.Drawing.dll /out:...\preview-capture.exe tools\preview-capture.cs` → `csc exit=0`, không lỗi, Defender không chặn việc biên dịch lẫn chạy exe (không có cảnh báo).
- Notepad: `preview-capture.exe --title "Notepad" --pid <pid> --out notepad.png` → `exit=0`, PNG 1730x762 (13,7 KB). Mở xem: thấy đúng thanh tiêu đề "Untitled - Notepad", menu File/Edit/Format/View/Help, vùng soạn thảo trắng. Không đen.
- Calculator (UWP, `--title "Calculator"`, không `--pid` vì PID thuộc ApplicationFrameHost): `exit=0`, PNG 1222x960. Thấy đầy đủ giao diện Standard (số 0, bàn phím, History/Memory), không đen, không ảnh rỗng. Tiêu đề máy này là tiếng Anh nên chưa thử "Máy tính".
- Nhận xét: kích thước ảnh theo `GetWindowRect` (gồm cả bóng đổ vô hình của cửa sổ Win10), nên viền/góc ảnh có vài điểm đen (phần ngoài khung cửa sổ); nội dung không bị ảnh hưởng. Chưa thấy vấn đề GPU với hai app này (app dùng GPU nặng như game/Chrome chưa thử). Kết luận: phần desktop khả thi.

## Render GLB bằng Edge headless (2026-11-10)

Mục đích: dựng ảnh PNG 1280x960 từ GLB bằng three.js trong Edge headless (không GPU, không MCP, không token). Máy: Windows 10, Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, three 0.187 từ `node_modules`. Đầu vào: `elevator_cabin.glb` (mét, 15 node, 2 vật liệu PBR phẳng). Máy chủ thử: `node:http` bind `127.0.0.1:47311`, chỉ phục vụ `/`, `/three/*`, `/model.glb`; trang dùng importmap (`three` -> `/three/build/three.module.js`, `three/addons/` -> `/three/examples/jsm/`), `GLTFLoader`, `RoomEnvironment` qua `PMREMGenerator` cho PBR, thêm `HemisphereLight` + `DirectionalLight` (studio), `ACESFilmicToneMapping`, `document.title = "ready"` sau khi render.

- Lệnh: `msedge.exe --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --window-size=1280,960 --virtual-time-budget=10000 --user-data-dir=<tạm> --screenshot=<png> "http://127.0.0.1:47311/?az=35&el=25&dist=1"` -> `29866 bytes written to file ...png`, `exit 0`, khoảng 21 s mỗi ảnh (phần lớn là khởi động Edge + SwiftShader + đồng hồ ảo).
- (a) Ảnh ra. Nhìn thật: thấy buồng cabin đủ hình khối, cửa đôi, đáy và nắp xám đậm, hai mặt tường sáng khác độ sáng (có đèn + môi trường), nền xám nhạt. Vật liệu phẳng, nhạt do metallic/roughness trong GLB; không phải ảnh đen hay trống.
- (b) Thời gian khoảng 20 đến 26 s mỗi góc; 4 góc tuần tự khoảng 90 s, nên timeout 60 s mỗi góc là đủ.
- (c) Cờ cần: `--headless=new`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader` (WebGL không GPU), `--virtual-time-budget=10000` (đủ để GLB tải xong và chụp), `--user-data-dir` riêng (không đụng trình duyệt đang mở), `--hide-scrollbars`, `--window-size=1280,960`. Thử `--timeout=8000` thay cho virtual-time-budget: ảnh chỉ có "ERR TypeError: Failed to fetch" (chụp trước khi GLB tải xong), nên **không dùng** `--timeout`.
- Bẫy: đặt camera theo mét mà model lớn hơn khoảng cách thì ảnh cận mặt tường (lần chạy đầu); cách xử lý là đặt khoảng cách tối thiểu bằng khoảng cách vừa khung theo bán kính cầu bao (`radius / sin(fov/2) * 1.05`). Edge in nhiều dòng `ERROR:...task_manager` ra stderr, vô hại.

## Spike Antigravity CLI (`agy` 1.5.13) & cô lập `CLAUDE_CONFIG_DIR` (2026-11-21)

Mục đích: kiểm chứng thực tế `agy` trên Windows trước khi tích hợp đa CLI (chỉ dùng Google OAuth thuê bao, không API key, không AI Credit).
- `agy -p --output-format stream-json --model gemini-3.8-flash-low`: xuất NDJSON gồm `init` (`conversation_id`, `model`, `cwd`, `tools[]`, `permission_mode`), `step_update` (`agent_response`, `tool`, `user_input`), `result` (`status`, `response`, `duration_seconds`, `num_turns`, `usage`).
- `CLAUDE_CONFIG_DIR=<thư mục rỗng>` + `claude auth status`: trả `loggedIn: false, authMethod: "none"`, tự tạo `.claude.json` trong thư mục riêng, không đụng `~/.claude`.
- Quyền qua `--settings <đường dẫn file>` (không dùng JSON inline trên PowerShell):
  - Máy Windows không có terminal sandbox (`--mode auto` rơi về `request-review`).
  - `command(...)` khớp **toàn bộ dòng lệnh**, không khớp tiền tố (`command(echo)` trượt `echo hello`, `command(regex:echo .*)` khớp).
  - `command(regex:.*git.*push.*)` trong `permissions.deny` chặn được cả `git push`, `git -C . push`, `git -c x=1 push`; deny thắng allow.
  - Từ chối quyền là soft-deny (exit 0, `status: SUCCESS`, `response` rỗng): parser phải kiểm `tool_info.error` và stderr để phát `permission.denied`.
- `--input-format stream-json --output-format stream-json`: chạy nhiều lượt qua stdin, mỗi lượt 1 `result`.
- Agent tùy chỉnh `.agents/agents/<tên>/agent.md` + `--agent <tên>`: chạy đúng system prompt (giảm input token rõ rệt), trong khi `agy agents` in rỗng.
- `--conversation <id>`: nhớ ngữ cảnh lượt trước, hỗ trợ `followup`.
