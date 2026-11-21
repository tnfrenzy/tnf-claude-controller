# Ngữ cảnh — chuyển TNF Controller sang điều phối LẬP TRÌNH

Soạn ngày 2026-10-21 từ phiên đánh giá `D:\Office TN\ai-agents-main`. Dán "Prompt khởi động" ở cuối file vào phiên mới tại `D:\tnf-claude-controller`.

## 1. Trạng thái hiện tại (đã xác minh trên máy này)

- Phase 0–3 xong, chạy thật được: một phiên `claude -p` coordinator + subagent qua `--agents config/roles.json`, stream-json → SQLite → UI React (Lệnh, Lần chạy, Văn phòng 2D SVG). 60 test xanh, không gọi Claude thật.
- Ba vai hiện tại **searcher → analyzer → synthesizer** là **demo** để kiểm chứng cơ chế điều phối. Chúng sẽ được thay bằng vai lập trình.
- Việc dở dang trước đó (`docs/PROGRESS.md` mục "Chưa làm"): xem hoạt cảnh 2D bằng mắt khi run thật; xóa `vendor/claude-office` nếu không dùng; thư mục làm việc chung theo project; giảm thuế khởi động ~40k token/run bằng `extraArgs: ["--setting-sources","project"]`.
- Không có git trong `D:\tnf-claude-controller`. Nên `git init` ở đầu phiên mới trước khi sửa lớn.

## 2. Mục tiêu mới

Controller ra lệnh một câu tiếng Việt → coordinator phân loại → chuỗi vai lập trình làm việc **trên một repo đích** (sửa code, chạy test, commit trên nhánh riêng) → UI hiện tiến trình, diff, phán quyết review, token.

Người dùng: Kinh Doanh TNF, dùng để tự phát triển phần mềm của mình bằng hạn mức thuê bao claude.ai (không API key).

## 3. Bốn thay đổi kiến trúc bắt buộc

| # | Hiện tại | Cần | Ghi chú |
|---|---|---|---|
| A | cwd của agent = `D:\tnf-claude-workspace\runs\<id>` (quy tắc 10) | cwd = **repo đích** hoặc **git worktree** của nó (`<repo>\.worktrees\tnf-<run-id>` hoặc `D:\tnf-claude-workspace\worktrees\<run-id>`) | Worktree an toàn hơn: mỗi run một nhánh `tnf/<run-id>`, hỏng thì xóa. Vẫn giữ `runs/<id>` cho log/artifact. `run-manager.ts` dòng ~147/179 đặt cwd. |
| B | `allowedTools: ["Agent","WebSearch","WebFetch","Read","Write"]` | Theo **từng vai**: analyst/reviewer chỉ Read/Grep/Glob; implementer thêm Edit/Write/`Bash(npm test*)`, `Bash(npm run *)`, `Bash(git add*)`, `Bash(git commit*)`, `Bash(git diff*)`, `Bash(git status*)` | `dontAsk` từ chối lặng lẽ tool ngoài danh sách → mẫu Bash phải cụ thể. `--agents` JSON có trường `tools` riêng từng vai, nhưng `--allowedTools` của phiên chính vẫn là trần chung: kiểm chứng ở spike. |
| C | Không có deny | Thêm `--disallowedTools` hoặc rule deny trong file `--settings` đặt trong workspace: `git push*`, `git reset --hard*`, `git checkout*` nhánh chính, `rm -rf*`, `--no-verify`, `--force` | Mẫu deny đầy đủ: `D:\Office TN\ai-agents-main\ai-agents-main\.claude\settings.json`. Không sửa `~/.claude/settings.json` (quy tắc 6). |
| D | Project chỉ là nhãn | Project = **repo đích** (đường dẫn + nhánh gốc) lưu trong SQLite; ô nhập trên trang Lệnh; CLI `--repo` | Kết hợp với mục "thư mục làm việc chung" đã nêu trong PROGRESS. |

Sau run: controller chạy `git status --porcelain` và `git diff --stat` trong worktree, lưu thành artifact để UI hiện "đã đụng file nào".

## 4. Bộ vai lập trình đề xuất (thay `config/roles.json`)

Rút gọn từ `D:\Office TN\ai-agents-main\ai-agents-main\src\claude\agents\*.md` (MIT, © rjmurillo; ghi nguồn trong CONTEXT-SPEC). Mỗi prompt ≤ 3 KB, tiếng Anh, đầu ra tiếng Việt. Không dùng bất kỳ `mcp__*` nào.

