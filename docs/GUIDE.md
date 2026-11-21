# Hướng dẫn chi tiết

> Trang tổng quan nằm ở [README](../README.md). Tài liệu này giữ toàn bộ hướng dẫn cài đặt, cấu hình và từng tính năng.

App web chạy cục bộ trên Windows: ra lệnh một câu tiếng Việt → một phiên `claude -p` điều phối ba vai (searcher → analyzer → synthesizer) → xem dòng thời gian từng vai, báo cáo, lịch sử và token/chi phí ước tính. Chỉ dùng hạn mức thuê bao claude.ai (có billing guard), không phát sinh phí API.

Trạng thái: **Phase 0–3 hoàn tất, đã chạy thật trên máy này** (xem `docs/PROGRESS.md`, `docs/SPIKE-RESULTS.md`). Văn phòng 2D là bản tích hợp sẵn (isometric, vẽ bằng mã của dự án), không phụ thuộc claude-office.

## Yêu cầu

- Windows, Node.js ≥ 22.5 (đã kiểm: v24), npm.
- Claude Code CLI ≥ 2.1.281 đã đăng nhập bằng tài khoản claude.ai (`claude auth status` → `authMethod: "claude.ai"`).
- **Không** đặt `ANTHROPIC_API_KEY` trong môi trường.
- Đường dẫn ASCII: repo `D:\tnf-claude-controller`, thư mục làm việc của agent `D:\tnf-claude-workspace` (tự tạo).

## Cài đặt bằng Setup.exe (máy người dùng, không cần Node/npm)

Bộ cài `TNF-Claude-Controller-Setup-<phiên bản>.exe` (~24 MB) cài **cho từng người dùng, không cần quyền admin** vào `%LOCALAPPDATA%\TNF\Controller`. Bộ cài không giả định ổ đĩa nào: dữ liệu luôn nằm dưới `%LOCALAPPDATA%\TNF\Controller` (ghi đè được trong `app\config\controller.json`, có thể dùng `%TÊN_BIẾN%`).

**Ba điều kiện trên máy đích** (bộ cài không gộp, trang Lệnh sẽ hướng dẫn nếu thiếu):
1. **Claude Code CLI đã cài và đã đăng nhập** bằng tài khoản claude.ai (`claude auth status` → `loggedIn: true`).
2. **`git` có trong PATH** (Git for Windows) — run lập trình tạo worktree và commit bằng git.
3. **Repo đích đã có trên máy đó**: project (Môi trường) là đường dẫn cục bộ, nên sang máy mới phải clone repo rồi tạo lại project trỏ vào đường dẫn đó (`Tạo project mới` trên trang Lệnh hoặc `tnf projects add`).

Bố cục thư mục:

