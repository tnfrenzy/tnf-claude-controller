# TNF Claude Controller — Bối cảnh & Đặc tả v0 (cách A)

- Ngày soạn: 2026-10-20 (UTC+7). Trạng thái: **v0, chưa được kiểm chứng trên máy Windows của người dùng.**
- Người soạn: Claude (Cowork) cùng Kinh Doanh TNF. Đây là bàn giao từ một cuộc trao đổi dài; mọi thứ cần biết nằm trong file này.
- Nhãn độ tin cậy dùng xuyên suốt:
  - **[DOCS]** — đọc từ tài liệu chính thức của Anthropic ngày 2026-10-20 (bản CLI dùng đối chiếu: 2.1.304).
  - **[SRC]** — đọc trực tiếp mã nguồn claude-office tại `D:\claude-office-main`.
  - **[GIẢ ĐỊNH]** — chưa kiểm chứng, phải test ở Phase 0.
  - **[ƯỚC TÍNH]** — phán đoán của người soạn, không có nguồn.

---

## 0. Cách dùng bộ file này

1. `CLAUDE.md` (ở thư mục gốc dự án) được Claude Code tự nạp: chứa quy tắc ngắn.
2. File này (`docs/CONTEXT-SPEC.md`) là nguồn sự thật về bối cảnh, quyết định, sự kiện đã xác minh, kiến trúc, rủi ro.
3. `docs/PROMPTS.md` chứa prompt dán vào Claude Code cho từng phase (0 → 3, thêm phase 4 tùy chọn).
4. `config/roles.json` và `config/coordinator-prompt.md` là cấu hình mẫu cho ba vai agent (searcher, analyzer, synthesizer) và phiên điều phối.

Nếu thấy mâu thuẫn giữa file này và thực tế khi chạy, **thực tế thắng**: ghi lại vào `docs/SPIKE-RESULTS.md` và sửa đặc tả.

---

## 1. Người dùng & môi trường

- Người dùng: Kinh Doanh TNF, làm việc bằng **tiếng Việt**, múi giờ UTC+7. Mọi giao diện, thông báo lỗi hiển thị cho người dùng, báo cáo do agent sinh ra đều bằng tiếng Việt. Mã nguồn, tên biến, commit message dùng tiếng Anh.
- Máy: **Windows** (tên máy example-pc). Claude Code CLI chạy qua PowerShell (cài native: `irm https://claude.ai/install.ps1 | iex`). Git Bash là tùy chọn.
- Nỗi đau ban đầu: giao diện PowerShell của Claude Code khó nhìn các phiên làm việc và khó xem lại lịch sử hội thoại (renderer toàn màn hình dùng alternate screen nên lịch sử không nằm trong scrollback). Cách tạm: `/tui default`, `Ctrl+O` xem transcript.
- Source tham khảo đã có trên máy: `D:\claude-office-main` (MIT). Source `Claude-Code-Agent-Monitor` chưa được cung cấp.
- **Đường dẫn: chỉ dùng ASCII, không dấu, không nằm trong OneDrive.** Trong cuộc trao đổi, đường dẫn tiếng Việt/OneDrive làm công cụ truy cập thư mục báo lỗi. Đề xuất:
  - Repo: `D:\tnf-claude-controller`
  - Thư mục làm việc của agent (cwd khi chạy `claude`): `D:\tnf-claude-workspace` — **nằm ngoài repo** (xem mục 6.4 vì sao).
- Gói thuê bao Claude của người dùng (Pro/Max/Team?): **chưa biết**. Phase 0 phải đọc `claude auth status` và hỏi người dùng. Thông tin này quyết định có khoản tín dụng API hàng tháng hay không (mục 4.2).

---

## 2. Mục tiêu sản phẩm

Một app web chạy cục bộ trên Windows để:

1. **Ra lệnh một câu → tự điều phối.** Ví dụ: "phân tích website example.com" → một phiên điều phối tự giao việc cho agent tìm kiếm, agent phân tích, agent tổng hợp, qua Claude Code CLI.
2. **Xem hội thoại & lịch sử dễ đọc**: dòng thời gian từng vai, từng tool call, báo cáo cuối; tìm lại các lần chạy; mở lại để hỏi tiếp (resume).
3. **Giảm token** bằng cách chia việc theo vai ngắn hạn, bàn giao qua file nhỏ, có trần số lượt/chi phí; **đo** được token từng lần chạy để biết cách chia có thật sự rẻ hơn một agent đơn hay không.
4. **Xem các phiên dạng văn phòng 2D** theo phong cách claude-office (không 3D).
5. **Chỉ tốn hạn mức thuê bao, không phát sinh phí API** (xem mục 4.2 và 7 — có điều kiện, phải có "billing guard").

Ngoài phạm vi (non-goals): giao diện 3D; cung cấp/bán cho người ngoài; thay thế Claude Code; dùng `bypassPermissions`; parse JSONL transcript nội bộ làm nguồn dữ liệu chính.

---

## 3. Quyết định đã chốt

