# AGENTS.md — Hướng dẫn cho AI Agent (Antigravity / Claude Code / OpenAI Codex)

> Đây là tệp hướng dẫn gốc chính thức của dự án **TNF CLI** (`D:\tnf-claude-controller`), dùng chung cho mọi coding agent (Antigravity CLI, Claude Code CLI, OpenAI Codex CLI).

**Đọc đầu phiên:** đọc tệp này → `docs/HANDOVER.md` (tóm tắt trạng thái, bản đồ mã, việc mở dưới 10k token) → mục đầu của `docs/PROGRESS.md` (nhật ký mới nhất). Không cần đọc lại toàn bộ mã nguồn hay nhật ký cũ trong `docs/archive/` trừ khi nhiệm vụ yêu cầu.

## 1. Dự án là gì
**TNF CLI** là app web chạy **cục bộ trên Windows** (`127.0.0.1:4800`, Node.js ≥ 22.5 + TypeScript + SQLite + React/Vite), điều phối **3 AI CLI** bằng **tài khoản thuê bao / OAuth** (tuyệt đối không dùng API Key, không dùng AI Credit):
1. **Claude Code CLI** (`claude -p`): điều phối subagent (`analyst`, `planner`, `critic`, `implementer`, `qa`, `debug`), cô lập nhiều tài khoản qua `CLAUDE_CONFIG_DIR`.
2. **Antigravity CLI** (`agy --input-format stream-json --output-format stream-json`): Google OAuth, ép `"useG1Credits": false`, `"modelProvider": ""`, hỗ trợ phân vai Mức B và lập trình đa pha Mức D.
3. **OpenAI Codex CLI** (`codex exec --json`): đăng nhập ChatGPT (`codex login`), cô lập nhiều tài khoản qua `CODEX_HOME`, sandbox `read-only` / `workspace-write`.

Mã lập trình được viết trong **git worktree riêng** (`<worktreesDir>/<run-id>`, nhánh `tnf/<run-id>`) để repo chính luôn sạch. UI gồm cảnh thành phố một màn hình (`CityScene.tsx`), văn phòng 2.5D isometric (`OfficeScene25D.tsx`, `IsoPerson.tsx`), hàng đợi ý tưởng → task, Xưởng 3D (CadQuery + Blender), Xưởng Video AI (demo), và Cài đặt Tài khoản CLI.

## 2. Ngôn ngữ & Quy tắc giao diện song ngữ
- Giao tiếp với người dùng, UI, thông báo lỗi hiển thị, báo cáo agent: **tiếng Việt** (mặc định).
- Mã nguồn, tên biến, tên tệp, commit message: **tiếng Anh**.
- **Quy tắc cứng song ngữ UI:** mọi chuỗi hiển thị phải có đồng thời trong `ui/src/i18n/vi.ts` và `ui/src/i18n/en.ts` (cùng bộ khóa, facade tại `ui/src/i18n.ts`), hoặc dùng `pick(vi, en)` từ `ui/src/lib/lang.ts`. Giao diện tiếng Anh không được lẫn tiếng Việt (`tests/ui/english-ui-no-vietnamese.test.ts`).

## 3. Quy tắc cứng (bắt buộc tuân thủ)
1. **Không API Key, không AI Credit:**
   - Claude: xóa `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`; chạy `claude auth status`; cấm `--bare` và `--dangerously-skip-permissions`.
   - Antigravity: xóa `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `AGY_ADC_AUTH`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_*`; ép `"useG1Credits": false`, `"modelProvider": ""` trong file `--settings` của từng run.
   - Codex: xóa `OPENAI_API_KEY`, `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_BASE_URL`, `AZURE_OPENAI_API_KEY`; cấm `--dangerously-bypass-approvals-and-sandbox`.
