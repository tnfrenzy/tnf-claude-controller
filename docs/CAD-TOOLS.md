# Công cụ đọc/ghi bản vẽ CAD (AutoCAD, SolidWorks)

**Trạng thái (2026-10-29): đã cài và kiểm chứng bằng chạy thật: Python, ezdxf (DXF) và cadquery (STEP).** ODA File Converter (DWG) và SolidWorks chưa có.

### Đã cài
- Python 3.12.10, cài bằng `winget install --id Python.Python.3.12 --scope user` (cho tài khoản người dùng, không cần quyền quản trị): `C:\Users\<tên>\AppData\Local\Programs\Python\Python312\python.exe`.
- Môi trường ảo riêng cho CAD: `D:\tnf-cad-tools\cad-venv`, cố ý nằm ngoài mọi thư mục workspace (dọn workspace không xóa nhầm nó) và ngoài `%LOCALAPPDATA%` (bản cài Windows Store của Claude chuyển hướng ghi vào đó sang kho ảo riêng của gói, nên tiến trình khác không thấy). Chạy bằng `D:\tnf-cad-tools\cad-venv\Scripts\python.exe`.
- Trong venv: `ezdxf 1.4.5`, `cadquery 2.8.0` (kéo theo `cadquery-ocp 7.9.3.1.1`, `numpy 2.5.4`, `vtk 9.6.2`), cùng các gói của xưởng dựng 3D: `trimesh`, `pillow` (ghép GLB, texture), `usd-core` (xuất USDZ cho AR iOS).
- Tạo lại từ đầu (đúng đường dẫn app tìm mặc định):
  ```
  py -3.12 -m venv D:\tnf-cad-tools\cad-venv
  D:\tnf-cad-tools\cad-venv\Scripts\python.exe -m pip install ezdxf cadquery trimesh pillow usd-core
  ```
  Tùy chọn: `pip install fast-simplification` để giảm số tam giác cho bản GLB nhẹ trên điện thoại (`model-mobile.glb`); thiếu gói này thì bản di động giữ nguyên lưới và app ghi cảnh báo.
- Venv ở chỗ khác: đặt đường dẫn `python.exe` vào `tools.cad.python` trong `controller.json` hoặc biến môi trường `TNF_CAD_PYTHON`. Thiếu Python thì app báo ngay khi tạo phiên dựng 3D (API trả 503, `tnf w3d run` thoát mã 1) thay vì để phiên chạy rồi mới lỗi.

### Đã nối vào app (0.5.7)
- `tools/cad/` (đóng gói vào bản cài): `check_env.py` (phiên bản thư viện, không import nên nhanh), `dxf_info.py` (lớp, thực thể, kích thước, chữ, hộp bao của DXF), `step_info.py` (số khối, mặt, thể tích, hộp bao, lỗ trụ của STEP). Mỗi script in một JSON gọn, có giới hạn kích thước.
- `src/core/design3d/cad-tools.ts`: tìm Python (biến `TNF_CAD_PYTHON`, khóa `tools.cad.python` trong `controller.json`, rồi `D:\tnf-cad-tools\cad-venv`, nơi cũ, `%LOCALAPPDATA%\TNF\Controller\tools\cad-venv`); spawn không qua shell, hết 120 s thì dừng cả cây tiến trình (trên Windows bằng `taskkill /T /F`, vì `python.exe` của venv là trình khởi chạy sinh ra tiến trình Python thật).
- Đính kèm tệp `.dxf`, `.step`, `.stp` vào một lệnh: controller tự tạo `<tên>.cad.json` cạnh tệp trong thư mục inbox của run và ghi chú vào prompt, để agent (chỉ đọc được văn bản) đọc bản tóm tắt. Không có Python thì bỏ qua êm, run vẫn chạy.
- CLI: `tnf cad status`, `tnf cad inspect <tệp>`. API: `GET /api/cad/status`, `POST /api/cad/inspect` (`stageId`, `name` của tệp đã đính kèm). Cài đặt có khối "Công cụ CAD" hiện trạng thái.
- Chưa nối: xưởng skill (tệp mẫu CAD vẫn chỉ được liệt kê tên), ODA File Converter và SolidWorks.
### Đã kiểm chứng (2026-10-29)
- DXF: tạo (LINE, CIRCLE, TEXT, R2018), lưu, đọc lại đúng 3 thực thể, lưu ra file thứ hai và đọc lại được. Thực hiện bằng ezdxf 1.4.5.
- STEP: tạo khối 40 x 30 x 10 có lỗ khoan đường kính 8, xuất STEP, nhập lại; thể tích 11497,35 trước và sau khi nhập lại khớp nhau, hộp bao 40 x 30 x 10. Thực hiện bằng cadquery 2.8.0.
- Chưa kiểm: đọc DWG (cần ODA File Converter), file SolidWorks (SLDPRT, SLDDRW), đọc DXF thật của dự án. App chưa gọi các công cụ này; chưa có mã tích hợp.