| # | Quyết định |
|---|---|
| D1 | Trực quan hóa **2D theo claude-office**. Bỏ 3D. |
| D2 | **Cách A**: một phiên "coordinator" (`claude -p`) cùng các subagent định nghĩa bằng `--agents` (file JSON). Phiên chính tự giao việc theo `description` của subagent. **Cách B** (app tự bật từng `claude -p` theo kế hoạch do một bước planner trả về) là Phase 4 tùy chọn, chỉ làm khi cần kiểm soát từng vai. |
| D3 | Ứng dụng điều khiển ("controller") viết mới bằng **Node.js + TypeScript**, spawn `claude` trực tiếp (không qua shell), đọc `--output-format stream-json`. |
| D4 | "Văn phòng 2D" = **claude-office chạy nguyên bản** (backend FastAPI :8000, frontend Next.js :3000) nhúng vào tab/iframe của controller. Không sửa source claude-office trừ khi bắt buộc; cấu hình bằng biến môi trường. Giữ LICENSE MIT (© 2026 Paul Robello). |
| D5 | Xác thực mặc định: **"subscription"** (đăng nhập claude.ai). Có công tắc "api" kèm cảnh báo chi phí. **Không dùng `--bare` ở chế độ subscription** (mục 4.1, 4.2). |
| D6 | Quyền: `--permission-mode dontAsk` + danh sách cho phép tường minh (`--allowedTools`). Không bao giờ `bypassPermissions` / `--dangerously-skip-permissions`. Duyệt quyền tương tác là Phase 4. |
| D7 | Bảo mật cục bộ: bind `127.0.0.1`, token bắt buộc, kiểm tra `Origin` và `Host` (chống DNS rebinding / website lạ gọi vào localhost). |
| D8 | Lưu trữ: SQLite (metadata + sự kiện chuẩn hóa) **và** file `stream.jsonl` thô cho mỗi lần chạy (để phát lại/gỡ lỗi mà không phụ thuộc parser). |
| D9 | Giao diện **tiếng Việt**, có i18n ngay từ đầu (`vi` mặc định, `en` phụ). |
| D10 | Dùng **nội bộ**. Không chia sẻ đăng nhập thuê bao cho người khác. Không đặt tên/biểu trưng "Claude Code" cho sản phẩm. |

---

## 4. Sự kiện đã xác minh

### 4.1 Claude Code CLI **[DOCS]**

Cờ & hành vi liên quan (đối chiếu từ CLI reference và trang "Run Claude Code programmatically"):

