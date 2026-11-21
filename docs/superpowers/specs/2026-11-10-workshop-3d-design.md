# Xưởng dựng 3D, bàn xem 3D/AR và Phòng dựng 3D

Ngày: 2026-11-10. Trạng thái: chờ người dùng duyệt. Thay thế cách chạy "Tạo mẫu" hiện tại (một run lập trình thường, xem `docs/DESIGN-3D.md` mục 4).

## 1. Mục tiêu

Một lệnh bằng tiếng Việt dựng được mô hình 3D **bất kỳ** (thang máy chỉ là bộ mẫu), có đầy đủ chi tiết, đẹp, sang trọng, đặt được trong không gian AR (GLB cho Android/WebXR, USDZ cho iOS). Phiên chạy dài không dừng. Có phòng 2.5D "Phòng dựng 3D" cùng nhân vật cho từng vai. Xem trước trực tiếp trong app.

Lý do làm lại: bản cabin của run `20261110-130922-b67ad1` chỉ ra script CadQuery, file GLB có 2 màu phẳng và các khối hộp; agent không có Bash nên không chạy được script, và không nhìn thấy kết quả để tự sửa.

## 2. Phạm vi và thứ tự

Bốn phần, mỗi phần có kế hoạch riêng:
1. **Xưởng dựng** (lõi, mục 3–6): phiên, vai, vòng dựng, chạy không dừng, công cụ.
2. **Bàn xem 3D/AR** (mục 7).
3. **Phòng dựng 3D** (mục 8).
4. **Nhân vật và hành động** (mục 9).

Phần 1 làm trước vì ba phần còn lại đọc trạng thái của nó.

## 3. Phiên dựng

- Mã mới ở `src/core/workshop3d/`, cùng kiểu `skill-workshop`: máy trạng thái thuần trong TypeScript, mỗi bước là một run riêng của đúng một vai (`runStep`), vai chỉ trả JSON hoặc file văn bản, controller quyết định bước kế.
- Không worktree, không vai lập trình. cwd của agent là thư mục run. Quyền: `dontAsk` + `--allowedTools` tường minh theo vai (không Bash).
- Dữ liệu ở `data/workshop3d/<slug>/`: `brief.json`, `spec.json`, `params.json`, `model.py`, `materials.json`, `rounds/<n>/`, `outputs/`, `renders/`, `state.json`.
- Trạng thái: `intake` → `awaiting_user` → `art` → `planning` → `modeling` → `building` → `materials` → `rendering` → `reviewing` → `optimizing` → `presenting` → `done`. Thêm `paused`, `stopped`, `failed`, `waiting_quota`. Vòng sửa là quay lại `modeling` hoặc `materials` với danh sách lỗi.

## 4. Chín vai (config/roles-design3d.json, không dùng thư viện vai lập trình)

| Vai | Công cụ | Việc |
|---|---|---|
| `tiep-nhan-3d` | Read | Nhận tờ yêu cầu; hỏi bổ sung tối đa 5 câu mỗi vòng; trả `{done, questions, brief}` |
| `art-director` | Read | Phong cách sang trọng, bảng màu, vật liệu, tham chiếu bằng lời |
| `detail-planner` | Read | Bảng chi tiết đầy đủ theo loại vật thể (checklist), kèm kích thước và dung sai |
| `cad-modeler` | Read | Viết `model.py` CadQuery, đơn vị mm, khối `PARAMS` ở đầu, có bo/vát cạnh, khe giữa tấm, tên bộ phận |
| `material-artist` | Read | `materials.json` PBR + công thức texture sinh bằng mã (inox sọc nhuyễn, inox gương, vàng gương Ti, kính, đá, gỗ, sơn tĩnh điện) gán cho từng bộ phận |
| `render-director` | Read | Cấu hình ánh sáng, camera, 4 góc ảnh; không bịa số liệu |
| `visual-reviewer` | Read (đọc được PNG) | Xem ảnh render, chấm đẹp / đủ chi tiết / đúng tỉ lệ, trả danh sách lỗi có thứ tự |
| `ar-optimizer` | Read | Số mặt, kích thước texture, đơn vị mét, gốc tọa độ ở tâm sàn, bản nhẹ cho điện thoại; đề xuất chứ không tự ghi đè file xuất |
| `render-presenter` | Read | Bản mô tả cuối, không bịa số liệu |

