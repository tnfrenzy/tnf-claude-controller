## Quy ước chung của controller (không được sửa, không do idea-splitter viết)

- Đọc và tuân thủ `CLAUDE.md` của môi trường trước khi sửa mã.
- Test không gọi Claude thật: dùng CLI giả (`TNF_FAKE_CLAUDE=1`). Chỉ chạy test nhắm đích của lệnh này.
- Commit sau từng task khi test nhắm đích qua: `git add -A` rồi `git commit -m "<type>(<scope>): <desc>"`. Không push.
- Lỗi môi trường đã biết (không thuộc lệnh này, đừng sửa, chỉ ghi lại nếu gặp):
{{knownEnvFailures}}