- `-p/--print`: không tương tác. `--output-format text|json|stream-json`. `stream-json` cần `--verbose`; thêm `--include-partial-messages` để nhận delta token. Dòng cuối là message `result` (câu trả lời cuối, **`total_cost_usd`**, usage theo model, `session_id`, `permission_denials`…). `--output-format json` + `--json-schema` trả `structured_output`.
- `system/init` là event đầu: model, tools, mcp_servers, plugins, `capabilities` (dùng để feature-detect thay vì so version). Có thêm `system/api_retry` (retry khi API lỗi), `permission_denied`.
- `--agents <json|đường dẫn file>`: định nghĩa subagent cho phiên. **Dạng file chỉ dùng được với `--print` và cần ≥ 2.1.281**; Claude Code validate lúc khởi động và **thoát nếu JSON sai**. Trường chắc chắn dùng được: `description`, `prompt`, `tools`, `model` (thiếu `description` thì bị từ chối — xem 4.6). Các trường khác như `maxTurns`, `permissionMode`… có trong frontmatter file `.claude/agents/*.md`; CLI 2.1.304 **không từ chối** `maxTurns` trong `--agents` JSON (4.6) nhưng **chưa chứng minh nó có hiệu lực** → Phase 0 kiểm tra.
- Subagent: context riêng, chỉ trả bản tóm tắt về phiên chính; tự được gọi khi tác vụ khớp `description`; có thể chạy song song (mặc định tối đa 20, đổi bằng `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`); lồng nhau tối đa 3 tầng (đổi bằng `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, đặt `1` để tắt lồng); **mỗi subagent tốn token riêng và tính vào hạn mức**; tên công cụ tạo subagent là `Agent`; mô tả của mọi subagent nằm trong context phiên chính nên phải ngắn.
- `--forward-subagent-text` (≥ 2.1.211; mọi độ sâu lồng ≥ 2.1.219): đưa text/thinking của subagent vào stream; mọi message của subagent mang `parent_tool_use_id` (message của phiên chính có `null`) → dựng được cây agent.
- Quyền khi `-p`: từ ≥ 2.1.302, `-p` khởi động ở chế độ **Manual** nếu không đặt mode; lệnh cần duyệt mà không ai duyệt sẽ **bị từ chối**. `--permission-mode dontAsk` từ chối mọi thứ cần hỏi trừ những gì đã nằm trong `--allowedTools`/rule. `--permission-prompts none` (≥ 2.1.259) báo cho Claude biết không có ai duyệt để khỏi thử lại. `--permission-prompt-tool` (một MCP tool) và `canUseTool` (Agent SDK) là hai đường duyệt tương tác.
- Giới hạn: `--max-turns N` (thoát với lỗi khi chạm trần), `--max-budget-usd X` (dựa trên **ước tính phía client**, tính cả chi tiêu subagent, có thể vượt nhẹ). `total_cost_usd` cũng là **ước tính, không phải hóa đơn**; với đăng nhập thuê bao đó chỉ là con số quy đổi.
- Phiên: `-p` lưu phiên (trừ khi `--no-session-persistence`). Resume bằng `--resume <session_id|tên|đường dẫn .jsonl>`, tìm được ở bất kỳ project nào trên máy. `--continue` bỏ qua phiên tạo bởi `-p` trừ khi dùng `claude -p --continue`. `--session-id <uuid>` cho phép ta tự đặt ID. Transcript `.jsonl` nằm dưới `%USERPROFILE%\.claude\projects\`, giữ ~30 ngày (`cleanupPeriodDays`); **định dạng nội bộ, có thể đổi — không dùng làm nguồn chính.**
- Dừng phiên: `SIGINT` (hoặc `interrupt()` của SDK) kết thúc lượt hiện tại sạch sẽ; `SIGTERM` thoát mã 143 và để lượt dở dang, không ghi result. Trên Windows, dùng cơ chế tương đương của Node (kill cây tiến trình) và đánh dấu run là `cancelled`.
- `--bare`: bỏ qua tự khám phá hooks, skills, subagent, plugin, MCP, auto memory, CLAUDE.md; **không bao giờ đọc OAuth/keychain → không dùng được đăng nhập thuê bao, cần `ANTHROPIC_API_KEY`** (hoặc `apiKeyHelper`). Tài liệu ghi `--bare` "sẽ trở thành mặc định của `-p` trong bản sau" → **rủi ro cần theo dõi**; controller phải truyền cờ tường minh, không dựa vào mặc định, và kiểm `claude auth status` mỗi lần chạy.
- Không có `--bare`, `-p` chạy hooks và MCP của project/`~/.claude` **mà không hỏi trust**. Vì vậy cwd của agent phải là thư mục sạch do ta kiểm soát.
- `claude auth status` in JSON, trường `authMethod` ∈ {`none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party`}; thoát mã 0 nếu đã đăng nhập. `claude setup-token` tạo token OAuth dài hạn cho script (cần thuê bao). `claude auth login --console` là đăng nhập tính phí API.
- Có sẵn tính năng gốc **`claude agents`** ("agent view": giám sát/điều phối nhiều phiên nền; `claude agents --json` in danh sách phiên đang chạy; `claude --bg` chạy nền; `claude attach/logs/stop`). Một phần trùng mục tiêu của ta → Phase 0 phải thử để biết ta khác gì (giao diện web tiếng Việt, văn phòng 2D, điều phối theo vai, đo chi phí/vai).
- Hooks (dùng cho claude-office): sự kiện SessionStart, SessionEnd, PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStart/Stop, PermissionRequest, Notification, PreCompact…; kiểu handler `command` và `http`; trên Windows có thể chỉ định `"shell": "powershell"`; mã thoát 2 chặn hành động.

### 4.2 Thanh toán **[DOCS]** (trang hỗ trợ của Anthropic, cập nhật 2026-10-07)

- Khi **đăng nhập bằng gói claude.ai**, `claude -p`, Agent SDK và app bên thứ ba **dùng hạn mức của gói thuê bao**, không tính tiền API theo token. Thay đổi công bố 15/6/2026 đã **tạm hoãn**; ngày 7/10/2026 Anthropic thêm tín dụng API hàng tháng cho Max/Team nhưng vẫn nói có thể dùng thuê bao như trên. **Chính sách đã đổi hai lần trong năm → phải kiểm lại trước khi phát hành và mỗi khi nâng cấp Claude Code.**
- Hạn mức là **dùng chung** với Claude Code tương tác (tính theo các cửa sổ thời gian của gói; cách tính chi tiết xem trang hỗ trợ của gói bạn đang dùng). Chạy nhiều agent song song làm cạn hạn mức nhanh hơn một phiên đơn.
- Nếu tài khoản bật **extra usage** (trả thêm khi vượt hạn mức) thì phần vượt có thể bị tính tiền → khuyên tắt hoặc đặt trần.
- **Tín dụng API hàng tháng** (Max 5x $100; Max 20x $200; Team Standard $20/ghế; Team Premium $100/ghế; Team gộp chung, trần $500/tháng; Pro & Enterprise không có): chỉ dùng cho Claude API, Agent SDK, Managed Agents và `claude -p` **khi chạy bằng khóa API của Console đã liên kết**. Không dùng cho Claude Code tương tác; hết thì request API dừng, **không tự rơi về hạn mức thuê bao**; không cộng dồn; cần ở gói đủ điều kiện 7 ngày trước khi claim.
- Biến môi trường `ANTHROPIC_API_KEY` (hoặc đăng nhập Console) làm CLI chạy theo API → **tính tiền**. Controller phải xóa các biến này khỏi môi trường của tiến trình con ở chế độ subscription và chặn chạy nếu `authMethod` không phải `claude.ai`/`oauth_token`.

### 4.3 claude-office tại `D:\claude-office-main` **[SRC]**

- Giấy phép MIT, © 2026 Paul Robello — **giữ LICENSE và thông báo bản quyền**.
- Luồng: Claude Code hooks → CLI `claude-office-hook <event>` → `POST /api/v1/events` (FastAPI, SQLite, rate-limit 1000/60s mỗi phiên) → EventProcessor/StateMachine → WebSocket → Zustand → PixiJS. **Nguyên tắc: backend là nguồn sự thật, frontend chỉ vẽ lại state do backend tính** (kiểu sinh từ Pydantic: `frontend/src/types/generated.ts`). Hệ quả: không thể nhét sự kiện thô vào frontend; phải chạy backend của nó (hoặc viết lại lớp ánh xạ trạng thái).
- WebSocket: `/ws/{session_id}`, `/ws/room/{room_id}`, `/ws/overview` (Command Center, tối đa 16 client). **Chỉ-đọc**: server nhận rồi bỏ mọi tin nhắn gửi lên (`await websocket.receive_text()` để giữ kết nối). Không có kênh ra lệnh/duyệt quyền — phần đó thuộc controller của ta.
- Đã có: danh sách phiên (`SessionSidebar`), xem hội thoại (`ConversationHistory.tsx`: prompt, trả lời, thinking, tool call), theo dõi token và mức dùng context (`token_tracker.py`; **không có chi phí USD**), phát lại (`GET /sessions/{id}/replay`), Command Center (needs_you/working/done), nhiều tầng/phòng (`backend/floors.toml`), i18n (en, es, pt-BR; **chưa có tiếng Việt**).
- Bảo mật có sẵn: `LocalhostOnlyMiddleware`, `ApiKeyMiddleware` (`X-API-Key`, `hmac.compare_digest`), kiểm tra Origin WebSocket (đóng mã 4003), giới hạn client (4013). Khóa API ngẫu nhiên mỗi lần chạy nếu không đặt `CLAUDE_OFFICE_API_KEY`.
- Hooks: `hooks/manage_hooks.py` (Python thuần) ghi vào `~/.claude/settings.json` (hoặc `$CLAUDE_CONFIG_DIR`) **atomically + sao lưu `.bak`**, đăng ký lệnh `claude-office-hook <snake_case_event>` timeout 2s cho 11 loại hook; có `--dry-run`. `hooks/.../main.py` luôn exit 0, nuốt stdout/stderr, có workaround lỗi OpenSSL trên Windows. `hooks/install.sh` là **bash**, yêu cầu `uv`, cố định `uv tool install -p 3.14` → trên Windows phải chạy tay từng bước (Python 3.14 + uv + bun). **Chưa ai test trên Windows.**
- Mã id phiên của hook: lấy từ env `CLAUDE_SESSION_ID`, mặc định `"default"` trong `main.py` → **[GIẢ ĐỊNH]** `event_mapper` ưu tiên `session_id` trong payload hook; phải kiểm tra, nếu không các phiên sẽ gộp vào "default".
- Tóm tắt AI: `SUMMARY_BACKEND` mặc định `claude-cli` (chạy `claude -p --bare --no-session-persistence --model <SUMMARY_MODEL>`), `SUMMARY_ENABLED=true`. `.env.example` của họ ghi "auth via your logged-in Claude subscription", **nhưng tài liệu Anthropic nói `--bare` không đọc đăng nhập thuê bao** → hoặc nó âm thầm lỗi/rơi về văn bản cục bộ, hoặc dùng `ANTHROPIC_API_KEY` nếu có (tính tiền). **Đặt `SUMMARY_ENABLED=false` và `SUMMARY_BACKEND=disabled`** cho tới khi kiểm chứng.
- Frontend: Next 16.4.2, React 19.3.1, pixi.js 8.22.0, @pixi/react 8.0.5, zustand 5, xstate 5, Tailwind 4; bun lockfile. `POST /sessions/{id}/focus` chỉ có nhánh macOS (AppleScript) và Linux (wmctrl), **không có Windows**.

### 4.4 Claude-Code-Agent-Monitor **[chưa đọc source]**

Theo README đã xem: repo `hoangsonww/Claude-Code-Agent-Monitor` (Node/Express/SQLite/React; hooks + JSONL; có launcher, theo dõi chi phí, bản Electron cho Windows, giao diện có tiếng Việt), giấy phép MIT theo trang repo (cần xác nhận file LICENSE). Người dùng sẽ cung cấp source sau (đặt ở đường dẫn ASCII, ví dụ `D:\claude-code-agent-monitor-main`). Phần đáng học: cách tính chi phí và launcher. **Chưa kiểm chứng ngày commit gần nhất.**

### 4.5 Không dùng / không sao chép

- `siteboon/claudecodeui`: AGPL-3.0 → không sao chép mã.
- `disler/claude-code-hooks-multi-agent-observability`: chưa thấy giấy phép → không sao chép.
- Các bản sao "Claude-Office" từ tài khoản lạ: coi là đáng ngờ.

---

### 4.6 Quan sát trực tiếp bằng CLI 2.1.304 (sandbox của người soạn — **không phải máy người dùng**, tài khoản đăng nhập khác)

Người soạn chạy thử vài lệnh nhỏ để kiểm tra đặc tả; đây là bằng chứng thực nghiệm duy nhất đến nay, phải lặp lại trên Windows ở Phase 0:

- `config/roles.json` là JSON hợp lệ và **được `--agents <file>` chấp nhận** (chạy `-p` đến `end_turn`).
- `--agents` sai bị chặn ngay lúc khởi động với thông điệp dạng `Invalid --agents configuration: x.description: Invalid input: expected string, received undefined` → `description` là trường bắt buộc; validation xảy ra trước khi gọi API.
- Thêm `maxTurns` vào một vai **không gây lỗi** (nhưng chưa biết có tác dụng).
- Output `--output-format json` có các trường: `session_id`, `total_cost_usd`, `usage` (gồm `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `server_tool_use.web_search_requests/web_fetch_requests`…), `duration_api_ms`, `stop_reason`. Dùng làm nguồn đo token/chi phí.
- Khi prompt là đối số mà stdin là một pipe mở không có dữ liệu, CLI chờ ~3 giây rồi cảnh báo `no stdin data received in 3s, proceeding without it` → **controller phải đóng stdin tường minh** (spawn với `stdin: 'ignore'` khi prompt là đối số; khi prompt đi qua stdin thì ghi rồi `end()`).
- Chi phí nền: một lượt "hi" trong sandbox này tốn ~44k token đầu vào (phần lớn là cache) do môi trường đó nạp nhiều skill/plugin/MCP. Máy của bạn sẽ khác; con số này chỉ minh họa rằng "thuế khởi động" (mục 6.4) có thể lớn hơn nhiều so với nội dung câu hỏi.