| Vai | Rút từ | Model gợi ý | Tools | Việc |
|---|---|---|---|---|
| analyst | analyst.md | haiku/sonnet | Read, Grep, Glob | Điều tra code, root cause, ghi `notes/analysis.md` với **thang bằng chứng** 4 mức (tool output phiên này / file đã đọc / tài liệu ngoài / kiến thức huấn luyện; cấm công bố mức 4) |
| planner | task-decomposer.md + plan skill | sonnet | Read, Grep, Glob, Write | Chia việc thành task nguyên tử có tiêu chí nghiệm thu, ghi `notes/plan.md` |
| critic | critic.md | sonnet | Read, Grep, Glob | Phản biện kế hoạch với **ngữ cảnh mới** (không thấy lý luận của planner). Trả đúng một trong: `APPROVED`, `APPROVED_WITH_CONCERNS`, `NEEDS_REVISION`, `BLOCKED` + lý do |
| implementer | implementer.md (phần Core Behavior, Commit Discipline, Evidence Standards) | sonnet/opus | Read, Grep, Glob, Edit, Write, Bash (allowlist) | Làm theo plan, test kèm code, commit nhỏ `type(scope): desc` trên nhánh worktree |
| qa | qa.md | sonnet | Read, Grep, Glob, Bash(npm test*) | Chạy test, kiểm tiêu chí nghiệm thu bằng bằng chứng (lệnh + output), **không** hỏi implementer; verdict PASS/FAIL + danh sách lỗi |
| debug (tùy chọn) | debug.md | sonnet | như implementer | Chỉ gọi khi qa FAIL: assess → investigate → resolve → verify |

Coordinator mới (`config/coordinator-prompt.md`), rút từ orchestrator.md:
1. Phân loại: **trivial** (trả lời trực tiếp) / **đơn** (một vai) / **đa bước** (chuỗi).
2. Chuỗi chuẩn: analyst → planner → critic → (NEEDS_REVISION → planner, tối đa 1 vòng) → implementer → qa → (FAIL → debug → qa, tối đa 1 vòng).
3. Hợp đồng giao việc: ngân sách N lần gọi (mặc định 8), retry 1, điều kiện dừng (qa PASS hoặc hết ngân sách hoặc critic BLOCKED), báo cáo cuối có: artifacts, commands đã chạy, files đã đổi, residual_risks, confidence.
4. Truyền đường dẫn, không dán nội dung. Không dán lý luận của vai trước vào prompt cho vai review.
5. Coordinator không tự sửa code, không chạy shell.

Controller parse verdict (`APPROVED…`, `PASS/FAIL`) từ reply của subagent để hiện trạng thái trên văn phòng 2D và lưu vào `events`.

## 5. Không làm

- Không cài plugin `project-toolkit@ai-agents`, không chép skill (cần Python 3.14 + uv), không Serena/GitHub MCP, không hook.
- Không `--bare`, không `bypassPermissions`, không sửa `~/.claude/settings.json` (quy tắc 1, 2, 6 giữ nguyên).
- Không cho agent push, không đụng nhánh chính, không xóa worktree tự động khi run lỗi (giữ để xem).

## 6. Việc cần kiểm chứng bằng spike trước khi viết mã (ghi vào SPIKE-RESULTS)

- S1: `--agents` với `tools` chứa `Edit`, `Bash(npm test*)` có được subagent dùng dưới `dontAsk` không, và `--allowedTools` của phiên chính có phải bao trùm không.
- S2: deny qua `--disallowedTools` hay qua file `--settings` trong workspace: cái nào chặn được `git push` của subagent.
- S3: cwd là worktree: `git commit` của implementer có chạy không (hooks của repo đích, identity git).
- S4: thuế khởi động với `--setting-sources project` khi cwd là repo đích có CLAUDE.md riêng.
- S5: một vòng đầy đủ trên repo nhỏ thật (ví dụ chính `tnf-claude-controller` sau khi `git init`, hoặc repo mẫu Node) với yêu cầu "thêm một lệnh CLI `tnf version`".

Mỗi spike: haiku, `--max-turns` ≤ 10, `--max-budget-usd` ≤ 0.5, tối đa 6 lần chạy tốn token.

## 7. Quyết định của người dùng (2026-10-21)

