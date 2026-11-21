# Kết nối MCP, Cấp quyền theo môi trường, Thư mục lưu tệp — thiết kế

Ngày: 2026-11-09. Phạm vi: Cài đặt (hai tab mới + một mục), run coding, tải tệp. Run research và run chia ý tưởng chỉ đọc giữ nguyên.

## Mục tiêu
Một app cá nhân tự đủ, không cần Claude Desktop:
1. Kết nối MCP (connector tài khoản claude.ai, plugin, máy chủ tự thêm) và gán cho từng môi trường.
2. Agent đọc/ghi tệp và thư mục máy như Desktop Commander.
3. Cấp quyền theo môi trường bằng ô tick.
4. Mọi tệp AI tạo ra (ngoài code) về một thư mục cố định, đổi được trong Cài đặt; nút "Tải về" thành "Mở tệp".

## 1. Tab "Kết nối MCP"
- **Nguồn danh sách (đã kiểm bằng `claude mcp list`, CLI 2.1.301):** CLI tự liệt kê máy chủ do plugin cung cấp và connector của tài khoản claude.ai kèm trạng thái `Connected` / `Needs authentication` / `Failed` / `Not configured`. App gọi `claude mcp list` (không shell, có timeout) và hiển thị; không tự cài lại logic OAuth.
- **Đăng nhập một connector:** OAuth chỉ chạy được trong `claude` tương tác. Nút "Đăng nhập" mở cửa sổ terminal chạy `claude` kèm hướng dẫn gõ `/mcp`. Quản lý connector claude.ai ở claude.ai > Settings > Connectors. Tài khoản hiện tại **chưa có connector claude.ai nào** (chỉ có máy chủ của plugin); tab phải hiển thị tình trạng này rõ ràng.
- **Máy chủ tự thêm (registry riêng):** `data/mcp-servers.json` `{ id, name, kind: stdio|http, command, args, env, url, headers, enabled }`. Mẫu có sẵn: chỉ **Desktop Commander** (`npx -y @wonderwhy-er/desktop-commander@latest`); mẫu Filesystem chính thức đã bỏ vì cần tham số thư mục. Giá trị header/env của máy chủ trong registry được che thành `***` trong mọi phản hồi API (vẫn lưu nguyên trong file). Không dùng `claude mcp add --scope user` (sẽ sửa cấu hình toàn cục, trái quy tắc 6).
- **Nút "Kiểm tra":** khởi động máy chủ stdio, gửi `initialize` + `tools/list` (JSON-RPC tự viết ~60 dòng), liệt kê công cụ; không thêm dependency.
- **Kết quả spike (chi tiết ở `docs/SPIKE-RESULTS.md`, mục "MCP (2026-11-09)"):** (a) `--mcp-config` + `--strict-mcp-config` + `--setting-sources project` có hiệu lực: ĐÚNG; (b) các cờ không nuốt giá trị của nhau: ĐÚNG; (c) `bypassPermissions` + `--disallowedTools mcp__<tên>__<công cụ>` chặn được công cụ MCP: ĐÚNG. Về connector claude.ai: với `--strict-mcp-config` thì **0 connector** nạp vào run (kể cả khi không có `--mcp-config`); KHÔNG có `--strict-mcp-config` thì việc nạp connector phụ thuộc điều kiện/thời điểm (một lượt không strict, không `--mcp-config` không thấy connector nào; lượt chạy lại đã đăng nhập, có `--mcp-config`, không strict thì nạp Claude Docs/Odoo/wpvibe MCP/Microsoft 365, 121 công cụ `mcp__`). Chỉ `--strict-mcp-config` loại connector một cách đáng tin. Tiền tố công cụ connector đã xác nhận: `mcp__claude_ai_<Tên, khoảng trắng thành _>__<công cụ>` (ví dụ `mcp__claude_ai_Odoo__*`, `mcp__claude_ai_Microsoft_365__*`).
- **Hành vi mới (đổi mặc định có chủ ý):** run coding luôn truyền `--strict-mcp-config`, trừ khi có tick một connector claude.ai ở tab Cấp quyền; nên connector mặc định TẮT (trước đây có thể với tới được).
- **`/api/mcp/cli/login`** mở cửa sổ terminal với biến môi trường đã làm sạch (bỏ khóa API/token).

## 2. Truy cập tệp máy (Desktop Commander)
- Là mẫu MCP mặc định ở mục 1, gán cho môi trường qua tab Cấp quyền.
- **Rủi ro:** `start_process` / `interact_with_process` chạy lệnh tùy ý nên né được `deny-settings.json` (git push, rm -rf, curl). Mặc định app chặn nhóm này bằng `--disallowedTools` (`start_process`, `interact_with_process`, `force_terminate`, `kill_process`), chỉ mở khi tick "Cho phép chạy lệnh tùy ý (nguy hiểm)" ở tab Cấp quyền.
- **Thực tế (spike e):** Desktop Commander KHÔNG giới hạn được thư mục theo run (cấu hình toàn cục `~/.claude-server-commander/config.json`, chỉ hạn chế thao tác file), nên UI cảnh báo "có quyền toàn bộ ổ đĩa" thay vì truyền thư mục khi sinh `mcp.json`.

