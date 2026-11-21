# Nhập vai, skill, prompt từ file .md vào thư viện

Tài liệu này mô tả cách nhập một file markdown (subagent của Claude Code, `SKILL.md`, hoặc văn bản thường) vào thư viện toàn cục (`data/library/library.json`, xem SPEC v1 §4.2c) và API `POST /api/library/import`.

## 1. Tổng quan

Luồng: `buildImportPreview` (`src/core/roles/agent-md.ts`) dựng bản xem trước, rồi `importAgentMd` (`src/core/roles/agent-md-import.ts`) gọi `createRole` hoặc `createItem` của thư viện (`src/core/roles/role-library.ts`).

- Nhập chỉ **lưu vào thư viện**. Hệ thống **không tự chạy** vai, skill hay prompt nào sau khi nhập; muốn dùng, người dùng phải tự gắn vào một run.
- Có chế độ xem trước (`dryRun`) không ghi gì.

> **Cảnh báo quan trọng:** hệ thống **KHÔNG kiểm an toàn nội dung prompt**. Nó chỉ (a) lọc danh sách công cụ, (b) cắt độ dài, (c) cảnh báo khi gặp một số từ khóa. Từ khóa chỉ là gợi ý, không phải bộ lọc an ninh: prompt độc hại hoặc chứa chỉ dẫn cài cắm vẫn có thể qua được. Người dùng phải tự đọc nội dung trước khi nhập và **chỉ nhập từ nguồn tin cậy**.

## 2. Định dạng hỗ trợ

1. **Subagent Claude Code**: phần frontmatter `---` có `name`, `description`, `tools`, `model` (và tùy chọn `license`), thân file là prompt.
2. **`SKILL.md`**: frontmatter `name`, `description`, thân là hướng dẫn của skill.
3. **File .md không frontmatter**: vẫn nhập được, có cảnh báo `no_frontmatter`. Mô tả lấy từ dòng không rỗng đầu tiên của thân (bỏ các dấu `#` đầu dòng); tên lấy từ tên tệp nếu có `filename`.

Bộ đọc frontmatter tự viết (không dùng thư viện YAML) hiểu: `key: value`, danh sách `- x`, danh sách dạng `[a, b]`, khối `|` và `>`; chịu BOM và CRLF. Khóa không phân biệt hoa thường. Mô tả thiếu thì lấy từ thân như trên.

## 3. Cách đoán loại

Theo thứ tự:

1. Tham số `as` (`role`, `skill`, `prompt`) nếu có.
2. Tên tệp là `SKILL.md` (không phân biệt hoa thường) thì là `skill`. Chỉ áp dụng khi client truyền `filename`.
3. Không có khóa `tools` lẫn `model` trong frontmatter và thân dài hơn 4000 ký tự thì là `skill`.
4. Còn lại là `role` (vai).

Mã vai: `id = normalizeName(id || name || tên tệp không đuôi)`; tên hiển thị tối đa 80 ký tự.

## 4. Công cụ an toàn

Chỉ các công cụ sau được giữ (không phân biệt hoa thường, ghi về dạng chuẩn): `Read`, `Grep`, `Glob`, `Edit`, `Write`, `WebSearch`, `WebFetch`.

- Mọi công cụ khác bị bỏ, ghi vào `droppedTools`, cảnh báo `tools_dropped`.
- **`Bash` luôn bị bỏ**, kể cả dạng `Bash(...)`, và `*` cũng bị bỏ.
- Cảnh báo `tools_defaulted`: vai (kind `role`) được gán công cụ mặc định `Read, Grep, Glob` khi file không có khóa `tools`, hoặc có `tools` nhưng sau khi lọc không còn công cụ nào. Chỉ áp cho vai; skill/prompt không có công cụ (trừ khi file có khóa `tools` mà lọc hết, khi đó cũng gán mặc định).

Lưu ý: gọi thẳng `createRole` (API `POST /api/library/roles`) thì **từ chối** Bash và prompt dài quá 4000 bằng mã 400; còn đường nhập thì tự bỏ/cắt kèm cảnh báo.

## 5. Model

Khóa `model` bị bỏ (cảnh báo `model_dropped`, vai dùng model mặc định của hệ thống) khi là `inherit` hoặc không khớp `^[A-Za-z0-9._-]{1,64}$`. Khớp thì giữ nguyên.

