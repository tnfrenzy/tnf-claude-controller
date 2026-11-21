# Xem trước (mức 1: ảnh chụp) cho Môi trường — thiết kế

Ngày: 2026-11-09. Nhánh: `feat/preview-screenshots`. Trạng thái: chờ người dùng duyệt spec.

## 1. Mục tiêu và phạm vi

Người dùng tạo Môi trường cho một website hoặc phần mềm desktop và muốn xem giao diện có đúng ý không mà không phải tự dựng. Bấm một nút ở trang Run để controller chụp ảnh rồi xem ngay trong app.

**Trong phạm vi (đã chốt qua hỏi đáp):**
- Chỉ **mức 1: ảnh chụp**, do controller tự làm bằng mã cố định. Không agent, không MCP, không tốn token.
- Chỉ chạy **khi bấm nút**. Không tự chạy sau run.
- **Website:** chạy máy chủ phát triển trong worktree của run, chụp từng trang ở 375 px và 1280 px bằng Edge headless (`msedge --headless --screenshot`), không thêm thư viện.
- **Phần mềm desktop:** khởi chạy exe, chụp cửa sổ bằng helper C# nhỏ dùng `PrintWindow`, biên dịch bằng `csc.exe` có sẵn trong Windows.

**Ngoài phạm vi:** mức 2 (kịch bản bấm qua luồng, timeline từng bước), mức 3, mẫu MCP agent-desktop (do nhánh `agent-desktop-preset` của phiên khác làm), điều khiển phần mềm từ giao diện web.

## 2. Khai báo ở Môi trường

Cột mới `preview TEXT` (JSON) ở bảng `projects`, thêm bằng migration giống cột `grants` (`src/core/run-store.ts`, `ALTER TABLE ... ADD COLUMN` khi thiếu cột). Lược đồ:

```ts
type PreviewConfig =
  | { kind: "none" }
  | { kind: "web"; startCommand: string; url: string; pages: string[]; readyTimeoutSec: number }
  | { kind: "desktop"; exePath: string; args: string[]; windowTitle: string; settleSec: number };
```

Kiểm hợp lệ (`validatePreview`, thuần, thông báo tiếng Việt):
- `web`: `startCommand` không rỗng; tách thành chương trình + đối số bằng bộ tách có sẵn, **không chạy qua shell**; `url` là `http://localhost|127.0.0.1[:cổng]` (không cho host ngoài); `pages` ≤ 12 mục, mỗi mục bắt đầu bằng `/`, không chứa `..`, ký tự in được; mặc định `["/"]`; `readyTimeoutSec` 5–300, mặc định 60.
- `desktop`: `exePath` tuyệt đối, ASCII, tệp tồn tại, đuôi `.exe`; `windowTitle` không rỗng (khớp chứa, không phân biệt hoa thường); `settleSec` 1–30, mặc định 3; `args` ≤ 10.
- API: `GET/PUT /api/projects/:name/preview` (theo mẫu `/api/grants`); form ở màn hình môi trường (khu "Xem trước", tiếng Việt).

## 3. Cơ chế chụp (`src/core/preview.ts`)

Một hàm `runPreview(opts)` trả `PreviewResult`; mọi bước có hạn thời gian và dọn dẹp trong `finally`. Các phụ thuộc (spawn, locateBrowser, fetch, thời gian) truyền vào để test không cần Edge/Claude thật.

**Web**
1. Cwd = worktree của run (đã có `node_modules`). Cần worktree còn tồn tại, nếu không báo "Worktree đã bị dọn".
2. Spawn `startCommand` không qua shell, `windowsHide`, đặt cổng qua biến môi trường `PORT` nếu `url` có cổng.
3. Thăm dò `url` (HTTP GET, mỗi 500 ms) tới khi trả mã < 500 hoặc hết `readyTimeoutSec`; tiến trình thoát sớm thì báo lỗi kèm 20 dòng log cuối.
4. Với mỗi trang × {375, 1280}: `locateBrowser` (đã có ở `browser-locator.ts`) rồi `--headless --disable-gpu --hide-scrollbars --user-data-dir=<tmp> --window-size=W,H --virtual-time-budget=5000 --screenshot=<file> <url><page>`. 375×812 và 1280×800.
5. Dọn: giết cả cây tiến trình dev server (`taskkill /T /F /PID`), xóa profile tạm.