## 3. Tab "Cấp quyền" (theo môi trường)
Chọn môi trường (project), tick:
- **Tệp:** sửa/ghi trong worktree; thư mục thêm (mỗi thư mục: chỉ đọc hoặc đọc-ghi; sinh `--add-dir` + `Read/Edit/Write(<dir>/**)`).
- **Web:** WebSearch, WebFetch.
- **Lệnh (nhóm):** Node (npm/npx/pnpm/yarn/tsc/vitest/eslint/prettier), Python (python/py/pytest/pip list/uv), .NET/Rust/Go/make, đọc & liệt kê (ls/dir/cat/grep/Get-ChildItem…), cài gói (pip install…), git khôi phục (restore/reset/stash/checkout HEAD).
- **MCP:** từng máy chủ đã kết nối: tắt / chỉ đọc / đầy đủ. "Chỉ đọc" = danh sách công cụ đọc của máy chủ (với Desktop Commander: read_file, read_multiple_files, list_directory, get_file_info, start_search, get_more_search_results, stop_search, list_searches).
- **Thực thi (đã làm):** vì run coding dùng `bypassPermissions`, allowlist chỉ mang tính thông tin; nhóm không tick, `fileWrite=false` và thư mục thêm chỉ đọc được thể hiện bằng quy tắc `--disallowedTools` (`grantsToDisallowedTools`). **Đây là rào chắn cho agent hợp tác, không phải hộp cát bảo mật:** quy tắc chặn theo tiền tố có thể bị vượt qua (ví dụ shell lồng nhau), việc đọc ngoài worktree không bị giới hạn, "thư mục ngoài" chủ yếu kiểm soát việc ghi; UI có dòng ghi chú này. MCP "chỉ đọc" luôn chặn công cụ chạy lệnh dù bật "chạy lệnh tùy ý". `GrantsSection` liệt kê connector claude.ai (tắt/đầy đủ), Desktop Commander (tắt/chỉ đọc/đầy đủ) và ô "Cho phép MCP chạy lệnh tùy ý" (mặc định tắt).
- **Khóa vĩnh viễn (hiển thị mờ, không tick được):** git push, rm -rf, reset --hard, curl… đúng `deny-settings.json` hiện có; deny luôn thắng allow.
- **Mặc định:** mọi ô nhóm Lệnh/Web/Tệp tick sẵn đúng bộ `CODING_ENV_TOOLS` hiện tại → môi trường cũ chạy y hệt trước; MCP mặc định tắt.
- **Lưu:** cột `grants` (JSON) mới trong bảng `projects` (migration `ALTER TABLE … ADD COLUMN`, mặc định `{}` = dùng mặc định); hồ sơ "Mặc định" cho run không gắn môi trường. Mã thuần ở `src/core/grants.ts` (`resolveGrants`, `grantsToAllowedTools`, `grantsToMcpConfig`); `buildCodingAllowedTools` gọi nó thay cho hằng cố định. `allowed_commands` cũ vẫn giữ và nối thêm.
- **API:** `GET/PUT /api/projects/<tên>/grants`, `GET/PUT /api/grants/default`.

## 4. Thư mục lưu tệp
- **Cài đặt mới** "Thư mục lưu tệp": mặc định `<workspace>\outputs`, đổi được; lưu trong `data/settings.json` (`outputDir`), kiểm: đường dẫn tuyệt đối, ASCII (quy tắc 10), tạo được, ghi được; nút "Chọn thư mục" dùng API duyệt thư mục server đã có ở form thêm tầng, nếu có.
- **Quy ước:** `<outputDir>\<run-id>\…`. "Tệp không phải code" = mọi artifact của run (báo cáo, notes, docx/xlsx/pdf/html/dxf/step…) và tệp skill tạo ra; **tệp code ở lại worktree**. Đồng bộ (sao chép, idempotent) khi run kết thúc và khi artifact đổi; không di chuyển/xóa gốc.
- **Nút:** "⤓ Tải về" / "⤓ Tải tất cả" đổi thành "Mở tệp" / "Mở thư mục lưu": gọi `POST /api/runs/<id>/open-output` (tùy chọn `rel_path` → Explorer `/select,<tệp>`; không có → mở `<outputDir>\<run-id>`). Đường dẫn không bao giờ lấy từ request (giống `openDir` hiện tại), `rel_path` đi qua `safeJoin`. Phần skill-workshop: các nút tải đổi cùng kiểu, lưu vào `<outputDir>\skills\<slug>\`.
- **Lưu ý truy cập từ điện thoại:** "Mở tệp" mở Explorer trên **máy chạy app**, không phải điện thoại. Khi không phải localhost UI hiện dòng chú thích; nút zip tải về giữ lại dạng nút phụ chỉ ở chế độ điện thoại.

## 5. Kiểm thử và phát hành
- Test đơn vị: `grants` (mỗi tick ↔ rule), mặc định không đổi allowlist hiện có, khóa vĩnh viễn thắng, `mcp.json` đúng, validate outputDir, đồng bộ artifact, `open-output` từ chối đường dẫn ngoài.
- UI: hai tab mới, tick/lưu, 375 px (quy ước cũ), i18n vi/en.
- Chạy `npx vitest run --maxWorkers=1 --testTimeout=120000`, typecheck, build UI; một smoke thật `--coding` có MCP Desktop Commander (tốn hạn mức, hỏi trước). Ghi bằng chứng vào `docs/PROGRESS.md`; phiên bản 0.10.0.

## Ngoài phạm vi
Tự làm OAuth cho connector; MCP cho run research/chia ý tưởng; đồng bộ ngược từ outputDir về run; xóa tự động tệp cũ.
