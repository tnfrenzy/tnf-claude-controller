# Prompt cho Claude Code — từng phase

Cách dùng:

1. Tạo thư mục `D:\tnf-claude-controller`, chép toàn bộ bộ file này vào đó (giữ cấu trúc `CLAUDE.md`, `docs/`, `config/`). Tạo thêm `D:\tnf-claude-workspace` (trống).
2. Mở PowerShell tại `D:\tnf-claude-controller`, chạy `claude`. Claude Code sẽ tự nạp `CLAUDE.md`.
3. Dán **một prompt một lần**, theo thứ tự. Kết thúc mỗi phase: `/clear`, rồi dán "Prompt khởi động" bên dưới kèm tên phase kế tiếp.
4. Với Phase 1 trở đi nên bắt đầu ở chế độ plan (Shift+Tab đến "plan") để Claude Code đưa kế hoạch trước, bạn duyệt rồi mới cho sửa file.
5. Nếu Claude Code hỏi quyền chạy lệnh cài đặt toàn cục hoặc sửa `~/.claude/settings.json`: đọc kỹ rồi mới đồng ý.

---

## Prompt khởi động (dán đầu mỗi phiên mới)

```
Đọc CLAUDE.md, docs/CONTEXT-SPEC.md, docs/PROMPTS.md. Nếu có docs/SPIKE-RESULTS.md và docs/PROGRESS.md thì đọc cả hai.
Cho tôi biết trong 5 dòng: (1) phase hiện tại theo các file đó, (2) việc dở dang, (3) điều bạn cần tôi quyết.
Chưa sửa file nào cho tới khi tôi trả lời.
```

---

## Phase 0 — Spike (kiểm chứng trên máy này)

```
Mục tiêu Phase 0: kiểm chứng các giả định trong docs/CONTEXT-SPEC.md mục 10 (V1–V16) trên chính máy Windows này, KHÔNG viết mã sản phẩm.

Ràng buộc:
- Chỉ ghi vào D:\tnf-claude-controller (docs/, fixtures/, scratch/) và D:\tnf-claude-workspace. Không sửa ~/.claude/settings.json, không cài gói toàn cục, không đụng D:\claude-office-main (chỉ-đọc). Việc nào cần vượt ràng buộc: hỏi tôi trước, nêu rõ lệnh và hệ quả.
- Không in ra hay ghi lại khóa API/token. Nếu thấy biến ANTHROPIC_API_KEY đang được đặt, DỪNG các bước chạy claude và báo tôi.
- Mỗi lần chạy claude -p phải có --max-turns và --max-budget-usd nhỏ. Tổng số lần chạy có tốn token: tối đa 8 lần cho cả phase; nói với tôi trước khi chạy lần thứ 5.

Việc cần làm, theo thứ tự:
1. V1–V2: phiên bản claude/node/npm/uv/python/bun; chạy `claude auth status`; ghi authMethod. Hỏi tôi gói thuê bao đang dùng (Pro/Max/Team).
2. V3–V4: một lần chạy nhỏ `claude -p --output-format stream-json --verbose --include-partial-messages --forward-subagent-text --max-turns 3` với prompt "chào, trả lời 1 câu"; thử cả prompt qua stdin lẫn qua đối số; lưu stream vào fixtures/hello.stream.jsonl; liệt kê tên các trường thực tế (session_id, total_cost_usd, usage…).
3. V5: kiểm tra `--agents config/roles.json` được chấp nhận (chạy với prompt không cần subagent); thử tạo bản sao roles.test.json có thêm `maxTurns` để xem có bị từ chối không (chỉ ghi nhận).
4. V6–V9 (A/B): với tác vụ chuẩn "Phân tích website example.com từ góc độ nội dung, SEO cơ bản và thông điệp bán hàng", chạy (a) một agent đơn và (b) coordinator + 3 vai theo dòng lệnh ở CONTEXT-SPEC mục 5.2 (cwd = D:\tnf-claude-workspace\runs\spike-a / spike-b). Trước đó chạy một "run rỗng" để đo chi phí nền. Ghi: token (input/output/cache), total_cost_usd, số lượt, thời gian, subagent nào được gọi, có bị từ chối quyền không (permission_denials), notes/ và report.md có được tạo không. Đưa cả hai báo cáo cho tôi chấm 1–5.
5. V7–V8, V16: nếu subagent bị từ chối công cụ dưới dontAsk, tìm cấu hình tối thiểu hoạt động (rule trong file --settings đặt trong workspace) và ghi lại cú pháp chính xác; thử `Agent` trong/không trong --allowedTools.
6. V10: thử hủy một run đang chạy (Node script nhỏ hoặc PowerShell) và resume bằng --resume <session_id>; ghi cách hủy nào sạch trên Windows.
7. V11–V12: chỉ ĐỌC và DRY-RUN: `uv run D:\claude-office-main\hooks\manage_hooks.py install --hook-cmd claude-office-hook --dry-run` (hỏi tôi trước khi chạy; nếu cần uv/python 3.14 chưa có thì dừng và báo). Chưa cài hook thật. Kiểm tra khả năng chạy backend/frontend claude-office: liệt kê các bước cần và rủi ro, CHƯA cài.
8. V13: chạy `claude agents --json` và đọc docs agent view; tóm tắt 5 dòng: trùng gì, khác gì so với mục tiêu của dự án.
9. V14–V15: tìm xem stream có event về hạn mức/rate-limit không; ghi nhận hành vi --bare bằng cách chỉ ĐỌC tài liệu (không chạy nếu có ANTHROPIC_API_KEY).

Kết quả: viết docs/SPIKE-RESULTS.md gồm bảng V1–V16 (Kết quả: ĐÚNG / SAI / CHƯA RÕ, bằng chứng rút gọn, ảnh hưởng tới đặc tả), bảng A/B, và danh sách thay đổi đề xuất cho CONTEXT-SPEC.md. Sau đó dừng và hỏi tôi duyệt trước khi sửa CONTEXT-SPEC.md.
```