| Thư mục | Nội dung |
|---|---|
| `app\` | `node.exe` kèm theo, `dist\` (server + CLI), `ui\dist\`, `config\`, `fixtures\` (chế độ demo), `tray.ps1`, `stop.ps1` — bị thay khi cài đè/gỡ |
| `data\` | SQLite, `controller.token`, stream thô từng run |
| `workspace\` | run nghiên cứu và git worktree của run lập trình |
| `logs\` | `controller.log` (khay), `server.out.log`, `controller.err.log` |

- **Chạy**: lối tắt Start Menu "TNF Claude Controller" (hoặc "(chế độ demo, không tốn hạn mức)"). Biểu tượng ở khay hệ thống có menu **Mở giao diện** (mở trình duyệt đúng URL kèm token), **Xem log**, **Dừng server / Chạy lại server**, **Thoát**; nhấp đúp = mở giao diện. Token đổi mỗi lần server khởi động, nên luôn mở từ khay (tab cũ sẽ báo "Thiếu hoặc sai token").
- **Khởi động cùng Windows**: tùy chọn khi cài (ghi `HKCU\…\Run\TNFClaudeController`, gỡ cài sẽ xóa).
- **Claude Code không gộp trong bộ cài**: cần cài và đăng nhập riêng (`irm https://claude.ai/install.ps1 | iex`, rồi chạy `claude` đăng nhập bằng tài khoản claude.ai). Khi thiếu hoặc chưa đăng nhập, trang Lệnh hiện bảng hướng dẫn tiếng Việt và nút "Kiểm tra lại". Run lập trình cần `git` trong PATH.
- **Cấu hình**: `app\config\controller.json` (được giữ nguyên khi cài đè); ví dụ `server.allowedOrigins` cho đường hầm điện thoại — sửa xong chọn Dừng rồi Chạy lại server ở khay.
- **Gỡ cài**: Settings → Apps, hoặc `%LOCALAPPDATA%\TNF\Controller\unins000.exe`. Bộ gỡ dừng server/khay, xóa `app\`, rồi **hỏi** có xóa `data\`, `workspace\`, `logs\` không (gỡ im lặng thì giữ lại).

Dựng bộ cài trên máy phát triển (cần Inno Setup 6, mặc định tìm ở `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` hoặc `%ProgramFiles(x86)%\Inno Setup 6`, hoặc đặt `TNF_ISCC`):

```powershell
npm run package      # tsc + vite build -> build\app\ (node.exe + dist + ui + config + fixtures + ws, ~91 MB)
npm run installer    # ISCC installer\setup.iss -> build\TNF-Claude-Controller-Setup-<ver>.exe
```

## Render chất lượng cao bằng Blender (xưởng dựng 3D, tùy chọn)

- Blender không đi kèm app (giấy phép GPL, cài riêng): tải bản portable `.zip` cho Windows ở blender.org, giải nén vào `D:\tnf-cad-tools\blender\` (ví dụ `D:\tnf-cad-tools\blender\blender-5.2.4-windows-x64\blender.exe`), hoặc đặt đường dẫn vào `workshop3d.blender.path` / `tools.blender` trong `controller.json` hay biến `TNF_BLENDER`.
- Vật liệu ảnh thật (CC0, Poly Haven, ≈ 17 MB): `npm run tnf -- w3d fetch-assets` để xem danh sách và dung lượng, `npm run tnf -- w3d fetch-assets --yes` để tải vào `data/library/polyhaven/`. App không tự tải.
- Có Blender thì phiên mới duyệt hai pha: vòng sửa với ảnh nhanh (chỉ chấm hình học), rồi Blender render 6 góc đẹp (vài phút một ảnh 1280 × 960, tùy card đồ họa) và duyệt lần cuối. Không có Blender thì như cũ. Chi tiết: `docs/DESIGN-3D.md` mục 4b.

## Khởi động

```powershell
cd D:\tnf-claude-controller
npm install
.\scripts\start.ps1          # chạy thật
.\scripts\start.ps1 -Demo    # CLI giả, phát lại fixture, không tốn token
```

Nếu dùng **Git Bash** (MINGW64) thay vì PowerShell:

```bash
cd /d/tnf-claude-controller && npm run serve -- --open          # chạy thật
TNF_FAKE_CLAUDE=1 npm run serve -- --open                       # demo, không tốn token
powershell -ExecutionPolicy Bypass -File scripts/start.ps1      # hoặc gọi script PowerShell
```

Giao diện là **một màn hình, không có tab**: bảng trái (ô lệnh, môi trường/tầng và chip vai, Thông báo, các nút ▶ Lệnh, 🕘 Lịch sử, nút chuyển "Xem văn phòng"/"Xem toàn cảnh", ⚙ Cài đặt) và khu chính là cảnh thành phố (mỗi tầng là một project). Các trang cũ mở trong cửa sổ popup.

Server in ra một địa chỉ dạng `http://127.0.0.1:4800/#token=...` — mở đúng địa chỉ đó (token là mã truy cập, chỉ in một lần, lưu ở `data/controller.token`). Dừng bằng Ctrl+C hoặc `.\scripts\stop.ps1`.

**Cửa sổ riêng thay vì tab:** app có `manifest.webmanifest` (`display: standalone`, `start_url` là `/` và **không chứa token**), nên cửa sổ không thanh địa chỉ phải được mở bằng đường đưa token vào URL: bản đóng gói thì mục **Mở giao diện** của khay (`tray.ps1`) mở thẳng Edge/Chrome bằng `--app=<url>`; khi phát triển thì dùng `npm run tnf -- open` (hoặc `.\scripts\start.ps1`, tự gọi `tnf open` khi cổng sẵn sàng). Mở thẳng `/` sẽ không có token. Token nằm trong đối số `--app` là chấp nhận được (máy cá nhân, bind 127.0.0.1). Không tìm thấy Edge/Chrome thì `tnf open` báo rõ và mở bằng trình duyệt mặc định.