2. **Spawn không qua shell** (`shell: false`): prompt truyền qua stdin hoặc file tạm; dùng file cho `--agents`, `--append-system-prompt-file`, `--settings`, `--mcp-config`.
3. **Bảo mật local:** server chỉ bind `127.0.0.1`; mọi API/WS cần header `X-Controller-Token` (hoặc subprotocol `tnf-token.<token>`) và kiểm `Origin`/`Host`.
4. **Không đụng cấu hình toàn cục:** không sửa `~/.claude/settings.json`, không cài hook toàn cục, không `npm/pip/uv install -g` khi chưa hỏi người dùng.
5. **Riêng tư trước khi công khai:** luôn chạy `npm run privacy:scan` (phải ra `Sạch`). Không bao giờ commit `data/`, `controller.token`, `.privacy-denylist`, ảnh chụp thật chứa dữ liệu cá nhân, hay `allowedOrigins` thật.
6. **Phát hành công khai:** dùng `npm run publish:snapshot` (tạo nhánh `public-snapshot` 1 commit sạch lịch sử). Không tự động `--push` lên remote nếu người dùng chưa yêu cầu rõ.
7. **Tệp `.ps1` / `.iss` có tiếng Việt** phải giữ **UTF-8 with BOM** để PowerShell 5.1 không lỗi cú pháp.
8. **Chất lượng code:** không dùng `any` mới trong TypeScript; cập nhật `docs/PROGRESS.md` kèm bằng chứng chạy thật sau mỗi đợt thay đổi lớn.

## 4. Lệnh thường dùng
```powershell
npm run typecheck                 # Kiểm tra TypeScript cả backend + UI
npm run test:fast                 # Bộ test nhanh (< 30s): CLI providers, accounts, phased, i18n, billing, stream, release
npm test                          # Toàn bộ test suite (không gọi CLI thật)
npm run build:ui                  # Build giao diện React/Vite
npm run privacy:scan              # Quét lộ dữ liệu cá nhân / khóa bí mật
.\scripts\start.ps1               # Chạy thật
.\scripts\start.ps1 -Demo         # Chạy offline với 3 CLI giả (fake-claude, fake-agy, fake-codex)
npm run tnf -- accounts list      # Quản lý tài khoản CLI
npm run package                   # Đóng gói build/app/
npm run installer                 # Tạo bộ cài build/TNF-CLI-Setup-<version>.exe (Inno Setup 6)
```

## 5. Bản đồ mã nguồn cốt lõi
- `src/core/shared-types.ts`: kiểu dùng chung giữa backend và UI (`CliProviderId`, `CliAccountPublic`, `RoleAccountMap`, ...).
- `src/core/run/providers/`: lớp trừu tượng `CliProvider`, `registry.ts`, `model-distribution.ts` (tự ánh xạ model/tier giữa 3 CLI), `claude-provider.ts`, `agy-{locator,guard,permissions,stream-parser,runner,provider,agent-files}.ts`, `codex-{locator,guard,stream-parser,runner,provider}.ts`.
- `src/core/run/`: `cli-accounts.ts` (`CliAccountStore`, `CLAUDE_CONFIG_DIR` / `CODEX_HOME`, failover), `phase-orchestrator.ts` (`runPhasedCoding` trộn nhiều CLI trên 1 worktree), `run-manager.ts`, `run-store.ts` (SQLite `node:sqlite`), `billing-guard.ts`, `stream-parser.ts`, `events.ts`, `grants.ts`.
- `src/core/{app,git,queue,ideas,mcp,preview,roles,usage,design3d,release,skill-workshop,workshop3d}/`: các phân hệ lõi.
- `src/server/`: `index.ts`, `http.ts`, `auth.ts`, `routes/cli-accounts.ts`.
- `src/cli.ts`: lệnh `tnf` (`run`, `resume`, `serve`, `accounts`, `projects`, `list`, `show`, `status`, `open`, `w3d`).
- `ui/src/`: `App.tsx`, `api.ts`, `types.ts`, `i18n.ts` (facade cho `i18n/vi.ts` + `i18n/en.ts`), `components/settings/CliAccountsSection.tsx`, `office/` (`CityScene.tsx`, `OfficeScene25D.tsx`, `iso/IsoPerson.tsx`).
- `fixtures/`: `fake-claude.mjs`, `fake-agy.mjs`, `fake-codex.mjs` (cho test & chế độ `-Demo` offline hoàn toàn).
- `.github/workflows/ci.yml`: CI tự động (`typecheck`, `test:fast`, `build:ui`, `privacy:scan`).
