# HANDOVER — Brief khởi động phiên mới (cập nhật 2026-11-21)

Đọc [`AGENTS.md`](../AGENTS.md) và tệp này **trước**. Mục tiêu: bất kỳ phiên mới nào (Antigravity, Claude Code hoặc Codex) đều có thể làm tiếp ngay mà **không cần đọc lại toàn bộ mã nguồn**.

## 1. Dự án hiện tại (TNF CLI)
- **Tên dự án:** **TNF CLI** (đổi tên từ *TNF Claude Controller*; thư mục repo vẫn là `D:\tnf-claude-controller`, giữ nguyên `AppId` và `%LOCALAPPDATA%\TNF\Controller` của Inno Setup để cài đè không mất dữ liệu).
- **Công nghệ:** Windows local web app (`127.0.0.1:4800`), Node.js ≥ 22.5, TypeScript (0 lỗi, không `any` ở vùng lõi/UI mới), SQLite (`node:sqlite`), React 19 + Vite 8, Vitest 5.
- **Đa CLI (3 nhà cung cấp — 100% gói thuê bao / OAuth, KHÔNG API Key, KHÔNG AI Credit):**
  1. **Claude Code CLI (`claude`)**: nhiều tài khoản cô lập bằng `CLAUDE_CONFIG_DIR` (`data/cli-profiles/<id>`).
  2. **Antigravity CLI (`agy`)**: Google OAuth, ép `"useG1Credits": false` và `"modelProvider": ""`, lọc lệnh nguy hiểm bằng `command(regex:...)`, bắt soft-deny thành `permission.denied`.
  3. **OpenAI Codex CLI (`codex`)**: ChatGPT OAuth (`codex login`), nhiều tài khoản cô lập bằng `CODEX_HOME` (`data/cli-profiles/<id>`), chạy `codex exec --json --sandbox read-only|workspace-write` và `codex exec resume`.
- **Tự phân phối model & lập trình đa pha:**
  - `src/core/run/providers/model-distribution.ts`: tự ánh xạ tier (`light` / `balanced` / `strong`) và model chéo giữa Claude (`haiku`/`sonnet`/`opus`), Antigravity (`gemini-3.8-flash-low` / `gemini-4-argon-medium` / `gemini-4-neon-high`), và Codex (`gpt-5.3-codex-mini` / `gpt-5.3-codex` / `gpt-5.4` / `o3`).
  - **Mức A:** chọn tài khoản / provider cho từng lần chạy (`POST /api/runs`, `CommandPage.tsx`, `tnf run --provider|--account`).
  - **Mức B:** gán tài khoản CLI riêng cho từng vai trong Cài đặt → Tài khoản CLI (`GET/PUT /api/cli/role-accounts`), đã nối vào Xưởng 3D, Hàng đợi ý tưởng, Xưởng Video và Xưởng kỹ năng.
  - **Mức D:** `runPhasedCoding` (`src/core/run/phase-orchestrator.ts`, `POST /api/runs/phased`) phối hợp nhiều CLI khác nhau (ví dụ Claude `analyst` + Antigravity `critic` + Codex `implementer`/`qa`) trên **cùng một git worktree**; `.agents/agents/<role>/agent.md` tạm được ẩn bằng `.git/info/exclude` và tự xóa sạch sau pha.

## 2. Giao diện & Trải nghiệm (UI/UX)
- **Giao diện một màn hình (`ui/src/App.tsx`):** bảng trái (`LeftPanel.tsx`) + cảnh thành phố (`CityScene.tsx` có ánh sáng tầng đang hoạt động, sương chân trời) + Văn phòng 2.5D isometric (`OfficeScene25D.tsx`, `IsoPerson.tsx` có nhịp thở/chớp mắt/gõ phím riêng từng nhân vật qua `--p-phase`/`--p-blink-delay`/`--p-type-dur`, ánh sáng màn hình, bóng đổ 2 lớp).
- **Song ngữ hoàn chỉnh:** `ui/src/i18n/vi.ts` và `ui/src/i18n/en.ts` tách riêng, `ui/src/i18n.ts` làm facade mỏng; `tests/ui/english-ui-no-vietnamese.test.ts` đảm bảo bản tiếng Anh không lẫn tiếng Việt.
- **Tab Cài đặt → Tài khoản CLI (`CliAccountsSection.tsx`):** thêm/sửa/xóa/bật/tắt/đặt mặc định tài khoản cho cả 3 CLI, kiểm tra đăng nhập (`check`), mở cửa sổ đăng nhập local (`login`), bật tự chuyển dự phòng (`autoFailover` / `crossProviderFailover`), và phân vai Mức B.

## 3. Trạng thái kiểm chứng mới nhất (2026-11-21)
- `npm run typecheck`: PASS (backend + UI, 0 lỗi).
- `npm run test:fast`: PASS (bao gồm `cli-accounts-and-agy.test.ts`, `codex-provider.test.ts`, `phased-and-role-routing.test.ts`, `billing-guard.test.ts`, `stream-parser.test.ts`, `english-ui-no-vietnamese.test.ts`, `release-pipeline-run.test.ts`).
- `npm run build:ui`: PASS.
- `npm run privacy:scan`: Sạch.
- **Kiểm chứng thực tế đã chạy trên máy host:** `agy.exe` (v1.5.13) đã xác minh thật (`docs/SPIKE-RESULTS.md`); `claude.exe` đã xác minh thật; `codex` **chưa cài / chưa có tài khoản trên máy** nên đã kiểm chứng toàn bộ luồng (auth guard, `CODEX_HOME`, `exec --json`, `resume`, git worktree commit, và 3-provider phased coding) **offline** qua `fixtures/fake-codex.mjs`.

## 4. Việc mở / Gợi ý cho phiên tiếp theo
1. **Kiểm chứng thật OpenAI Codex CLI (`codex`)**: khi người dùng đăng ký tài khoản ChatGPT/Codex và cài `@openai/codex`, chạy `codex login` → `npm run tnf -- accounts add "ChatGPT" --provider codex` → `npm run tnf -- accounts check <id>` để đối chiếu định dạng NDJSON thật của `codex exec --json` với `CodexStreamParser`.
2. **Mở rộng UI cho Lập trình đa pha (Mức D)**: API `POST /api/runs/phased` đã hoạt động; có thể thêm nút/công tắc "Chạy đa pha (trộn CLI)" ngay trong `CommandPage.tsx`.
3. **Tối ưu thêm hiệu ứng sống động (Gói 2 / Gói 3)**: di chuyển ngẫu nhiên ngắn giữa các điểm trong phòng, bong bóng hội thoại ngắn giữa các vai khi bàn giao (từ `analyst` → `planner` → `implementer`).
4. **Dọn nợ kỹ thuật cũ (ưu tiên thấp):** quy vai chính xác cho `vcs.commit` từ lệnh `git commit` gần nhất; kiểm thật vòng `debug → qa` và `Skill(<tên>)` với `--setting-sources project`; kiểm AR/USDZ Xưởng 3D trên điện thoại thật.
5. **Chú ý bản cài thật trên máy người dùng:** nếu người dùng đang chạy bản cài tại `%LOCALAPPDATA%\TNF\Controller` trên cổng 4800, khi test dev hãy dùng `-Port` khác (ví dụ 4810) và không tắt tiến trình bản cài.
