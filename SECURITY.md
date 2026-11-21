# Bảo mật / Security

- Server chỉ lắng nghe `127.0.0.1`; mọi API cần token điều khiển (`data/controller.token`) và kiểm `Origin`/`Host`. Mở ra ngoài (ví dụ Tailscale Serve) chỉ qua `server.allowedOrigins`.
- Ứng dụng chạy `claude -p` trên hạn mức thuê bao của chính bạn; không dùng API key. Run lập trình chạy trong git worktree riêng với danh sách lệnh bị chặn; đó là **rào chắn cho agent hợp tác, không phải hộp cát bảo mật**.
- Script CAD do agent viết qua bộ kiểm AST nhưng vẫn chạy trên máy bạn: chỉ dùng với nội dung bạn tin.

Báo lỗi bảo mật: mở một "Security advisory" riêng tư trên GitHub của dự án, đừng đăng công khai chi tiết khai thác.

The server binds to `127.0.0.1` only and every API needs the control token and an `Origin`/`Host` check. Agent permission rules are guard rails, not a security sandbox. Report vulnerabilities privately through a GitHub security advisory.