## 6. Giới hạn

- Prompt của vai: cắt còn 4000 ký tự (cảnh báo `prompt_truncated`).
- Nội dung skill/prompt: cắt còn 64 KB (cũng `prompt_truncated`).
- Mô tả: tối đa 300 ký tự (cảnh báo `description_truncated`; mô tả của skill/prompt không được lưu).
- Thư viện: tối đa 30 vai và 100 mục (skill + prompt). Đầy thì chặn `library_full`.
- `text` tối đa 131072 byte (128 KB).

## 7. Kiểm giấy phép

Đọc khóa `license` trong frontmatter:

- Không có khóa: cảnh báo `license_unknown`, **không chặn**.
- Có khóa nhưng không thuộc nhóm cho phép: chặn `license_not_permissive` (400 khi nhập thật).

Chuẩn hóa trước khi so: bỏ khoảng trắng đầu/cuối, chữ thường, khoảng trắng và `_` đổi thành `-`; so khớp toàn chuỗi (không so chuỗi con). Ví dụ "MIT License" thành `mit-license` nên hợp lệ. Tập hợp lệ: `mit`, `mit-license`, `apache-2.0`, `apache-2`, `apache-license-2.0`, `bsd-2-clause`, `bsd-3-clause`, `isc`, `unlicense`, `the-unlicense`, `cc0`, `cc0-1.0`, và `cc-by` (trần) cùng `cc-by-1.0`, `cc-by-2.0`, `cc-by-3.0`, `cc-by-4.0`. GPL, CC-BY-SA, CC-BY-NC... đều bị chặn.

## 8. Từ khóa cảnh báo

Khi prompt hoặc mô tả chứa một trong các từ sau (chuỗi con, không phân biệt hoa thường) thì có cảnh báo `danger_keyword` và danh sách `dangerKeywords`. **Chỉ cảnh báo, không chặn**:

`push`, `rm -rf`, `rm -r`, `remove-item -recurse`, `xóa đệ quy`, `xoa de quy`, `đẩy lên remote`, `curl`, `wget`, `bypass`, `dangerously-skip-permissions`, `sudo`, `chmod 777`.

Không có từ khóa không có nghĩa là prompt an toàn (xem khung cảnh báo ở mục 1).

## 9. API `POST /api/library/import`

Cần token như mọi API khác. Body JSON:

| Trường | Kiểu | Ghi chú |
| --- | --- | --- |
| `text` | chuỗi | bắt buộc, nội dung file |
| `as` | `role`, `skill` hoặc `prompt` | tùy chọn, ép loại |
| `id` | chuỗi | tùy chọn, mã vai/tên |
| `filename` | chuỗi | tùy chọn, dùng đoán loại và tên |
| `dryRun` | boolean | `true` chỉ xem trước |

Mã trả về:

- **200** `{ preview }` khi `dryRun: true`. Mã này trả về **kể cả khi `preview.blocked` khác `null`**, nên client phải tự kiểm `preview.blocked` trước khi cho nhập thật.
- **201** `{ preview, role }` (vai) hoặc `{ preview, item }` (skill/prompt) khi nhập thật thành công.
- **400** `{ error: "bad_request", message }`: sai kiểu trường (`text`, `as`, `id`, `filename`, `dryRun`), JSON hỏng, hoặc body HTTP quá 160 KB ("Nội dung quá lớn.").
- **400** `{ error: "library_error", message }`: `text` vượt 131072 byte ("Nội dung quá lớn (tối đa 128 KB)."), `text` rỗng hoặc thiếu mã/prompt (`blocked = empty`), giấy phép không cho phép, hoặc thư viện đầy.
- **409** `{ error: "library_error", message }`: `id_conflict` (mã trùng vai có sẵn hoặc vai trong thư viện; chỉ với vai).

Thứ tự chặn: `empty` > `license_not_permissive` > `id_conflict` > `library_full`.

`preview` gồm: `kind`, `id`, `name`, `description`, `prompt`, `tools`, `model?`, `droppedTools`, `dangerKeywords`, `warnings`, `license`, `licenseOk`, `blocked`.