---

## 5. Kiến trúc (cách A)

```
 Trình duyệt (UI tiếng Việt)  http://127.0.0.1:4800
   ├─ Lệnh · Lần chạy (dòng thời gian từng vai) · Lịch sử · Chi phí/hạn mức
   └─ Văn phòng 2D ──iframe──► claude-office frontend :3000 ◄──WS── backend :8000
            ▲  REST + WS (token)                                      ▲ POST /api/v1/events
            │                                                         │ (claude-office-hook, X-API-Key)
 Controller (Node/TS, :4800) ──spawn──► claude -p  (COORDINATOR)  ──hooks──┘
   │ parse stream-json                    │  Agent tool
   │                                      ├─► searcher     (haiku)  → notes/searcher-*.md
   ▼                                      ├─► analyzer     (sonnet) → notes/analysis.md
 SQLite + runs/<id>/stream.jsonl          └─► synthesizer  (sonnet) → report.md
```

### 5.1 Mô-đun controller

| Mô-đun | Việc |
|---|---|
| `billing-guard` | Trước mỗi run: gọi `claude auth status`, kiểm `authMethod`; ở chế độ subscription xóa `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` (và biến tương tự) khỏi env con; từ chối nếu không phải `claude.ai`/`oauth_token`. Phát cảnh báo nếu phát hiện `--bare` trong cấu hình. |
| `claude-runner` | Dựng dòng lệnh, spawn (không shell), truyền prompt qua stdin, giữ handle để hủy, áp trần (turns, budget, timeout), ghi `stream.jsonl`. |
| `stream-parser` | Đọc NDJSON từng dòng, **chịu lỗi** (event lạ → lưu thô, đánh dấu `unknown`), chuẩn hóa thành sự kiện nội bộ (5.3). |
| `run-store` | SQLite: `runs`, `events`, `artifacts`; thư mục `runs/<id>/`. |
| `api` | REST + WebSocket cho UI, xác thực token, kiểm Origin/Host. |
| `ui` | React + Vite (tiếng Việt). |
| `office-bridge` | Liên kết `run_id` ↔ `session_id` ↔ phiên trong claude-office; nút "Mở trong văn phòng". |

