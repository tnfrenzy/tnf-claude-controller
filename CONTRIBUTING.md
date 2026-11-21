# Đóng góp / Contributing

**Tiếng Việt.** Cảm ơn bạn quan tâm. Quy tắc ngắn:

- Mã, tên biến, tên tệp và commit viết bằng tiếng Anh; giao diện và thông báo cho người dùng bằng tiếng Việt (có bản tiếng Anh trong `ui/src/i18n.ts`).
- Trước khi gửi: `npm run typecheck` và `npm test` phải qua. Test không gọi Claude thật.
- Đọc `CLAUDE.md` (quy tắc cứng: không dùng `--bare`, không `--dangerously-skip-permissions`, spawn `claude` không qua shell, server chỉ bind `127.0.0.1`).
- Không đưa dữ liệu cá nhân, token, email thật hay tên khách hàng vào mã, tài liệu, fixture hoặc ảnh chụp màn hình.
- Chạy `npm run privacy:scan` trước khi gửi; phải ra "Sạch". Tự tạo `.privacy-denylist` (không commit) với tên riêng của bạn.
- Mỗi thay đổi nhỏ một commit; mô tả rõ lý do.

**English.** Code, identifiers, filenames and commits are in English; the UI is Vietnamese with English strings in `ui/src/i18n.ts`. Run `npm run typecheck` and `npm test` before sending a change (tests never call the real Claude CLI). Read `CLAUDE.md` for the hard rules. Never commit personal data, tokens, real emails or customer names, including in fixtures and screenshots; run `npm run privacy:scan` (and keep your own words in the git-ignored `.privacy-denylist`) before sending a change.

## Phát hành bản công khai / Publishing a public snapshot

`npm run publish:snapshot` (xem `CLAUDE.md`, quy tắc 13): quét riêng tư, tạo snapshot một commit và in lệnh đẩy; chỉ đẩy khi có `-- --push --yes`. Copy `.publish-config.example.json` thành `.publish-config.json` và điền kho của bạn.