---

## Phase 1 — Lõi controller (chưa có UI)

```
Phase 1: xây lõi controller theo docs/CONTEXT-SPEC.md (đã cập nhật theo docs/SPIKE-RESULTS.md). Bắt đầu ở chế độ plan: đưa kế hoạch + cấu trúc thư mục + danh sách file trước, chờ tôi duyệt.

Phạm vi:
- Node.js + TypeScript (strict), chạy trên Windows. Package manager: npm (trừ khi Phase 0 cho thấy lý do khác).
- Mô-đun: billing-guard, claude-runner, stream-parser, run-store (SQLite + runs/<id>/stream.jsonl), CLI `tnf run "<prompt>"`, `tnf resume <run-id> "<prompt>"`, `tnf cancel <run-id>`, `tnf list`.
- claude-runner: dựng dòng lệnh theo mục 5.2 (đã chỉnh theo kết quả spike), spawn không shell, env con đã lọc, trần turns/budget/timeout tổng, hủy sạch cả cây tiến trình, ghi stream thô.
- stream-parser: chuẩn hóa thành sự kiện mục 5.3; chịu lỗi với event lạ (lưu thô, type "unknown"); dựng cây agent từ parent_tool_use_id.
- billing-guard: chặn chạy khi authMethod không hợp lệ ở chế độ subscription; xóa ANTHROPIC_* khỏi env con; có test.
- Cấu hình ở config/*.json; không hard-code đường dẫn D:\.

Chất lượng:
- Test tự động (vitest) dùng stream ghi sẵn trong fixtures/ (không gọi claude thật trong test). Có test cho: parse, cây agent, event lạ, billing-guard, trần budget, hủy.
- Một "smoke script" chạy thật một tác vụ nhỏ, có cờ rõ ràng; không tự chạy khi test.
- Không tạo UI, không đụng claude-office, không cài hook.

Nghiệm thu (chạy thật rồi báo kết quả):
1. `tnf run "Phân tích website example.com ..."` tạo được report.md, DB có run/events/artifacts, stream.jsonl đầy đủ, in cây agent và chi phí ước tính.
2. `tnf cancel` dừng sạch, không để tiến trình mồ côi (kiểm tra bằng Task Manager hoặc Get-Process).
3. `tnf resume` hỏi tiếp được trên cùng session.
4. `npm test` xanh; lint/typecheck sạch.
Ghi tiến độ vào docs/PROGRESS.md. Commit theo từng bước nhỏ.
```

---

## Phase 2 — API + giao diện tiếng Việt

```
Phase 2: thêm API và giao diện web trên lõi Phase 1. Bắt đầu ở chế độ plan.

API (Fastify hoặc Express + ws): theo CONTEXT-SPEC mục 5.4. Bind 127.0.0.1:4800; token ngẫu nhiên mỗi lần khởi động (in ra console một lần và ghi file chỉ người dùng đọc được); kiểm Origin/Host; từ chối mọi thứ khác. Có test cho các kiểm tra này (request thiếu token, Origin lạ, Host lạ).

UI (React + Vite + TypeScript), tiếng Việt mặc định, i18n sẵn (vi/en), giao diện sáng/tối:
- Trang "Lệnh": ô nhập, chọn mức trần (lượt, ngân sách ước tính), nút Chạy; banner luôn hiện chế độ xác thực (subscription/api) và nhãn "chi phí ước tính, không phải hóa đơn".
- Trang "Lần chạy": dòng thời gian trực tiếp theo vai (coordinator/searcher/analyzer/synthesizer), tool call thu gọn được, trạng thái từng agent, token/chi phí ước tính theo vai, nút Hủy, khung hỏi tiếp (resume), cảnh báo khi context đã lớn.
- Xem báo cáo (report.md render markdown, an toàn — không chạy HTML/script nhúng trong markdown).
- Trang "Lịch sử": danh sách run, tìm kiếm theo từ khóa, lọc theo trạng thái/ngày, tổng chi phí ước tính theo ngày.
- Thông báo lỗi tiếng Việt, dễ hiểu (ví dụ: chưa đăng nhập, chạm trần lượt, API key đang bật nhầm).

Nghiệm thu:
1. Từ trình duyệt ra lệnh, xem trực tiếp, hủy, hỏi tiếp, xem lại lần chạy cũ sau khi khởi động lại app.
2. Kiểm tra bằng tay: mở trang từ một website khác (hoặc dùng curl với Origin giả) không gọi được API.
3. Chụp màn hình (Playwright nếu có) các trang chính lưu vào docs/screens/.
4. Test API + test thành phần chính xanh. Ghi PROGRESS.md.
```