### 5.2 Dòng lệnh chuẩn cho một lần chạy

Chạy với cwd = `D:\tnf-claude-workspace\runs\<run-id>`; prompt người dùng đưa vào **stdin** rồi đóng stdin (tránh giới hạn độ dài/escape của dòng lệnh Windows; nếu stdin không hoạt động như mong đợi thì dùng đối số cuối và đặt `stdin: 'ignore'` — xem 4.6; **[GIẢ ĐỊNH]** stdin hoạt động trên Windows):

```
claude -p
  --output-format stream-json --verbose --include-partial-messages --forward-subagent-text
  --agents  <abs>\config\roles.json
  --append-system-prompt-file <abs>\config\coordinator-prompt.md
  --model sonnet
  --permission-mode dontAsk
  --allowedTools "Agent" "WebSearch" "WebFetch" "Read" "Write"
  --max-turns 40 --max-budget-usd 3
  [--resume <session_id>]            # khi hỏi tiếp
```

Biến môi trường của tiến trình con: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=3`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`.

**[GIẢ ĐỊNH] cần test**: (a) `Agent` có cần nằm trong `--allowedTools` hay không; (b) subagent có thừa hưởng `--allowedTools` của phiên chính khi `dontAsk` không (nếu không, WebSearch/WebFetch/Write của subagent sẽ bị từ chối — khi đó đặt rule trong file `--settings` cho workspace); (c) cú pháp giới hạn `Write` trong thư mục run (ví dụ `Write(./**)`) và giới hạn `WebFetch` theo domain; (d) `--tools "Agent,..."` để thu hẹp công cụ của phiên điều phối.

### 5.3 Sự kiện chuẩn hóa (controller → UI)