## Dòng lệnh

```powershell
npm run tnf -- status                       # kiểm tra đăng nhập / billing guard
npm run tnf -- run "Phân tích website ..."  # chạy + in dòng thời gian, cây agent, chi phí
npm run tnf -- run "..." --single           # một agent, không chia vai (A/B)
npm run tnf -- run "..." --project "Tên môi trường"   # gộp lần chạy theo môi trường/project (tab ở trang Lần chạy)
npm run tnf -- run "..." --model opus --role-model searcher=haiku --role-model synthesizer=claude-fable-5-2
                                            # chọn model phiên chính và từng vai (danh sách ở config/controller.json → models)
npm run tnf -- resume <run-id> "hỏi tiếp"   # --resume cùng session, cùng thư mục run
npm run tnf -- list [--q từ-khóa] [--status done]
npm run tnf -- show <run-id>
npm run tnf -- cancel <run-id>              # qua API của server đang chạy
npm run smoke -- --yes                      # chạy THẬT một lượt "chào" (haiku, 3 lượt, $0.2)
npm run smoke -- --yes --roles              # tác vụ chuẩn với 3 vai
npm run smoke -- --yes --single             # tác vụ chuẩn, agent đơn (đối chứng A/B)
npm run smoke -- --yes --coding --project spike   # run lập trình thật trên repo của project (bằng chứng git/test in ra cuối)
npm test                                    # hơn 4.000 test, không gọi Claude thật
```

## Cấu trúc