---

## Phase 3 — Văn phòng 2D + đóng gói

```
Phase 3: tích hợp claude-office làm "Văn phòng 2D" và đóng gói chạy một lệnh. Bắt đầu ở chế độ plan. Mọi bước cài đặt hoặc sửa ~/.claude/settings.json phải hỏi tôi trước, hiển thị diff/dry-run.

Việc cần làm:
1. Tạo scripts/setup-office.ps1 (không phải bash) hướng dẫn/tự động hóa: kiểm tra Python 3.14 + uv + bun/npm; sao chép claude-office vào D:\tnf-claude-controller\vendor\claude-office (giữ LICENSE) HOẶC cấu hình đường dẫn tới D:\claude-office-main — đề xuất phương án và chờ tôi chọn; đặt SUMMARY_ENABLED=false và SUMMARY_BACKEND=disabled; đặt CLAUDE_OFFICE_API_KEY cố định cục bộ (ngẫu nhiên, không in ra).
2. Cài hook: chạy manage_hooks.py --dry-run, cho tôi xem diff, chờ tôi đồng ý, rồi mới cài thật; kèm script gỡ hook (uninstall) đã thử.
3. Kiểm tra id phiên: các run do controller bật phải hiện thành các phiên riêng trong văn phòng (không gộp vào "default"). Nếu sai, đề xuất cách sửa ít xâm lấn nhất (ưu tiên cấu hình/bộ chuyển đổi nhỏ phía controller; chỉ fork claude-office khi buộc phải).
4. Nhúng văn phòng vào UI controller (tab "Văn phòng"): iframe tới :3000; nếu bị chặn, báo nguyên nhân và đề xuất; thêm nút "Mở trong văn phòng" ở trang Lần chạy dựa trên liên kết run↔session.
5. scripts/start.ps1: khởi động controller + backend + frontend của office, kiểm tra cổng, in địa chỉ; scripts/stop.ps1 dừng sạch.
6. README.md tiếng Việt: cài đặt, khởi động, gỡ hook, xử lý sự cố thường gặp (đăng nhập, ANTHROPIC_API_KEY, hết hạn mức, cổng bận).

Nghiệm thu: một lệnh `scripts\start.ps1` chạy được toàn bộ; ra lệnh trong controller → thấy các agent xuất hiện trong văn phòng 2D; gỡ hook xong settings.json về như ban đầu (so với bản .bak). Ghi PROGRESS.md và danh sách vấn đề còn lại.
```

---

## Phase 4 (tùy chọn) — chọn từng hạng mục

```
Phase 4, hạng mục: <chọn 1: (a) cách B — planner trả JSON kế hoạch, người dùng duyệt, mỗi vai là một `claude -p` riêng; (b) duyệt quyền tương tác bằng canUseTool của Agent SDK hoặc --permission-prompt-tool; (c) học cách tính chi phí/launcher từ Claude-Code-Agent-Monitor; (d) hiển thị hạn mức thuê bao nếu có nguồn chính thức>.
Bắt đầu ở chế độ plan: nêu lý do nên/không nên làm dựa trên dữ liệu A/B thực tế trong docs/SPIKE-RESULTS.md và PROGRESS.md, ước tính công sức, rủi ro; chờ tôi duyệt.
```

---

## Prompt phụ — học từ Claude-Code-Agent-Monitor (khi đã có source)

```
Source Claude-Code-Agent-Monitor nằm ở <đường dẫn ASCII>. Đọc CHỈ-ĐỌC. Viết docs/AGENT-MONITOR-NOTES.md (tối đa 2 trang) về: (1) cách nó tính chi phí và token (file nào, công thức, bảng giá lấy từ đâu); (2) cách nó khởi chạy/ra lệnh cho Claude Code (launcher); (3) cách nó dùng hook + JSONL; (4) giấy phép (đọc file LICENSE thật); (5) phần nào có thể học ý tưởng, phần nào KHÔNG được sao chép mã. Không chép đoạn mã dài; chỉ mô tả và dẫn đường dẫn file.
```