**Desktop**
1. Biên dịch một lần `tools/preview-capture.cs` bằng `csc.exe` (`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319`) thành `<dataDir>/tools/preview-capture.exe`; biên dịch lại khi hash nguồn đổi. Không có `csc.exe` thì báo lỗi rõ.
2. Spawn `exePath` với `args`, đợi `settleSec`, rồi chạy helper `preview-capture.exe --title <windowTitle> --pid <pid> --out <png>`: tìm cửa sổ cấp cao nhất hiển thị khớp tiêu đề (ưu tiên cùng PID), `PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)`, ghi PNG.
3. Phát hiện ảnh toàn đen/toàn trắng (lấy mẫu điểm ảnh) thì trả lỗi "Ảnh rỗng (ứng dụng vẽ bằng GPU?)", không lưu ảnh rỗng như thể thành công.
4. Đóng ứng dụng: `CloseMainWindow`, sau 3 giây thì `taskkill /T /F`.
5. Chỉ chạy được trên máy chạy app (xem §5).

**Spike bắt buộc (nhiệm vụ đầu của kế hoạch):** thử helper trên Notepad và Calculator ở máy này; kiểm Defender/AMSI có chặn biên dịch hoặc chạy không, và ảnh có đen không. Nếu hỏng, **dừng và hỏi người dùng** về phương án Alt+PrintScreen (SendKeys + clipboard) trước khi làm tiếp phần desktop; phần web không phụ thuộc spike.

## 4. Lưu trữ và API

- Ảnh ghi vào `<outputDir>/<runId>/preview/<slug>-<width>.png` (web, slug từ đường dẫn trang, `/` → `home`) hoặc `window.png` (desktop), cộng `preview.json`:
  ```json
  { "kind": "web", "started_at": 0, "finished_at": 0, "status": "ok|partial|error",
    "shots": [{ "file": "home-375.png", "label": "/", "width": 375, "ok": true }],
    "error": null, "log_tail": ["..."] }
  ```
  Đi qua `resolveInside` của `outputs.ts`; nút "Mở tệp" dùng lại `POST /api/runs/:id/open-output`. Chụp lại ghi đè lượt trước (xóa thư mục `preview/` cũ trước).
- Endpoint (`src/server/http.ts`, cần token như mọi API):
  - `POST /api/runs/:id/preview` — khởi chạy nền, trả 202; 409 nếu run này đang chụp; 400 nếu môi trường chưa khai báo hoặc `kind: none`; 403 khi ô tick quyền tắt hoặc (desktop) đi qua đường hầm.
  - `GET /api/runs/:id/preview` — trạng thái (`idle|running|ok|partial|error`), bước hiện tại, nội dung `preview.json`.
  - `GET /api/runs/:id/preview/<file>` — trả PNG, chỉ tệp `.png` trong thư mục preview, chặn path traversal.
- Chỉ run có `worktree_path` còn tồn tại và thuộc môi trường có khai báo mới chụp được. Trạng thái đang chạy giữ trong bộ nhớ `RunManager`; khởi động lại thì coi là `idle` (có `preview.json` thì hiện kết quả cũ).
- Không tạo run, không ghi vào luồng sự kiện run, không tính vào "Lệnh run tối đa".

## 5. Quyền

Thêm khóa `preview: boolean` vào `Grants` (`src/core/grants.ts`), **tắt mặc định** (`DEFAULT_GRANTS.preview = false`), nhãn "Cho phép chạy ứng dụng/máy chủ để xem trước". `sanitizeGrants` và `resolveGrants` xử lý như các ô khác. Khóa này **không** sinh luật `--allowedTools` hay `--disallowedTools` (không có agent): chỉ controller kiểm trước khi spawn. Hệ quả: thay đổi chỉ chạm `grants.ts` (khóa + test) và `ui/src/components/GrantsSection.tsx` (một ô tick). Phiên `agent-desktop-preset` đang đụng `mcp-registry.ts`/`McpSection.tsx`; ta không sửa hai file đó. Nếu nhánh kia cũng sửa `GrantsSection.tsx`, **phần UI của ô tick làm sau khi nhánh đó gộp** để tránh xung đột; phần lõi `grants.ts` và API làm trước, ô tick tạm thời đặt ở khu "Xem trước" của môi trường nếu cần.

