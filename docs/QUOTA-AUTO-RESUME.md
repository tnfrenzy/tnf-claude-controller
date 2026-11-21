# Tự tiếp tục sau khi hết hạn mức

Tài liệu này mô tả cách controller chờ hạn mức thuê bao claude.ai được đặt lại rồi tiếp tục run đã dừng. Phần **đã có** trong mã: các khóa cấu hình `quotaEnabled`, `quotaMarginSec`, `quotaFallbackMin`, `maxAttempts` trong `src/core/app/config.ts` (`parseAutoResume`). Phần còn lại là **thiết kế**; mọi tên đánh dấu "(thiết kế, do các lệnh khác triển khai, chưa có trong `src/` lúc viết)" là chưa tồn tại: `isQuotaStopError`, `computeResumeAt`, bảng `quota_resumes`, `pauseUntil`, `maybeQuotaResume`, API `quota-resume`, UI đếm ngược, tệp `quota-resume.ts`.

## Mục lục
1. Nhận diện hết hạn mức
2. Tính giờ tiếp tục
3. Khóa cấu hình
4. Lưu hẹn và nạp lại
5. Hàng đợi, followup và Hủy hẹn
6. Bảo mật và kiểm an toàn
7. Ghi công

## 1. Nhận diện hết hạn mức

Chỉ dùng dữ liệu từ stream-json; không đọc nguồn nào khác. Trường thật trong stream là `rate_limit_info.unifiedWindows.five_hour` và `rate_limit_info.unifiedWindows.seven_day`. Mỗi cửa sổ có `utilization` và `resetsAt` (kèm `status`, `isUsingOverage`, `overageStatus`).

Trong sự kiện `rate.limit` đã chuẩn hóa theo thiết kế, tên trường là `resets_at` và `limit_type`. `limit_type` chưa kiểm chứng bằng stream thật.

Dấu hiệu run dừng vì hết hạn mức (ví dụ `status` = rejected) chưa có fixture thật: phải ghi fixture từ một lần chạy thật trước khi tin `isQuotaStopError` (thiết kế, do các lệnh khác triển khai, chưa có trong `src/` lúc viết). Hàm này không được khớp timeout hay `subagent_interrupted`.

Quy tắc đơn vị (thiết kế của `computeResumeAt`, chưa có trong mã): `resetsAt` < 1e11 là giây, ngược lại là ms. Lưu ý `stream-parser` hiện nhân 1000 vô điều kiện.

## 2. Tính giờ tiếp tục

`computeResumeAt` (thiết kế, do các lệnh khác triển khai, chưa có trong `src/` lúc viết) lấy mốc `resetsAt` hợp lệ gần nhất cộng margin. Nếu không có mốc, mốc đã qua, hoặc xa quá 8 ngày thì dùng now + fallback. Tính bằng epoch ms nên không lệch múi giờ.

## 3. Khóa cấu hình

Các khóa nằm trong khối `autoResume` của `config/controller.json`. Chúng là tùy chọn: thiếu thì `parseAutoResume` dùng mặc định. Hiện `config/controller.json` chưa có khối `autoResume`.

| Khóa | Mặc định | Khoảng |
|---|---|---|
| `quotaEnabled` | true (chỉ `false` tường minh mới tắt) | bật/tắt |
| `quotaMarginSec` | 60 | 0..1800 |
| `quotaFallbackMin` | 60 | 5..600 |
| `maxAttempts` | 3 | 0..10 |

Dấu "[Tự tiếp tục sau hạn mức lần" và "[Tự động tiếp tục lần" đếm chung trần `maxAttempts`.

## 4. Lưu hẹn và nạp lại

Bảng `quota_resumes` (thiết kế, do các lệnh khác triển khai, chưa có trong `src/` lúc viết) lưu hẹn với trạng thái pending, fired, cancelled, failed. Khi khởi động, controller nạp lại các hẹn pending. Trước khi bắn kiểm lại: hẹn còn pending, run không đang chạy, run còn ở trạng thái error, chưa có run con.

`maybeQuotaResume` (thiết kế) chạy trước `syncQueueOnExit` và bỏ qua `maybeAutoResume`.

## 5. Hàng đợi, followup và Hủy hẹn

Run thuộc hàng đợi dùng `pauseUntil` (thiết kế) để tạm dừng, không tốn `autoRetry`. Tiếp tục bằng followup vào session cũ qua `RunManager.followup`. Hủy hẹn của run kind queue sẽ dừng run-all; lệnh được ghi "lỗi" và không chạy tiếp ngay.

API (thiết kế): `GET /api/runs/:id/quota-resume` và `POST /api/runs/:id/quota-resume/cancel`. UI hiển thị đếm ngược (thiết kế).

## 6. Bảo mật và kiểm an toàn

- `runBillingGuard` ở `src/core/run/billing-guard.ts` chặn API key.
- Chạy `claude auth status` trước mỗi lần tiếp tục.
- Xóa `ANTHROPIC_API_KEY` và `ANTHROPIC_AUTH_TOKEN` khỏi env tiến trình con.
- Không đọc transcript `.jsonl` nội bộ của Claude Code.

## 7. Ghi công

Ý tưởng lấy từ claude-auto-resume (giấy phép MIT); controller tự viết lại, không chép mã.