### Việc còn lại
1. ODA File Converter: tải tay từ trang Open Design Alliance, chấp nhận điều khoản. SolidWorks: cần bản quyền, cài tay.
2. Thử với bản vẽ DXF thật (đã trích sang JSON hoặc đọc trực tiếp bằng ezdxf) trước khi thiết kế tích hợp vào xưởng skill.

Mục tiêu: để AI đọc được bản vẽ, huấn luyện/phân tích, và xuất lại **file bản vẽ**. Định dạng khả thi nhất cho đầu ra: DXF (2D) và STEP (3D). DWG và SLDPRT/SLDDRW là định dạng đóng, không có thư viện mở đáng tin để ghi trực tiếp.

## Bảng lựa chọn

| Công cụ | Giấy phép | Đọc/ghi | Lệnh cài đề xuất |
|---|---|---|---|
| ezdxf | MIT | Đọc và ghi DXF (không đọc DWG) | `python -m venv .venv-cad` rồi `.venv-cad\Scripts\pip install ezdxf` |
| ODA File Converter | Miễn phí dùng nội bộ, không mã nguồn mở, điều khoản riêng | Chuyển DWG <-> DXF | Tải thủ công từ trang Open Design Alliance, cài tay |
| SolidWorks (API COM / xuất file) | Thương mại, cần bản quyền | Đọc SLDPRT/SLDDRW qua SolidWorks; xuất STEP/DXF/PDF | Cài thủ công SolidWorks; Python: `.venv-cad\Scripts\pip install pywin32` |
| cadquery / OCP | Apache-2.0 | Đọc và ghi STEP (3D) | `.venv-cad\Scripts\pip install cadquery` |
| FreeCAD (tùy chọn) | LGPL | Đọc STEP/DXF/IGES, script Python; không đọc SLDPRT | Cài thủ công từ trang FreeCAD hoặc `winget install FreeCAD.FreeCAD` |

### 1. ezdxf - CHƯA KIỂM CHỨNG
- Đọc/ghi DXF: lớp, đường, cung, văn bản, kích thước, block. Phù hợp tạo dữ liệu huấn luyện dạng văn bản/JSON từ DXF và ghi lại DXF.
- Giới hạn: không mở DWG; kết xuất hình ảnh cần thêm matplotlib.

### 2. ODA File Converter - CHƯA KIỂM CHỨNG
- Cầu nối DWG <-> DXF bằng dòng lệnh, để ezdxf xử lý tiếp.
- Giới hạn: không phải mã nguồn mở, cần chấp nhận điều khoản, cài tay; phiên bản DWG mới có thể cần bản ODA mới.

### 3. SolidWorks SLDPRT/SLDDRW - CHƯA KIỂM CHỨNG
- Định dạng đóng. Cách khả thi: dùng chính SolidWorks (có bản quyền) qua API COM (pywin32) hoặc macro để xuất STEP/DXF/PDF, rồi xử lý file xuất.
- Giới hạn: bắt buộc có SolidWorks cài trên máy; tự động hóa COM cần thử nghiệm.

### 4. cadquery / OCP - CHƯA KIỂM CHỨNG
- Đọc/ghi STEP, dựng mô hình 3D bằng Python. Gói cài khá nặng (OpenCascade).
- Giới hạn: không đọc SLDPRT/DWG; cần Python phiên bản được hỗ trợ.

### 5. FreeCAD (tùy chọn) - CHƯA KIỂM CHỨNG
- Chạy headless bằng Python để đọc STEP/DXF/IGES, chuyển đổi định dạng.
- Giới hạn: dung lượng lớn, không đọc SLDPRT, DWG cần bộ chuyển đổi.

## Quy trình đề xuất tích hợp vào app (chưa làm)
1. Mỗi project tạo venv riêng (`.venv-cad` trong thư mục dữ liệu project), không cài toàn cục.
2. Thêm vai mới "cad-reader" trong thư viện vai, chỉ được chạy script trong venv đó (allowlist `Bash` hẹp theo project, qua `project.allowed_commands`).
3. Luồng: DWG -> (ODA) DXF -> ezdxf trích JSON (lớp, thực thể, kích thước) -> AI phân tích -> ezdxf ghi DXF đầu ra. SolidWorks -> xuất STEP/DXF bằng SolidWorks -> cadquery/ezdxf.
4. Đầu ra đặt trong artifact của run để tải về như các artifact khác.

## Câu hỏi cần người dùng duyệt
- Đã có bản quyền SolidWorks cài trên máy chạy app chưa?
- Ưu tiên đầu ra DXF (2D) hay STEP (3D), hay cả hai?
- Cho phép tải và cài ODA File Converter (điều khoản riêng) không?
- Cho phép tạo venv Python riêng cho project và `pip install` trong đó không?
- Bản vẽ chủ yếu là 2D (AutoCAD) hay mô hình 3D (SolidWorks)?

**Chờ người dùng duyệt cài** trước khi thực hiện bất kỳ bước cài đặt nào ở trên.