`run.started{run_id, session_id?, model, claude_version}` · `agent.started{agent_id, role, parent_id}` · `text.delta{agent_id, text}` · `tool.use{agent_id, tool, input_summary}` · `tool.result{agent_id, ok, summary}` · `agent.finished{agent_id, summary}` · `permission.denied{tool, reason}` · `api.retry{attempt, error}` · `usage.update{input, output, cache_read, cache_write}` · `run.result{ok, text, cost_usd_est, usage, duration_ms, num_turns, permission_denials}` · `run.error{kind, message}` · `run.cancelled`.

Cách suy ra: event có `parent_tool_use_id = null` thuộc coordinator; `tool_use` của tool `Agent` mở một agent mới (role lấy từ tham số subagent_type); message mang `parent_tool_use_id` trỏ tới tool_use đó thuộc về agent con. Lưu **luôn** dòng thô song song.

### 5.4 API nội bộ (đề xuất)

`POST /api/runs {prompt, mode, budget_usd?, model?}` · `POST /api/runs/:id/followup {prompt}` · `POST /api/runs/:id/cancel` · `GET /api/runs` · `GET /api/runs/:id` (+ `/events`, `/report`) · `GET /api/billing/status` · `WS /ws/runs/:id` · `WS /ws/overview`. Mọi request mang header `X-Controller-Token`; WS kiểm Origin ∈ {`http://127.0.0.1:4800`, `http://localhost:4800`}.

### 5.5 Hợp nhất với claude-office

Mặc định (MVP): cài hook claude-office vào `~/.claude/settings.json` (**chỉ sau khi người dùng đồng ý từng bước, dry-run trước**) → mọi phiên `claude`, kể cả phiên controller bật, tự hiện trong văn phòng vì không dùng `--bare`. Điều cần kiểm: id phiên (mục 4.3), hiệu năng khi nhiều subagent, và iframe có bị chặn bởi header hay không (`X-Frame-Options`/CSP — **[GIẢ ĐỊNH]** Next.js mặc định không chặn).

---

## 6. Vai trò agent & chống tốn token

### 6.1 Ba vai (xem `config/roles.json`)

| Vai | Việc | Công cụ | Model mặc định |
|---|---|---|---|
| coordinator (phiên chính) | Lập kế hoạch ≤ 3 dòng, giao việc, trả lời cuối ≤ 10 dòng. **Không tự nghiên cứu.** | `Agent` | `sonnet` |
| searcher | Một câu hỏi hẹp → ghi `notes/searcher-<chủ đề>.md` | WebSearch, WebFetch, Write | `haiku` |
| analyzer | Đọc notes, tách bằng chứng/suy luận, gắn độ tin cậy → `notes/analysis.md` | Read, Write | `sonnet` |
| synthesizer | Báo cáo cuối tiếng Việt → `report.md` | Read, Write | `sonnet` |

Model chỉ là điểm xuất phát — đo rồi chỉnh. Prompt vai viết bằng tiếng Anh cho gọn, **đầu ra bằng tiếng Việt**.

### 6.2 Giao thức bàn giao

Subagent ghi kết quả ra file trong `notes/` hoặc `report.md` và **chỉ trả lại đường dẫn + ≤ 120–150 từ**; coordinator **truyền đường dẫn, không dán lại nội dung**. Mục đích: giữ context phiên chính nhỏ.

### 6.3 Trần chống tốn

Tối đa 4 lần gọi subagent/run; searcher song song tối đa 3; mỗi searcher ~8 tool call; `--max-turns`, `--max-budget-usd`; tác vụ nhỏ (≤ 2 tool call) coordinator tự làm, không gọi subagent. Phiên follow-up dùng `--resume` nên context lớn dần — UI hiển thị cảnh báo và gợi ý bắt đầu run mới.

### 6.4 Giảm "tiền thuế" khởi động mỗi run

Mỗi phiên/subagent nạp system prompt, CLAUDE.md (mọi thư mục cha!), skills, plugin, MCP, git status. Do đó:
- cwd của run **ngoài repo** (`D:\tnf-claude-workspace\runs\<id>`) và workspace gốc **không có CLAUDE.md lớn**; CLAUDE.md của repo dự án không bị nạp vì không nằm trên đường đi lên của cwd.
- Ở chế độ subscription **không thể dùng `--bare`** → cắt tải bằng cách khác: `--setting-sources`, `--disable-slash-commands`, `--strict-mcp-config --mcp-config <file rỗng>`, dọn skill/plugin không cần ở `~/.claude`. **Đo trước/sau.**
- Phase 0 đo "run rỗng" (prompt "chào") để biết chi phí nền.

### 6.5 Thí nghiệm A/B bắt buộc (Phase 0–1)

Ba tác vụ chuẩn: (1) phân tích example.com; (2) so sánh 3 đối thủ cùng ngành theo thông tin công khai; (3) tóm tắt một tài liệu cho trước. Mỗi tác vụ chạy: (a) **một agent đơn** (không `--agents`), (b) **coordinator + 3 vai**. Ghi: tổng token (input/output/cache), `total_cost_usd` (ước tính), số lượt, thời gian, điểm chất lượng 1–5 do người dùng chấm. **Quy tắc quyết định:** chỉ giữ cách chia vai cho loại tác vụ nào mà (b) không tốn hơn (a) đáng kể *hoặc* chất lượng tăng rõ; ngược lại, tác vụ đó để agent đơn xử lý (coordinator tự làm).

---

## 7. Bảo mật & billing guard