| Đường dẫn | Việc |
|---|---|
| `config/controller.json` | cổng, trần mặc định, đường dẫn workspace, `claudePath` |
| `config/roles-coding.json`, `config/coordinator-coding.md` | bộ vai lập trình (analyst, planner, critic, implementer, qa, debug) + prompt điều phối; nguồn gốc MIT ở `config/roles-src/` |
| `config/roles-research.json`, `config/coordinator-research.md` | bộ vai nghiên cứu web (searcher, analyzer, synthesizer) |
| `src/core/run/billing-guard.ts` | `claude auth status`, lọc `ANTHROPIC_*`, cấm `--bare` |
| `src/core/run/claude-runner.ts` | dựng dòng lệnh §5.2, spawn không shell, prompt qua stdin, timeout, hủy cây tiến trình |
| `src/core/run/stream-parser.ts` | NDJSON → sự kiện chuẩn hóa §5.3, cây agent từ `parent_tool_use_id`, chịu lỗi |
| `src/core/run/run-store.ts` | SQLite (`node:sqlite`): runs / events / artifacts |
| `src/core/run/run-manager.ts` | điều phối run, follow-up (`--resume`), hủy |
| `src/server/` | REST + WS, token + kiểm `Origin`/`Host`, bind 127.0.0.1 |
| `ui/` | React + Vite, tiếng Việt mặc định (vi/en), sáng/tối |
| `ui/src/office/` + `ui/src/components/office/OfficeScene.tsx` | văn phòng 2D SVG: reducer thuần từ sự kiện run (`model.ts`), bố cục bàn/phòng (`layout.ts`) |
| `data/` | `controller.db`, `controller.token`, `runs/<id>/stream.jsonl` (thô) |
| `D:\tnf-claude-workspace\runs\<id>\` | cwd của agent: `notes/*.md`, `report.md` |

## Sự cố thường gặp

- **"Chưa đăng nhập"**: mở PowerShell, chạy `claude`, đăng nhập claude.ai.
- **"Đang đăng nhập bằng api_key (tính phí API)"**: gỡ `ANTHROPIC_API_KEY` (`Remove-Item Env:ANTHROPIC_API_KEY`) hoặc `claude auth logout` rồi đăng nhập lại.
- **Hết hạn mức**: stream báo lỗi API / `api.retry`; chờ cửa sổ hạn mức mới, kiểm tra `/usage` trong Claude Code.
- **Cổng bận**: `.\scripts\start.ps1 -Port 4801` hoặc `.\scripts\stop.ps1`.
- **Mất token**: xem `data\controller.token` hoặc khởi động lại server.
- **Không tìm thấy claude.exe**: đặt `claudePath` trong `config/controller.json` (ví dụ `C:\Users\<bạn>\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`).

## Dùng từ điện thoại

Server **chỉ bind `127.0.0.1`** và không bao giờ mở cổng ra ngoài. Để ra lệnh, xem diff/test và tải artifact từ điện thoại, dùng một **đường hầm có xác thực** tới `127.0.0.1:4800`; trình duyệt vẫn phải mang token (`#token=` lúc mở lần đầu, sau đó gửi qua header), và Origin của đường hầm phải được khai trong `config/controller.json` → `server.allowedOrigins` (mặc định `[]`: chỉ `localhost`/`127.0.0.1`). Origin lạ bị 403; thiếu token bị 401; CSP `connect-src` của giao diện tự thêm origin này (cả `wss://`).

**Phương án 1 — Tailscale Serve (khuyên dùng; chỉ thiết bị trong tailnet của bạn, HTTPS do Tailscale cấp).** Cài đặt toàn cục nên controller không tự làm; bạn chạy tay:

```powershell
winget install --id Tailscale.Tailscale -e   # cài Tailscale, đăng nhập cùng tài khoản trên máy và điện thoại
tailscale serve --bg 4800                    # publish 127.0.0.1:4800 thành https://<máy>.<tailnet>.ts.net
tailscale serve status                       # xem URL vừa cấp
```

Rồi thêm URL đó vào `config/controller.json`:

```json
"server": { "host": "127.0.0.1", "port": 4800, "allowedOrigins": ["https://<máy>.<tailnet>.ts.net"] }
```

Khởi động lại server, mở trên điện thoại `https://<máy>.<tailnet>.ts.net/#token=<token in ở console>` (token nằm trong fragment `#`, không gửi lên mạng; xem `data\controller.token` nếu cần). Tắt đường hầm: `tailscale serve --bg 4800 off` (hoặc `tailscale serve reset`).

**Phương án 2 — Cloudflare Tunnel (tên miền tạm, ai có link + token đều vào được; chỉ dùng tạm, nên kèm Cloudflare Access nếu dùng lâu):**

```powershell
winget install --id Cloudflare.cloudflared -e
cloudflared tunnel --url http://127.0.0.1:4800   # in ra https://<ngẫu-nhiên>.trycloudflare.com
```

Thêm URL đó vào `server.allowedOrigins` như trên (mỗi lần chạy lại `cloudflared` sẽ đổi tên miền → phải sửa lại cấu hình).

Trên điện thoại (≤ 480 px) giao diện xếp một cột: trang Lệnh có ô **Đính kèm tệp** (≤ 5 MB/tệp, tên ASCII; tệp vào `D:\tnf-claude-workspace\runs\<id>\inbox\` và coordinator được báo đường dẫn trong lệnh), trang Lần chạy có nút ⤓ từng tệp và **Tải tất cả (.zip)** ở tab "Tệp sinh ra", ô "Hỏi tiếp" cũng đính kèm được; văn phòng isometric co theo khung hẹp. API: `POST /api/inbox` (header `X-File-Name`, thân là nội dung tệp) → `stage_id` → `POST /api/runs {inbox_stage}`; `POST /api/runs/:id/inbox`; `GET /api/runs/:id/artifacts.zip`.

## Văn phòng 2D

Không còn tab hay trang riêng. Khi chọn một tầng trong cảnh thành phố, **văn phòng isometric** (`IsoOffice`, mã `ui/src/office/iso/`) hiện trong khu chính, dựng từ sự kiện của run (có thăm dò REST 3 giây): mỗi vai có phòng riêng (Phòng điều phối · Phân tích & kế hoạch · Phòng phản biện · Phòng thực thi · Phòng kiểm thử · Sảnh chờ cho vai lạ), với 6 vai lập trình analyst, planner, critic, implementer, qa, debug (nhãn: Phân tích viên, Kế hoạch, Phản biện, Thực thi, Kiểm thử, Gỡ lỗi). Agent là avatar đi tới bàn khi bắt đầu, bong bóng hiện tool đang dùng, chấm trạng thái (xanh dương = tool, vàng nhấp nháy = đang viết/suy nghĩ, xanh lục = xong, đỏ = lỗi).

- Có thanh tab tầng; văn phòng theo **run đang chạy mới nhất** của tầng đó, không run nào chạy thì có nút "Lần chạy · <id>" cho run xong gần nhất. Không còn route `#/office` hay `?project=`.
- Văn phòng 2D SVG cũ (`OfficePage.tsx`) đã xóa ở 0.14.0.
- Không cần hook, backend hay cổng 8000. Toàn bộ logic trạng thái ở `ui/src/office/model.ts` (có test `tests/office-model.test.ts` chạy trên stream thật).

## Loại run, agent/skill thêm và khối ngữ cảnh

- **Loại run tự suy ra**: không còn ô chọn loại. Project có repo luôn chạy "Lập trình"; không chọn project (hoặc project không repo) thì chạy "Nghiên cứu" cho việc ngoài môi trường.
- **Agent/skill thêm** (mục "Nâng cao" của trang Lệnh, hoặc `tnf run "..." --skill <tên> --agent-file agents.json`, hoặc API `agents`/`skills`): chỉ áp dụng cho run đó. Agent thêm chỉ được công cụ an toàn (`Read Grep Glob Edit Write WebSearch WebFetch`, không Bash), tối đa 5; skill cấp quyền dạng `Skill(<tên>)`, tối đa 10. Chế độ single không hỗ trợ agent thêm. Chưa kiểm chứng bằng chạy thật việc `Skill(x)` nạp được khi dùng `--setting-sources project`.
- **`node_modules` trong worktree (run coding)**: agent không được `npm install`, nên controller copy `node_modules` của repo đích vào worktree (cấu hình `defaults.coding.nodeModules`: `mode` `copy` | `junction` | `none`, `maxMb` mặc định 600). Quá trần hoặc copy lỗi thì dùng junction, nhưng agent trong sandbox không đọc được qua junction, nên hãy nâng `maxMb` nếu repo của bạn lớn hơn. Copy repo vài trăm MB mất từ vài chục giây. Kết quả ghi ở `node-modules.txt` của run.
- **Khối ngữ cảnh mặc định (run coding)**: cấu hình `defaults.coding.contextScan` (`enabled`, `maxBytes`, `files`). Trước khi chạy, controller nạp `data/projects/<tên>/memory.md` (tự tạo thủ công; controller không tự tạo) và bản cắt giới hạn của `CLAUDE.md`, `docs/HANDOVER.md`, `README.md` của worktree vào prompt coordinator và analyst, gắn nhãn dữ liệu tham khảo, để agent không phải đọc hết mã nguồn. Tắt bằng `"enabled": false`. Danh sách file đã nạp nằm ở tệp `context-scan.txt` của run.

## Thư viện vai, skill và prompt, và tìm vai mới

Mở **⚙ Cài đặt** rồi bấm nút **Thư viện** (modal "Thư viện vai, skill và prompt"), và có mục "Thư viện: vai, skill và prompt" ở trang Lệnh. Dữ liệu lưu ở `data/library/library.json`, dùng chung cho mọi run.

- **Vai thư viện** (tối đa 30): mã, mô tả, prompt (≤ 4000 ký tự), công cụ an toàn (không Bash), model tùy chọn. Tick ở trang Lệnh thì vai chạy như agent thêm của run đó (tính vào trần 5 agent thêm).
- **Mục skill/prompt** (tối đa 100, ≤ 64 KB mỗi mục): văn bản nối vào prompt của các vai bạn gắn; không tick vai nào thì chỉ coordinator thấy. Mục không cấp thêm quyền. Mục gắn vào vai thư viện sẽ kéo vai đó vào run; vai có sẵn của loại run khác bị bỏ qua (trang Lệnh ghi rõ). Tổng văn bản nối vào một run ≤ 64 KB. Mục đã dùng ghi ở `library-items.txt` của run.
- **Tìm vai mới**: danh mục 23 vai mẫu (`config/roles-catalog.json`: soát mã, viết test, QA, bảo mật, tài liệu, dịch, SEO, phản biện…) tìm theo tên, mô tả hoặc thẻ, có dấu hay không đều được. "Thêm vào thư viện" sao chép vai; "Thêm và dùng cho run này" thêm rồi tick luôn. API: `GET /api/role-catalog?q=`, `POST /api/library/roles/from-catalog/<id>`, CRUD `/api/library/roles`, `/api/library/items`; chạy run với `libraryItemIds`.

## Hàng đợi lệnh

Mỗi project có repo có một **hàng đợi lệnh**. Trên dòng môi trường ở bảng trái (chỉ hiện khi project có repo) có nút "Hàng đợi task" (mở popup tầng), nút "Danh sách Task" (mở danh sách task, có "Chạy tất cả" và "Dừng") và nút "Agent đề xuất" (tức Scout; chỉ bấm được khi có repo và không có run đang chạy). Các bước:

1. **Nhập ý tưởng** (tiếng Việt, tùy chọn bật tìm web): bấm "Gửi cho Người chia ý tưởng" rồi "Xác nhận gửi"; `POST /api/projects/<tên>/queue/split` chạy vai idea-splitter (thuộc bộ vai hàng đợi `config/roles-queue.json`, không thuộc 6 vai coding), tách thành các lệnh nhỏ có mã, file dự kiến và phụ thuộc. Lệnh mới ở trạng thái "chờ duyệt".
2. **Duyệt rồi chạy một lệnh** (nút "Duyệt và chạy"; cũng có "Duyệt tất cả"): `POST .../queue/<mã>/approve-run`. Lệnh có phụ thuộc chưa gộp bị từ chối. Run xong thì lệnh thành "đã commit" (nhánh `tnf/<run-id>`).
3. **Chạy song song** các lệnh độc lập (không phụ thuộc nhau, file không giao nhau): `POST .../queue/run-parallel` với danh sách mã; mỗi lệnh một worktree và một nhánh riêng, số run đồng thời bị chặn bởi trần cấu hình.
4. **Scout** ("Agent đề xuất", hỏi xác nhận rồi mở màn duyệt đề xuất): một run quét dự án và đề xuất việc tiếp theo trong báo cáo (khối JSON `{"proposals":[...]}`). Duyệt một đề xuất rồi chuyển vào hàng đợi (`queue/split` với `source=scout`, `sourceRef=<runId>#<mã>`), lệnh mới lại chờ duyệt. Có thể bật đề xuất lại sau khi gộp (replan).

Chi tiết: `docs/PLANNER-QUEUE.md`, SPEC mục hàng đợi. Chi phí hiển thị là ước tính.

**Chưa kiểm bằng Claude thật** (nghiệm thu mới chạy offline với CLI giả, xem `docs/PROGRESS.md` mục 8.0, ảnh `docs/screens/8.0-*.jpg`): chất lượng idea-splitter; WebSearch/WebFetch; references; replan sau gộp; chạy song song thật và `maxParallel`; scout thật; việc coordinator có ghi `report.md`; nút Duyệt/Gửi trong UI (demo đi qua API).

## Thống kê token từ nhật ký Claude Code

`src/core/usage/usage-blocks.ts` (usage-blocks) chỉ đọc nhật ký jsonl của Claude Code để thống kê token theo ngày, theo phiên và theo khung 5 giờ; đây là ngoại lệ có chủ đích của quy tắc 8 trong CLAUDE.md (không dùng làm nguồn chính của run, không ghi/sửa gì trong thư mục cấu hình). Chi phí chỉ là ước tính; module tự viết, không phụ thuộc ccusage (chỉ tham khảo ý tưởng, MIT).

## Môi trường / Project

Mỗi lần chạy thuộc một **môi trường/project** (cột `project` trong SQLite, mặc định `default` hiển thị là "Mặc định"). Ô "Môi trường / Project" ở trang Lệnh (gõ tên mới để tạo, có gợi ý tên đã có; tên được nhớ trong phiên trình duyệt); hỏi tiếp kế thừa project của run gốc; CLI `--project`. Trang **Lần chạy** có tab theo project (chấm nhấp nháy = đang có run chạy, số = số lần chạy; tab đang chọn được nhớ). API: `GET /api/projects`, `GET /api/runs?project=`, `POST /api/runs {project}`. Hiện project chỉ là nhãn gộp: thư mục làm việc vẫn riêng từng run (`D:\tnf-claude-workspace\runs\<id>`).


## Giấy phép

Apache-2.0, xem `LICENSE` và `NOTICE`. Bản quyền 2026 tnfrenzy. Thư viện bên thứ ba giữ giấy phép riêng của chúng.