Vai trả nội dung (khối ```json hoặc ```python), controller ghi file.

Bốn vai cũ (`cad-modeler`, `elevator-3d-designer` → `detail-planner`, `model-3d-reviewer` → `visual-reviewer`, `render-presenter`) được viết lại prompt cho vật thể bất kỳ; mã cũ trong `config/roles-catalog.json` giữ nguyên để không phá thư viện.

## 5. Bước dựng do controller chạy (không qua agent)

1. **Kiểm script** bằng AST: từ chối `import` ngoài danh sách cho phép (cadquery, math, numpy, json, sys, os.path…), chặn `os.system`, `subprocess`, `socket`, `shutil`, `requests`, `open` ghi ngoài thư mục run, `eval/exec`. Đây là **rào chắn cho agent hợp tác, không phải hộp cát bảo mật**; script luôn hiện trong app.
2. **Chạy** bằng Python của `cad-venv` (`src/core/cad-tools.ts` đã tìm sẵn), spawn không qua shell, `OUTPUT_DIR` trỏ thư mục run, hết 180 s thì dừng; stdout/stderr rút gọn quay về vai sửa.
3. **Đo** bằng `step_info.py`: hộp bao, số khối, thể tích; so với `spec.json` (lệch > dung sai thì báo lỗi cho vòng sửa).
4. **Lắp GLB** bằng script `tools/workshop3d/assemble_glb.py` (trimesh + pygltflib + Pillow): đọc `materials.json`, sinh texture, ghi GLB PBR (đơn vị mét, +Y lên, gốc ở tâm sàn).
5. **Xuất USDZ** bằng `usd-core`; **kiểm hợp lệ** glTF bằng `gltf-validator`.
6. **Render** ảnh 4 góc bằng three.js trong Edge/Chrome headless (cơ chế của `preview-web.ts`); ảnh lưu `renders/`.

Bước 4–6 và việc chỉnh tham số chạy lại được mà không gọi agent (không tốn token).

## 6. Chạy không dừng

- Mỗi lượt gọi agent ngắn và có điểm lưu (`state.json` sau từng bước), nên giới hạn ~10 phút của CLI chỉ làm hỏng một bước, không làm hỏng phiên.
- Phiên 3D **không có trần thời gian hay số lượt cứng**; chỉ có cảnh báo chi phí ước tính và nút Tạm dừng/Dừng của người dùng.
- Tự tiếp tục khi một lượt bị ngắt (`subagent_interrupted`, timeout) hoặc khi app khởi động lại: đọc `state.json` và làm lại bước đang dở.
- Chạm hạn mức 5 giờ hoặc tuần (đã có thông tin trong `stream-parser` và `quota-baseline`): vào `waiting_quota`, chờ đến lúc đặt lại rồi chạy tiếp, không báo lỗi.
- Một bước lỗi liên tiếp quá 3 lần thì dừng ở `failed` kèm lý do, không lặp vô hạn. Vòng sửa thẩm mỹ mặc định tối đa 6 lượt, người dùng chỉnh được.

## 7. Bàn xem 3D/AR

- Mở rộng `Model3DViewer.tsx`: GLB xem bằng `@google/model-viewer` (Apache-2.0) với nút "Xem trong AR" (iOS dùng USDZ, Android dùng GLB); STL xem bằng three.js hiện có; STEP đã đổi sang GLB ở bước dựng nên xem được ngay.
- Công cụ: xoay, ánh sáng (studio/ngoài trời), lưới mm, đo hai điểm, bảng thông tin (số mặt, dung lượng, kích thước mét, danh sách vật liệu), bật/tắt từng bộ phận.
- Ảnh render 4 góc hiện trong phòng và tab Run.
- Bảng tham số: sửa `params.json` rồi "Dựng lại" (chỉ chạy mục 5), ảnh mới thay ảnh cũ.
- Gói npm thêm vào dự án: `@google/model-viewer`, `gltf-validator` (phiên bản cố định, kiểm giấy phép trước khi khóa). Gói Python đã cài vào `cad-venv`: trimesh 5.2.0, pygltflib 1.16.5, Pillow 13.0.0, usd-core 26.11.

## 8. Phòng dựng 3D (2.5D)

