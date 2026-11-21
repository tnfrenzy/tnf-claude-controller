# Workshop 3D — Bàn xem 3D/AR (phần 2) Implementation Plan

> **For agentic workers:** dùng superpowers:executing-plans; bước dạng checkbox.

**Goal:** thành phần React độc lập `Workshop3DViewer` xem GLB (model-viewer, AR), STL (three.js sẵn có), đo, thông tin, bộ phận, ảnh render, bảng tham số + dựng lại; chạy offline bằng dữ liệu giả.

**Architecture:** logic thuần ở `ui/src/components/workshop3d/logic.ts` (+ `glb-info.ts` đọc JSON chunk GLB) có test vitest; API qua giao diện `W3DApi` (bản thật gọi `/api/workshop3d/:slug…` kèm header token, bản giả cho dev/test); `Workshop3DViewer.tsx` tải lười `@google/model-viewer` trong `ModelStage.tsx`.

**Tech Stack:** React 19, `@google/model-viewer` 4.4.0 (Apache-2.0, cài `--legacy-peer-deps` vì peer `three ^0.183` còn dự án `0.187`), three 0.187.

**Spec:** `docs/superpowers/specs/2026-11-10-workshop-3d-design.md` mục 7.

## Global Constraints
- Không sửa `src/`, `CityScene.tsx`, `popup.ts`, `App.tsx`; `i18n.ts`/`package.json` chỉ thêm. Khóa i18n tiền tố `w3v_` (vi + en).
- Không `sessionStorage`; bố cục đúng ở 375 px và ≥ 1280 px; không tự bật AR thật.

### Task 1: Logic thuần + test (`logic.ts`, `glb-info.ts`)
- [ ] test `tests/workshop3d-viewer-logic.test.ts` (đo mm, định dạng, chọn nguồn theo thiết bị, tham số, trạng thái, GLB mẫu)
- [ ] cài đặt tối thiểu → qua
- [ ] commit

### Task 2: i18n `w3v_` + test đối chiếu khóa
- [ ] `tests/workshop3d-viewer-i18n.test.ts` (mọi khóa dùng trong mã có ở vi/en), thêm khóa, commit

### Task 3: API + thành phần
- [ ] `api.ts` (`W3DApi`, bản thật), `ModelStage.tsx`, `InfoPanel`, `PartsPanel`, `RenderGallery`, `ParamsPanel`, `Workshop3DViewer.tsx`; `Model3DViewer` nhận `fetchBlob` tùy chọn
- [ ] test SSR các bảng trình bày; typecheck; commit

### Task 4: Trang dev mock + nghiệm thu
- [ ] `ui/w3d-dev.html` + `ui/src/dev/w3d-dev.tsx` (mock + GLB mẫu), xem thật 375/1280 px, ảnh `docs/screens/w3d-viewer-*.jpg`, build UI, PROGRESS, commit

Điều chưa kiểm được: AR thật (Scene Viewer/Quick Look/WebXR), USDZ trên iPhone, qua đường hầm Tailscale.