- **A — worktree ngoài repo đích**: `D:	nf-claude-workspaceworktrees<run-id>`, nhánh `tnf/<run-id>`. `runs/<run-id>` chỉ còn log/artifact.
- **Repo spike riêng**: `D:	nf-claude-workspacespike-repo` (Node nhỏ, có `npm test`, git riêng). Không dùng `tnf-claude-controller` làm repo đích khi spike.
- **Agent được `git commit`** trên nhánh worktree. Vẫn cấm `git push`, cấm đụng nhánh chính, cấm thao tác phá hủy (mục 3C).
- **UI hiện diff và kết quả test từng run**: cuối run controller chạy `git diff <nhánh gốc>...HEAD` trong worktree → artifact `diff.patch` + `diff-stat.txt`; kết quả test lấy từ output `Bash(npm test*)` của vai qa → `test-result.txt` + verdict PASS/FAIL. Trang Lần chạy thêm tab "Diff" và "Test" cạnh "Báo cáo".
- Spike chạy trước: **S1 + S2 gộp** (kèm S3 vì cwd đã là worktree), haiku, `--max-turns 10`, `--max-budget-usd 0.5`. S4, S5 làm sau.
- **Kết quả spike (2026-10-21, xem SPIKE-RESULTS):** S1, S1b, S2, S2b, S3 đều ĐÚNG. `--allowedTools` phiên chính là trần chung (vai chỉ thu hẹp); deny qua `--disallowedTools` lẫn file `--settings` đều chặn được `git push` kể cả khi có `cd … &&`; lệnh Bash chỉ đọc (`cat`) được tự cho phép dưới `dontAsk`; `result.permission_denials` bỏ sót từ chối Bash → dựa vào sự kiện stream.
- **Vai từ ai-agents-main:** sao chép file gốc vào `config/roles-src/` kèm ghi nguồn MIT, rồi cắt mỗi vai xuống ≤ 3 KB, bỏ mọi phụ thuộc Serena/GitHub MCP/skill Python. Giữ ý cốt lõi (thang bằng chứng, verdict, kỷ luật commit). Người dùng có thể đề xuất thêm vai từ thư mục đó; ghi tên file vào đây.
- **Chọn model theo vai:** cơ chế hiện có (`role_models` → `data/runs/<id>/roles.json`) áp dụng tự động cho bộ vai mới vì server đọc tên vai từ `config/roles.json`. Chỉ văn phòng 2D (`ui/src/office/layout.ts`) phải đổi tên phòng.
- **Môi trường Desktop → controller:** dùng chung repo (project = đường dẫn repo) thì được; lịch sử phiên Claude Code Desktop không nhập được (quy tắc 8). Người dùng muốn về sau sửa chính controller từ trong controller: hỗ trợ bằng cách cho repo đích = `D:	nf-claude-controller`, agent làm trên worktree, người dùng duyệt diff rồi gộp và khởi động lại.
- **Điều khiển từ điện thoại (hướng chọn):** giữ controller trên máy Windows, mở ra ngoài qua Tailscale Serve hoặc Cloudflare Tunnel có xác thực, UI vừa màn hình nhỏ. Cần: kiểm `Origin`/`Host` chấp nhận tên miền đường hầm (cấu hình `server.allowedOrigins`), vẫn bind `127.0.0.1`. Không đẩy lên VPS, không đóng gói cài đặt.
- **Tải file:** (a) tải về artifact của run (report, diff.patch, test-result) — làm cùng tab Diff/Test; (b) tải lên file đính kèm lệnh (ảnh, md, txt, pdf, ≤ 5 MB) vào `runs/<id>/inbox/` — làm cùng hướng điện thoại; (c) **không** tải lên/lưu cả thư mục: nguồn sự thật là repo git.
- **Quy tắc 200k token (người dùng, 2026-10-21):** khi ngữ cảnh một phiên vượt 200k token, tự tóm tắt và chuyển sang phiên mới **trong cùng môi trường** (cùng project/worktree) để làm tiếp, **không hỏi**. Áp dụng cho coordinator của controller (D20 trong SPEC v1) và cho phiên Claude Code đang phát triển controller.
- **Chạy song song:** nhiều run cùng project chạy đồng thời được nhờ mỗi run một worktree + nhánh; giới hạn là hạn mức thuê bao, CPU, và xung đột khi gộp nhánh.
- **Setup.exe:** mục tiêu cuối (bước 5.6 trong SPEC v1): Node SEA + Inno Setup, chạy nền ở khay, tự mở trình duyệt, kiểm tra `claude` CLI đã cài/đăng nhập. Ước lượng tổng 11–15 phiên làm việc (≈ 2–3 tuần).
- **Hiển thị thư mục của môi trường:** UI phải cho biết run đang dùng thư mục nào: repo đích, nhánh gốc, worktree, thư mục log/artifact; có nút mở thư mục (Explorer) và sao chép đường dẫn.

## Prompt khởi động (dán vào phiên mới tại D:\tnf-claude-controller)

```
Đọc CLAUDE.md, docs/CONTEXT-CODING.md, docs/PROGRESS.md, docs/SPIKE-RESULTS.md. CONTEXT-SPEC.md chỉ đọc mục 5.2, 6, 7, 11.
Mục tiêu phiên: chuyển controller từ vai demo (searcher/analyzer/synthesizer) sang điều phối LẬP TRÌNH theo docs/CONTEXT-CODING.md.
Trả lời trong tối đa 8 dòng: (1) bạn hiểu 4 thay đổi kiến trúc A–D thế nào, (2) spike nào nên chạy trước, (3) điều bạn cần tôi quyết. Sau đó tôi sẽ nêu thêm những thứ tôi muốn bổ sung.
Chưa sửa file nào cho tới khi tôi trả lời. Bắt đầu ở chế độ plan.
```