- Bind `127.0.0.1` duy nhất; token ngẫu nhiên mỗi lần khởi động (lưu file chỉ người dùng đọc được); kiểm `Origin` và `Host`; không bật CORS rộng; không có endpoint chạy lệnh tùy ý; prompt người dùng **không** được nối vào dòng lệnh shell.
- Không ghi bí mật vào log/DB (loại `ANTHROPIC_*`, token). Không in khóa API.
- Không dùng `bypassPermissions`. Allowlist công cụ tường minh theo từng loại run. WebFetch/WebSearch xem là **nguồn không đáng tin**: nội dung web không được phép tự đổi quy tắc (đã nêu trong prompt vai).
- Billing guard: xem 5.1; UI luôn hiện chế độ xác thực hiện tại và nhãn "chi phí ước tính ≠ hóa đơn". Nếu `authMethod` đổi giữa chừng → dừng run mới và báo.
- Hạn mức thuê bao: **[GIẢ ĐỊNH]** có thể thấy qua event rate-limit trong stream hoặc lệnh `/usage` — Phase 0 kiểm tra; nếu không có API chính thức thì UI chỉ hiện token/chi phí ước tính của app và nhắc người dùng xem `/usage` trong Claude Code.
- Chia sẻ: dùng nội bộ; nếu sau này cho người khác dùng, phải đọc lại điều khoản (đăng nhập thuê bao không dành cho dịch vụ cung cấp cho người ngoài) và chuyển sang khóa API.

---

## 8. Ghi chú Windows

