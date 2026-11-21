# Hợp đồng API theo dõi nhân viên ảo (tòa nhà thứ 3 của controller)

Mỗi **tầng** của tòa nhà thứ 3 là một kết nối API. App controller gọi API **chỉ-đọc** của hệ thống bên kia định kỳ (kéo dữ liệu), không bao giờ gọi ghi. Mỗi **nhân viên ảo = một lệnh `claude -p`** (Báo Giá, Bản vẽ, Chứng Thư, ...), hiển thị thành một nhân vật trong văn phòng 2.5D của tầng đó. Phòng ban chỉ là nhãn để gom nhân vật vào cùng một phòng.

## Yêu cầu

```
GET {baseUrl}{path}          path mặc định: /api/monitor/nhan-vien-ao
Authorization: Bearer <token chỉ-đọc>
```

Trả `200` với JSON dưới đây. Mã khác 200, quá 8 giây, hoặc JSON sai dạng thì controller báo "không kết nối được" cho tầng đó (không làm hỏng tầng khác).

```json
{
  "generatedAt": "2026-11-05T02:00:00.000Z",
  "employees": [
    {
      "id": "bao-gia",
      "name": "Báo Giá",
      "department": "sales",
      "paused": false,
      "queueKnown": true,
      "counts": { "pending": 0, "processing": 1, "failed": 0, "done": 12 },
      "waitingLock": false,
      "lastFinishedAt": "2026-11-05T01:58:00.000Z",
      "avgSeconds": 190,
      "failedRate": 0
    }
  ]
}
```

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `employees[].id` | có | Khóa ổn định của nhân viên = loại việc (`bao-gia`, `ban-ve`, `chung-thu`, ...). Duy nhất trong một API. |
| `employees[].name` | có | Tên hiển thị tiếng Việt. |
| `employees[].department` | không | Khóa phòng (`sales`, `acc`, `eng`, `hr`, `kho`, `prod`, `mon`, `marketing`, `admin`) để gom vào cùng phòng. |
| `employees[].paused` | không | Giám đốc đã tạm dừng (mặc định false). |
| `employees[].queueKnown` | không | false = lệnh này chưa có hàng đợi để đếm (BOM, Hợp Đồng, Xuất AMIS...). Controller hiện "chưa nối" thay vì số 0. Mặc định true. |
| `counts` | có khi `queueKnown` | Số việc theo trạng thái trong cửa sổ 24 giờ gần nhất: `pending` (chờ), `processing` (đang xử lý), `failed` (lỗi), `done` (xong). Số nguyên >= 0. |
| `waitingLock` | không | true khi có việc chờ nhưng đang đợi khóa chung (nhân viên khác đang chạy `claude -p`). |
| `lastFinishedAt` | không | ISO thời điểm việc gần nhất xong, hoặc null. |
| `avgSeconds` | không | Thời gian xử lý trung bình (giây) của các việc xong trong cửa sổ, hoặc null. |
| `failedRate` | không | Tỷ lệ lỗi 0..1 trong cửa sổ, hoặc null. |

**Không trả nội dung nghiệp vụ** (tên khách, giá, hợp đồng, nội dung câu lệnh). Chỉ số lượng và trạng thái.

Tối đa 40 nhân viên mỗi API; văn phòng 2.5D chứa gọn khoảng 20.

## Cách controller suy ra trạng thái nhân vật

| Điều kiện | Nhân vật |
|---|---|
| `processing > 0` | Ngồi vào bàn làm việc |
| `pending > 0`, `processing = 0`, `waitingLock` | Rảnh nhưng có nhãn "chờ khóa" |
| `paused` | Nhãn "tạm dừng" |
| `failed > 0` | Nhãn lỗi đỏ ở bảng số liệu |
| `queueKnown = false` | Nhãn "chưa nối" |
| còn lại | Rảnh, đi lại như nhân viên thường trú |

## Câu lệnh giao cho phiên ở môi trường Platform (Claude Desktop)

Dán nguyên khối dưới đây vào một phiên mới ở môi trường `D:\Projects\platform`.

```text
Đọc CLAUDE.md và 10-20 dòng cuối docs/nhat-ky-thay-doi.md trước. Làm trong worktree riêng (git worktree), không sửa thẳng trên master, không phát hành.

MỤC TIÊU: mỗi lệnh `claude -p` là MỘT nhân viên ảo (thay vì 3 nhân viên theo phòng ban), và mở một API chỉ-đọc để app TNF Claude Controller theo dõi.

1) Đổi registry nhân viên ảo (src/lib/nhan-vien-ao/registry.ts):
   - Mỗi năng lực hiện có (loaiJob: bao-gia, ban-ve, hop-dong, chung-thu, de-nghi-chung-thu, xuat-amis, ban-ve-thang, bom, hsll) thành một nhân viên ảo riêng: khoa = loaiJob, ten tiếng Việt, phongBan giữ nguyên làm nhãn gom nhóm, bangHangDoi như cũ (null = chưa xác minh).
   - Công tắc bật/tạm dừng: mỗi nhân viên một khóa cài đặt riêng (vd. nhanvienao.<loaiJob>.bat). Các chỗ chạy việc đang đọc khóa theo phòng (runNextChungThuJob, runNextBanVeThangJob, runNextHsllJob, các job Báo Giá...) phải đọc khóa mới. Có migration/seed giá trị cũ: nếu khóa cũ theo phòng đang tắt thì các khóa mới của phòng đó cũng tắt, để không vô tình bật lại việc đang tạm dừng.
   - Cập nhật trang /quan-tri/nhan-vien-ao, actions, permissions, thong-ke, test và docs/cay-thu-muc.md cho khớp.

2) Thêm API chỉ-đọc GET /api/monitor/nhan-vien-ao đúng hợp đồng ở file sau (đọc kỹ, đúng tên trường):
   D:\tnf-claude-controller\docs\API-NHAN-VIEN-AO.md  (mục "Yêu cầu")
   - Xác thực bằng token Bearer qua cơ chế sẵn có (src/lib/api/tokens.ts, userForToken), dùng cùng quy tắc phân quyền như trình duyệt; chỉ Giám đốc/Admin mới đọc được. Không tạo mô hình phân quyền thứ hai.
   - Số liệu lấy từ thong-ke.ts (cửa sổ 24 giờ); avgSeconds, failedRate, lastFinishedAt tính từ claimedAt/finishedAt/status của bảng hàng đợi. waitingLock: true khi có việc pending nhưng khóa chung đang bị nhân viên khác giữ.
   - KHÔNG trả nội dung nghiệp vụ (tên khách, giá, nội dung câu lệnh). Chỉ số lượng và trạng thái.
   - Hàng đợi chưa xác minh trả queueKnown=false, không trả counts giả.
   - Chỉ GET; không có đường ghi.

3) Kiểm: test đơn vị cho registry mới, cho dạng JSON của API (đúng schema, đúng 401 khi token sai, đúng 403 khi không phải Giám đốc/Admin), cho phần di chuyển công tắc. Chạy npm run verify. Test tích hợp cần DATABASE_URL_TEST (xem CLAUDE.md: Postgres phải sống trước).

4) Việc cuối phiên: thêm mục vào đầu phần "Nhật ký" của docs/nhat-ky-thay-doi.md (ngày, nhánh, đã làm, còn dở, bẫy).

Không đụng .env và file tài khoản thử. Cuối cùng báo lại: tên nhánh, đường dẫn API, cách tạo một token chỉ-đọc cho controller, và danh sách nhân viên ảo mới.
```