Dùng mã isometric và `IsoPerson` như `GymRoom`; hình học thuần ở `ui/src/office/workshop3d-layout.ts` (ô 0,5 m, BFS tìm đường như `gym-layout.ts`), cảnh ở `workshop3d-scene.ts`, thành phần `Workshop3DRoom.tsx`. Phòng 16 × 13,5 m:

Bàn tiếp nhận (quầy, ghế khách) · tường mood-board (ảnh tham chiếu, bảng màu) · bàn vẽ kỹ thuật (hai màn hình, giá bản vẽ) · kệ mẫu vật liệu (inox, gỗ, đá, kính) · máy in 3D · bục trưng bày có mô hình quay · góc studio chụp (softbox, nền trắng, máy ảnh) · bàn duyệt · khu nghỉ (sofa, cà phê, cây) · màn hình lớn chiếu tiến độ.

Bấm một tầng của tòa dựng 3D trong thành phố mở phòng này; danh sách tệp cũ (`Design3DFloorPanel`) thành tab trong phòng.

## 9. Nhân vật và hành động

- Chín `Look` riêng (như `GYM_TRAINER_LOOKS`): tiếp nhận đeo tai nghe, art-director mũ nồi, kỹ sư CAD đeo kính, material-artist tạp dề, render-director cầm máy ảnh, visual-reviewer cầm kính lúp, ar-optimizer đeo kính AR, presenter cầm máy tính bảng, detail-planner kẹp bảng ghi chép. Có thể cần thêm `headgear`/phụ kiện mới ở `IsoPerson.tsx`.
- Một nhân vật phụ là "vật đang dựng": bục trưng bày thay đổi theo bước (khung dây → có khối → có vật liệu → hoàn chỉnh).
- Hành động theo trạng thái (hàm thuần `workshop3d.ts`, tương tự `gym.ts`): đi giữa các khu, ngồi vẽ, so mẫu vật liệu, đặt vật lên bục, bấm máy chụp, soi kính lúp, đánh dấu lỗi lên tường, vỗ tay khi duyệt, uống cà phê lúc rảnh.

## 10. Lệnh vào (A + B)

Tờ yêu cầu tự do: tên vật thể, bảng tham số tự đặt (kích thước, vật liệu, mục đích), đính kèm DXF/STEP (đã có công cụ tóm tắt ở `cad-tools.ts`), mức chi tiết. Gõ thiếu thì `tiep-nhan-3d` hỏi tối đa 5 câu. Thang máy là bộ mẫu điền sẵn (`config/design3d-kit.json` giữ làm nguồn mẫu). API mới: `POST /api/workshop3d`, `GET /api/workshop3d`, `GET /api/workshop3d/:slug`, `POST …/answer`, `…/rebuild`, `…/pause`, `…/resume`, `…/stop`. Mọi API cần token và kiểm Origin như hiện có.

## 11. Kiểm thử và nghiệm thu

- Test không gọi Claude: máy trạng thái, kiểm AST, parser kết quả vai, hàm thuần của phòng và hành động, i18n vi/en; stream giả theo `fixtures/` cho từng vai (`TNF_FAKE_CLAUDE=1`).
- Chạy thật có ghi bằng chứng vào `docs/PROGRESS.md`: cabin thang khách từ lệnh một câu → GLB + USDZ + ảnh render, `gltf-validator` không lỗi, mở được trong bàn xem, ảnh không còn hai màu phẳng.
- Giao diện kiểm ở 375 px và ≥ 1280 px, ảnh vào `docs/screens/`.

## 12. Rủi ro và điều chưa biết

- Chất liệu là sinh bằng mã, không phải quét ảnh thật; mức "sang trọng" cần vòng xem ảnh và người dùng chỉnh tham số.
- Chạy script Python do agent viết trên máy người dùng: chỉ giảm rủi ro (AST, venv, timeout), không loại bỏ.
- Chưa kiểm thật: Edge headless chụp GLB có PBR, `model-viewer` AR qua đường hầm Tailscale, USDZ mở được trên iPhone, `visual-reviewer` đọc PNG đủ tốt để chấm thẩm mỹ.
- `gltf-validator` và `model-viewer` cần xác minh giấy phép trên nguồn gốc trước khi khóa phiên bản.
- Đây là kế hoạch lớn; mỗi phần ở mục 2 cần nghiệm thu riêng trước khi làm phần kế.