- Tìm `claude.exe` bằng `where claude`; cho phép cấu hình đường dẫn tuyệt đối. Spawn không shell; encoding UTF-8 hai chiều (tiếng Việt có dấu trong prompt, stdout, SQLite, tên file).
- Tránh chuỗi JSON trong dòng lệnh (dấu nháy PowerShell/cmd khác nhau) → luôn dùng `--agents <file>`, `--append-system-prompt-file`, `--mcp-config <file>`, `--settings <file>`.
- Hủy run: kill cả cây tiến trình (Node: `taskkill /T /F /PID` hoặc thư viện tương đương); đánh dấu `cancelled`; kiểm tra không để tiến trình mồ côi.
- claude-office trên Windows: cần Python 3.14 (uv có thể cài), `uv`, bun (hoặc npm) cho frontend; chạy `manage_hooks.py` trực tiếp bằng `uv run`, **không** dùng `install.sh`. Hook timeout chỉ 2 giây — kiểm tra độ trễ khởi động Python trên Windows; nếu hay timeout, cân nhắc hook kiểu `http` gửi thẳng tới backend thay vì lệnh Python (hook `http` là có thật theo tài liệu hooks — **[GIẢ ĐỊNH]** payload tương thích `/api/v1/events` hay không thì chưa, có thể cần một bộ chuyển đổi nhỏ).
- Đường dẫn dài / ký tự lạ: giữ mọi thứ ở `D:\` ASCII.

---

## 9. Lộ trình & nghiệm thu

Ước tính của người soạn **[ƯỚC TÍNH]**: tổng ≈ 13–20 ngày làm việc nếu giữ claude-office nguyên bản; MVP dùng được sau Phase 2 (~2 tuần). Chốt lại sau Phase 0.

| Phase | Nội dung | Nghiệm thu |
|---|---|---|
| **0 — Spike** (1–2 ngày) | Chạy toàn bộ danh sách ở mục 10 trên máy Windows thật; A/B ban đầu; thử `claude agents`; dry-run hook claude-office | `docs/SPIKE-RESULTS.md` có bằng chứng (lệnh, đầu ra rút gọn, kết luận) cho từng mục V1–V16; quyết định điều chỉnh đặc tả |
| **1 — Lõi controller** (3–4 ngày) | `billing-guard`, `claude-runner`, `stream-parser`, `run-store`, CLI `tnf run "<prompt>"` / `tnf resume`, trần & hủy, test với stream ghi sẵn | Chạy tác vụ chuẩn trên Windows → có `report.md`, DB đủ bản ghi, `stream.jsonl`, hủy sạch, resume được; test tự động xanh |
| **2 — API + UI** (5–8 ngày) | REST/WS, UI tiếng Việt: ô lệnh, dòng thời gian từng vai, xem báo cáo (markdown), lịch sử, trạng thái xác thực/chi phí, hỏi tiếp | Người dùng ra lệnh từ trình duyệt và xem trọn lần chạy; quét bảo mật cục bộ đạt (token/Origin/Host); thông báo lỗi tiếng Việt |
| **3 — Văn phòng 2D + đóng gói** (4–6 ngày) | Cài hook claude-office (có xác nhận), nhúng iframe, liên kết run↔session, tắt SUMMARY, script khởi động `start.ps1`, README tiếng Việt | Một lệnh khởi động cả controller + office; run của controller hiện đúng trong văn phòng; hướng dẫn gỡ hook |
| **4 — Tùy chọn** | Cách B (planner + duyệt kế hoạch + từng vai là một `claude -p`), duyệt quyền tương tác (`canUseTool`/`--permission-prompt-tool`), học tính chi phí từ Agent-Monitor, việt hóa i18n cho claude-office nếu nhúng sâu | Theo từng hạng mục |

---

## 10. Danh sách phải kiểm chứng ở Phase 0

- **V1** Phiên bản: `claude --version` ≥ 2.1.281 (khuyến nghị bản mới nhất); `node`, `npm`, `uv`, `python`, `bun` có/không.
- **V2** `claude auth status` → `authMethod` thực tế; biến `ANTHROPIC_API_KEY` có đang đặt không; gói thuê bao là gì.
- **V3** `claude -p` chạy được bằng đăng nhập thuê bao trên máy này; prompt qua stdin hoạt động không.
- **V4** Dạng thật của stream-json: ghi 1 run nhỏ vào `fixtures/`; xác nhận tên trường `session_id`, `total_cost_usd`, `usage`, `parent_tool_use_id`, `permission_denials`.
- **V5** `--agents <file>` với `roles.json` được chấp nhận (đã thấy ở sandbox, lặp lại trên Windows); `maxTurns` không bị từ chối (đã thấy) — kiểm tra **hiệu lực** của `maxTurns`/`permissionMode` trong `--agents`, ví dụ đặt `maxTurns: 1` cho một vai và xem vai đó bị cắt thế nào.
- **V6** Coordinator có thật sự tự giao việc đúng thứ tự searcher → analyzer → synthesizer, tôn trọng trần 4 lần gọi.
- **V7** Subagent có dùng được WebSearch/WebFetch/Write dưới `dontAsk` + allowlist ở phiên chính không; nếu bị từ chối, tìm cấu hình tối thiểu (rule trong `--settings`).
- **V8** Giới hạn `Write` trong thư mục run và `WebFetch` theo domain: cú pháp rule nào hoạt động.
- **V9** Chi phí nền của run rỗng và của run 3 vai; so với agent đơn (A/B mục 6.5).
- **V10** Hủy run trên Windows (SIGINT-tương-đương vs kill cây tiến trình); resume bằng `--resume <session_id>`.
- **V11** Hook claude-office: `manage_hooks.py install --dry-run` chạy được trên Windows; sau khi cài (có xác nhận) — id phiên có đúng không; độ trễ hook có vượt 2 giây không.
- **V12** claude-office khởi động trên Windows (Python 3.14, frontend); iframe nhúng được; `SUMMARY_ENABLED=false` có hiệu lực.
- **V13** `claude agents` / `--bg`: làm được gì, khác gì so với mục tiêu của ta.
- **V14** Có cách đọc hạn mức thuê bao còn lại bằng máy (event rate-limit, `/usage`) không.
- **V15** `--bare` vs không `--bare`: xác nhận bằng thực nghiệm rằng `--bare` không dùng được đăng nhập thuê bao trên máy này (một lệnh nhỏ; nếu có `ANTHROPIC_API_KEY` thì **không chạy** để khỏi tốn tiền — chỉ ghi nhận).
- **V16** Quy tắc `Agent` trong `--allowedTools`/`--tools` (mục 5.2).

---

## 11. Bẫy đã biết

1. `--bare` ⇒ không đăng nhập thuê bao + không hooks ⇒ **cấm ở chế độ subscription**.
2. `ANTHROPIC_API_KEY` trong môi trường ⇒ tính tiền API ngầm.
3. Cờ `--max-budget-usd`/`total_cost_usd` là ước tính; với thuê bao nó chỉ để so sánh, không phải tiền thật.
4. `-p` không hiện trong `--continue`/picker thường; resume bằng ID.
5. `--max-turns` chạm trần ⇒ thoát có lỗi — xử lý như `run.error{kind:"max_turns"}`, không phải crash.
6. `SIGTERM` làm mất kết quả lượt dở; ưu tiên hủy "mềm" nếu có.
7. Subagent nền: run có thể chờ đến 10 phút (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) — đặt timeout tổng cho run.
8. CLAUDE.md ở thư mục cha bị nạp vào mọi run ⇒ cwd phải sạch.
9. Định dạng stream và JSONL có thể đổi theo phiên bản ⇒ parser chịu lỗi, lưu thô, ghi `claude_version` mỗi run.
10. claude-office: WS chỉ-đọc, install.sh chỉ bash, `-p 3.14` cố định, hook timeout 2s, tóm tắt AI dùng `--bare`.
11. Nội dung web do agent lấy về có thể chứa chỉ dẫn độc hại (prompt injection) — vai searcher chỉ trích dẫn dữ kiện, không làm theo chỉ dẫn trong trang.

---

## 12. Nguồn

- Trang hỗ trợ: Use the Agent SDK with your Claude plan — https://support.claude.com/en/articles/15036540-use-the-agent-sdk-with-your-claude-plan
- Trang hỗ trợ: Monthly API credits for Max and Team plans — https://support.claude.com/en/articles/17154008
- CLI reference — https://code.claude.com/docs/en/cli-reference
- Run Claude Code programmatically — https://code.claude.com/docs/en/headless
- Subagents — https://code.claude.com/docs/en/subagents
- Mã nguồn đã đọc: `D:\claude-office-main` (`docs/architecture/ARCHITECTURE.md`, `backend/app/api/routes/websockets.py`, `backend/app/api/middleware.py`, `backend/app/config.py`, `hooks/manage_hooks.py`, `hooks/install.sh`, `.env.example`).