Phần mềm desktop chỉ chụp được khi yêu cầu đến từ máy chạy app: bị từ chối nếu đi qua đường hầm (cùng cách `src/server/http.ts` chặn nút đăng nhập connector). Website chụp được cả từ điện thoại vì chỉ chạy dev server cục bộ.

Lưu ý nguồn gốc: `startCommand` và `exePath` do người dùng khai báo; không lấy từ nội dung run hay web. Không ghi lệnh vào đường dẫn dưới dạng chuỗi shell.

## 6. Giao diện (tiếng Việt, 375 px và ≥ 1280 px)

- Tab "Xem trước" ở trang Run (`ui/src/pages/RunPage.tsx`, `runTabs.ts`), chỉ hiện với run coding có worktree và môi trường có khai báo.
- **Sai khác khi dựng (2026-11-09):** tab hiện với mọi run coding thuộc một môi trường (`previewTabVisible(coding, project)`), không đợi môi trường đã khai báo, để điền cấu hình lần đầu ngay trên tab; nút chụp vẫn cần cấu hình hợp lệ và ô quyền bật.
- Nội dung: nút "Chụp ảnh" (vô hiệu khi đang chạy hoặc ô tick tắt, kèm lời nhắc bật ở Cài đặt > Cấp quyền); dòng trạng thái từng bước (đang khởi động, đang đợi máy chủ, đang chụp trang X, đang đóng); lưới ảnh theo trang với nhãn "375 px / 1280 px"; bấm ảnh để xem lớn; nút "Mở tệp". Lỗi hiện tiếng Việt kèm đoạn log cuối.
- Thăm dò REST 2 giây khi đang chạy (trình duyệt nhúng không mở WebSocket tới localhost, xem CLAUDE.md).
- Mọi khối ≤ 375 px không tràn ngang; lưới một cột ở điện thoại, nhiều cột ở màn rộng. Khóa i18n vi/en.
- Ghi chú trên UI: ảnh có thể chứa nội dung riêng tư của ứng dụng đã chụp.

## 7. Kiểm thử

Không gọi Claude thật.
- Đơn vị: `validatePreview`; dựng đối số Edge; thăm dò sẵn sàng (hết hạn, thoát sớm); dọn tiến trình (kể cả khi lỗi giữa chừng); tên tệp/slug; chặn path traversal; phát hiện ảnh rỗng; quyền (`grants`, đường hầm); migration cột.
- API: `tests/preview-api.test.ts` dùng máy chủ HTTP giả và Edge giả (đặt `TNF_FAKE_BROWSER`/đường dẫn thay thế, theo mẫu `TNF_FAKE_CLAUDE`): 202/409/400/403, `GET` trạng thái, tải ảnh.
- UI: test logic thuần (`ui/src/preview.ts`) và test render theo mẫu hiện có.
- Chạy thật ghi vào `docs/PROGRESS.md`: một trang web mẫu (ảnh 375 và 1280) và Notepad/Calculator qua helper; ảnh nghiệm thu vào `docs/screens/8.0-*.jpg`; tab hiển thị đúng ở 375 px và ≥ 1280 px.

## 8. Rủi ro đã biết

- Defender có thể cảnh báo tệp thực thi mới biên dịch; spike kiểm trước.
- `PrintWindow` có thể cho ảnh đen với ứng dụng vẽ bằng GPU/DirectComposition; đã có phát hiện ảnh rỗng và lối lui hỏi lại người dùng.
- Dev server tự chọn cổng khác `url` đã khai báo thì thăm dò hết hạn; người dùng phải khai báo đúng URL/cổng (hướng dẫn trong form).
- Edge headless cần Edge hoặc Chrome đã cài; thiếu thì báo lỗi tiếng Việt (dùng `locateBrowser`).
- Ảnh chụp có thể lộ dữ liệu riêng tư; ảnh nằm trong thư mục lưu tệp cục bộ, không đi qua artifact của run.
