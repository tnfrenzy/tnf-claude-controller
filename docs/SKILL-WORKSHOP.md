# Xưởng Skill (Skill Workshop): đặc tả

Trạng thái: bản thảo đặc tả, chưa có mã. Tài liệu này chỉ mô tả; mọi thay đổi mã nằm ở các task của mục 8.

## Quyết định đã chốt

- Tầng của tòa "Huấn luyện AI" = một skill, có cấu trúc riêng, không ánh xạ sang project (khác tòa project hiện có).
- Tòa "Huấn luyện AI" được thêm vào `ui.towers` trong `config/controller.json` (`ui.towers` là mảng chuỗi).
- Các vai workshop dùng một project nhãn không có repo (ví dụ `skill-workshop`), nên mỗi bước chạy với kind `research`, không có worktree.
- Bộ điều phối tự cộng `total_cost_usd` của từng run con; controller không có trần cộng dồn sẵn.
- Chi phí luôn là ước tính, không phải hóa đơn.
- Ví dụ miền dùng example.com.

## Mục lục

1. Mục tiêu
2. Gói skill
3. Công thức điểm
4. Máy trạng thái bộ điều phối
5. Sáu vai
6. Chạy thử không dựa vào Skill(<tên>)
7. API, giao diện, bản đồ file module
8. Chia task (Lệnh 2 đến Lệnh 10)

## 1. Mục tiêu

- Thêm tòa "Huấn luyện AI" vào cảnh thành phố. Mỗi tầng huấn luyện đúng một skill (một gói `SKILL.md` kèm quy tắc, mẫu, tiêu chí chấm).
- Người dùng nêu nhu cầu bằng tiếng Việt (ví dụ "skill viết email báo giá cho khách example.com"). Hệ thống phỏng vấn, phân tích mẫu, soạn skill, chạy thử, chấm điểm, phản biện rồi soạn lại.
- Vòng lặp chạy tự động đến khi điểm tổng >= 90/100, hoặc chạm một điều kiện dừng (mục 4). Khi đạt, người dùng duyệt lần cuối trước khi skill được coi là hoàn tất.
- Tầng trong cảnh hiển thị điểm, vòng hiện tại, trạng thái; popup tầng có nút duyệt và dừng.
- Nguyên tắc: vòng lặp nằm trong mã controller, không do agent quyết; agent chỉ làm việc từng bước và trả JSON để controller kiểm lược đồ.

## 2. Gói skill

Mỗi skill là một thư mục `data/skills/<slug>/` (nằm trong `data/`, ngoài git):

```
data/skills/<slug>/
  SKILL.md            nội dung skill (frontmatter name + description, thân Markdown)
  inputs.json         mô tả đầu vào của skill
  rules.md            quy tắc cứng người dùng đã chốt qua phỏng vấn
  scripts/            script do AI viết (không tự chạy, xem bên dưới)
  examples/           mẫu vào/ra (huấn luyện và giữ lại)
  eval/rubric.json    tiêu chí chấm (mục 3)
  meta.json           thông tin chung và trạng thái
  rounds.json         nhật ký từng vòng
```

### 2.1 Slug và chống path traversal

- Slug đi qua `normalizeName` (`src/core/roles/role-library.ts`) và phải khớp `ID_RE = /^[a-z0-9-]{1,40}$/`. Sai thì lỗi 400, không tự sửa im lặng thành chuỗi rỗng.
- Mọi đường dẫn tương đối trong gói (tên file ví dụ, script) chỉ cho phép phân đoạn thường; cấm `..`, cấm đường dẫn tuyệt đối, cấm ký tự `:` và `\` trong tên.
- Sau khi ghép, gọi `path.resolve` rồi `fs.realpath` và kiểm kết quả nằm trong thư mục gói (so sánh có dấu phân cách cuối, không dùng `startsWith` thô).
- Cấm symlink/junction trong gói: gặp thì từ chối đọc và ghi.
- Ghi nguyên tử: ghi ra file tạm cùng thư mục rồi `rename` đè; lỗi giữa chừng không để lại file nửa vời. Đọc `rounds.json` và `meta.json` chịu lỗi (file hỏng thì báo lỗi rõ, không sập server).
- Mã: `src/core/skill-pack.ts` (mục 7).

### 2.2 Giới hạn kích thước

- `SKILL.md` < 64 KB.
- `rules.md` <= 16 KB; `inputs.json`, `meta.json`, `rubric.json` mỗi file <= 32 KB.
- `rounds.json` <= 1 MB (vòng cũ nén bớt phần văn bản dài, giữ điểm và tóm tắt).
- `scripts/` tối đa 10 file, mỗi file <= 32 KB; `examples/` tối đa 30 file, mỗi file <= 64 KB.
- Tổng gói <= 2 MB. Vượt giới hạn thì lỗi 400 với thông báo tiếng Việt nêu file và giới hạn.
- Đây là giá trị mặc định đề xuất; khi làm mã đặt thành hằng số trong `skill-pack.ts`.

### 2.3 Lược đồ JSON

Quy ước: "bắt buộc" = thiếu thì từ chối; khóa lạ bị bỏ qua khi đọc và không ghi lại.

`meta.json`:

- `slug` (string, bắt buộc): khớp tên thư mục.
- `title` (string, bắt buộc, <= 80 ký tự).
- `goal` (string, bắt buộc, <= 1000): mục tiêu người dùng nêu.
- `state` (string, bắt buộc): một trong 12 trạng thái ở mục 4.
- `bestScore` (number 0-100, bắt buộc, mặc định 0) và `bestRound` (integer, mặc định 0).
- `createdAt`, `updatedAt` (string ISO 8601, bắt buộc).
- `costUsdEstimate` (number >= 0, bắt buộc): tổng ước tính cộng từ run con.
- `config` (object, tùy chọn): ghi đè mặc định `passScore`, `maxRounds`, `stallRounds`, `costCapUsd` (mục 4).
- `approvedAt` (string ISO, tùy chọn): có khi người dùng đã duyệt.

`inputs.json`:

- `description` (string, bắt buộc): skill nhận gì.
- `fields` (array, bắt buộc, <= 20 phần tử), mỗi phần tử: `name` (string, bắt buộc, `[a-z0-9_]{1,40}`), `label` (string, bắt buộc, tiếng Việt), `type` (`"text" | "longtext" | "number" | "choice"`, bắt buộc), `required` (boolean, mặc định true), `choices` (array string, bắt buộc khi `type = "choice"`), `example` (string, tùy chọn).

`eval/rubric.json`: lược đồ chi tiết và công thức ở mục 3 (`version`, `passScore`, `criteria[]`).

`rounds.json`:

- `version` (integer, bắt buộc, hiện là 1).
- `rounds` (array, bắt buộc), mỗi phần tử:
  - `n` (integer >= 1, bắt buộc): số vòng.
  - `startedAt`, `endedAt` (string ISO; `endedAt` tùy chọn khi đang chạy).
  - `steps` (array): mỗi bước `{ role, runId, costUsdEstimate, ok }`. `role` thuộc sáu vai ở mục 5; `runId` trỏ tới run con.
  - `score` (number 0-100, tùy chọn tới khi chấm xong) và `criteria` (array `{ id, score, max }`).
  - `skillSha` (string): băm SHA-256 của `SKILL.md` dùng trong vòng, để biết vòng nào đã chấm bản nào.
  - `critique` (string, tùy chọn): tóm tắt phản biện cho vòng sau.
- Khóa `state` hiện tại và trạng thái cuối nằm ở `meta.json`, không lặp ở đây.

### 2.4 Thư mục con

- `examples/`: tên file `train-<n>.json` hoặc `holdout-<n>.json` (`input` object theo `inputs.json`, `expected` string tùy chọn). Phần `holdout-*` dùng để chấm (mục 3), không bao giờ đưa vào prompt vòng soạn.
- `scripts/`: file do vai soạn viết (ví dụ kiểm định định dạng đầu ra). Script là dữ liệu: controller không tự chạy trực tiếp bằng shell. Chỉ chạy bằng mã controller có kiểm soát (ví dụ bộ kiểm tra tích hợp sẵn đọc script như cấu hình, hoặc chạy `node` không qua shell trong thư mục tạm, hết thời gian là bỏ), không cấp quyền Bash cho agent.

## 3. Công thức điểm

- Điểm tổng thang 0-100. Mỗi tiêu chí có `kind`: `code` (đo bằng mã controller, deterministic) hoặc `ai` (vai `cham-diem` chấm, trả điểm trong khối JSON).
- Tổng trọng số (`weight`) mọi tiêu chí = 100 đúng, kiểm khi lưu rubric (lệch thì lỗi 400).
- Tổng trọng số tiêu chí `code` >= 60 (tức phần code >= 60%); phần `ai` <= 40. Mục đích: bớt phụ thuộc phán đoán của mô hình.
- Mỗi tiêu chí cho ra `ratio` trong [0, 1]; điểm tiêu chí = `ratio * weight`.
- Điểm tổng = tổng điểm tiêu chí, làm tròn một chữ số thập phân; so với `passScore` (mặc định 90) bằng số đã làm tròn.
- Điểm vòng là trung bình theo mẫu holdout của từng tiêu chí (mỗi mẫu cho `ratio`, rồi lấy trung bình), không phải điểm cao nhất.

### 3.1 Mẫu giữ lại (holdout)

- Người dùng và vai `phan-tich-mau` tạo mẫu; controller chia: mẫu `train` dùng cho vòng soạn, mẫu `holdout` chỉ dùng để chấm.
- Vòng soạn (`soan-skill`) và `phan-bien` không thấy nội dung `holdout`; chúng chỉ nhận điểm từng tiêu chí và lý do chung do controller tóm tắt, không có đầu vào hay đầu ra mẫu cụ thể.
- Tối thiểu 3 mẫu holdout trước khi vào vòng 1; thiếu thì quay về `awaiting_user` xin thêm mẫu.
- Mục đích: chống học vẹt, skill đạt điểm vì chép mẫu.

### 3.2 Lược đồ `eval/rubric.json`

- `version` (integer, bắt buộc, 1).
- `passScore` (number, tùy chọn, mặc định 90, trong 50-100).
- `criteria` (array, bắt buộc, 3-12 phần tử), mỗi phần tử:
  - `id` (string, `[a-z0-9-]{1,40}`, duy nhất, bắt buộc).
  - `label` (string tiếng Việt, bắt buộc).
  - `kind` (`"code" | "ai"`, bắt buộc).
  - `weight` (number > 0, bắt buộc).
  - `check` (object, bắt buộc khi `kind = "code"`): `type` thuộc tập kiểm định có sẵn trong mã (`contains`, `not-contains`, `regex`, `max-length`, `min-length`, `json-schema`, `section-present`), kèm tham số của từng loại. Không cho `check` chứa mã tùy ý.
  - `prompt` (string, bắt buộc khi `kind = "ai"`): câu hỏi chấm mà `cham-diem` trả lời bằng `ratio` 0-1 và một lý do ngắn.
- Phép đo `code` chạy trên đầu ra của lượt chạy thử (mục 6); mã nằm ở `src/core/skill-scorer.ts`.

## 4. Máy trạng thái bộ điều phối

### 4.1 Nguyên tắc

- Bộ điều phối (`src/core/skill-workshop.ts`) là mã TypeScript giữ máy trạng thái. Mỗi bước là một run riêng (một vai, một lần gọi `claude -p`, kind `research`); agent không quyết định vòng lặp, không quyết định khi nào dừng.
- Điều phối đọc kết quả run con (khối ```json, đã kiểm lược đồ), cập nhật `rounds.json` và `meta.json` rồi chọn bước kế tiếp.
- Chi phí: sau mỗi run con, bộ điều phối cộng `total_cost_usd` của run đó vào `costUsdEstimate` (meta và vòng). Controller không có trần cộng dồn sẵn nên trần này do bộ điều phối tự kiểm trước mỗi bước.

### 4.2 Mười hai trạng thái

- `idle`: skill đã tạo, chưa bắt đầu huấn luyện.
- `interviewing`: vai `phong-van` đang sinh câu hỏi làm rõ nhu cầu.
- `awaiting_user`: chờ người dùng trả lời phỏng vấn hoặc bổ sung mẫu.
- `composing`: vai `soan-skill` soạn hoặc sửa gói skill (kèm `phan-tich-mau` ở vòng đầu).
- `trial`: vai `chay-thu` chạy skill trên mẫu (mục 6).
- `grading`: controller đo tiêu chí `code` và vai `cham-diem` chấm tiêu chí `ai`, sau đó `phan-bien` viết nhận xét.
- `passed`: điểm vòng >= điểm đạt (mặc định 90).
- `awaiting_approval`: đã đạt, chờ người dùng duyệt lần cuối.
- `failed_max_rounds`: hết số vòng tối đa mà chưa đạt.
- `stalled`: hai vòng liền không tăng điểm.
- `cost_cap`: chi phí ước tính cộng dồn chạm trần.
- `stopped`: người dùng bấm dừng (hoặc từ chối ở bước duyệt).

Trạng thái cuối (kết thúc vòng lặp): `failed_max_rounds`, `stalled`, `cost_cap`, `stopped`, và `awaiting_approval` sau khi duyệt (ghi `approvedAt`). `passed` là trạng thái chuyển tiếp ngắn, ngay sau đó sang `awaiting_approval`.

### 4.3 Giá trị mặc định

- Điểm đạt (`passScore`): 90.
- Số vòng tối đa: 5.
- Dừng khi 2 vòng liền không tăng điểm so với điểm tốt nhất trước đó (`stalled`).
- Trần chi phí ước tính (`costCapUsd`): mặc định 3 USD cho mỗi skill, ghi rõ là ước tính; đề xuất, người dùng ghi đè được ở `meta.config`.
- Người dùng duyệt lần cuối: đạt điểm chưa đủ, phải có `approvedAt`.
- Mọi mặc định đọc từ cấu hình (đề xuất khóa `skillWorkshop` trong `config/controller.json`), `meta.config` ghi đè từng skill. Thiếu khóa thì dùng mặc định, giống cách xử lý `contextScan`.

### 4.4 Bảng chuyển trạng thái

| Từ | Sự kiện | Tới |
| --- | --- | --- |
| `idle` | người dùng bấm bắt đầu | `interviewing` |
| `interviewing` | `phong-van` có câu hỏi | `awaiting_user` |
| `interviewing` | `phong-van` báo đủ thông tin | `composing` |
| `awaiting_user` | người dùng gửi trả lời / mẫu (đủ >= 3 mẫu holdout) | `composing` |
| `composing` | `soan-skill` trả gói hợp lệ | `trial` |
| `composing` | gói không qua kiểm lược đồ sau 1 lần thử lại | `stopped` kèm lỗi (ghi `meta`) |
| `trial` | `chay-thu` xong mọi mẫu | `grading` |
| `grading` | điểm >= điểm đạt | `passed` rồi `awaiting_approval` |
| `grading` | điểm < điểm đạt, hai vòng liền không tăng | `stalled` |
| `grading` | điểm < điểm đạt, đủ số vòng tối đa | `failed_max_rounds` |
| `grading` | điểm < điểm đạt, còn vòng | `composing` (vòng n+1) |
| mọi trạng thái đang chạy | tổng chi phí >= trần, kiểm trước mỗi bước | `cost_cap` |
| mọi trạng thái đang chạy hoặc chờ | người dùng bấm dừng | `stopped` |
| `awaiting_approval` | người dùng duyệt | giữ `awaiting_approval`, ghi `approvedAt` |
| `awaiting_approval` | người dùng từ chối | `stopped` |
| `stalled`, `failed_max_rounds`, `cost_cap`, `stopped` | người dùng bấm tiếp tục (có thể nâng trần/vòng) | `composing` hoặc `interviewing` tùy dữ liệu đã có |

Thứ tự kiểm điều kiện sau `grading`: đạt điểm trước, rồi `stalled`, rồi `failed_max_rounds`, rồi mới sang vòng mới. "Hai vòng liền không tăng" tính khi điểm vòng n và vòng n-1 đều <= điểm tốt nhất của các vòng trước chúng.

### 4.5 Một vòng cụ thể

- Vòng 1: `phan-tich-mau` (một lần, ở đầu) -> `soan-skill` -> `chay-thu` (mỗi mẫu một bước hoặc gộp theo lô) -> đo `code` -> `cham-diem` -> `phan-bien`.
- Vòng n+1: `soan-skill` nhận skill hiện tại, `critique` của vòng trước và điểm từng tiêu chí (không có mẫu holdout), rồi lặp như trên.
- Số lượt tối đa mỗi vòng cố định (cỡ 4 đến 8 run con); tổng số run của một skill bị chặn bởi số vòng x số bước và bởi trần chi phí.

### 4.6 Khởi động lại server

- Trạng thái bền nằm ở `meta.json` và `rounds.json` (ghi nguyên tử, mục 2.1); bộ nhớ chỉ là bản sao.
- Khi server khởi động, bộ điều phối quét `data/skills/` và với skill ở trạng thái đang chạy (`interviewing`, `composing`, `trial`, `grading`) tìm bước dở dang trong `rounds.json` (bước không có `ok`, run con có thể đã bị `subagent_interrupted` hoặc mất cùng server).
- Mặc định (tránh tốn hạn mức ngoài ý muốn): skill đang chạy dở chuyển sang `stopped` kèm ghi chú "bị ngắt khi khởi động lại"; không tự chạy lại.
- Khi người dùng bấm tiếp tục (hoặc khi cấu hình bật tự khôi phục), bước dở dang chạy lại từ đầu bước đó bằng run con mới; các bước đã ghi `ok` không chạy lại. Chi phí của run bị cắt vẫn giữ trong tổng.
- Trạng thái chờ (`awaiting_user`, `awaiting_approval`) và trạng thái cuối giữ nguyên, không tự chạy.

## 5. Sáu vai

Cấu hình vai nằm ở `config/roles-skill-workshop.json` (mục 7), cùng định dạng `--agents` như `roles-research.json` (không có khóa lạ như `$comment`). Mỗi bước là một run `research` riêng của một vai (mục 4.1).

| Vai | Nhiệm vụ | Đầu vào | Đầu ra (khối JSON) | Công cụ |
| --- | --- | --- | --- | --- |
| `phong-van` | Hỏi làm rõ nhu cầu: đối tượng dùng, đầu vào, đầu ra, quy tắc cứng, ví dụ tốt/xấu | `goal`, câu trả lời đã có, `rules.md` hiện tại | `{ "done": bool, "questions": [string], "rules": [string] }` | Read |
| `phan-tich-mau` | Rút đặc điểm chung từ mẫu `train`, đề xuất `inputs.json` và rubric nháp | mẫu `train`, `goal` | `{ "inputs": {...}, "rubric": {...}, "notes": string }` | Read, Grep, Glob |
| `soan-skill` | Soạn hoặc sửa gói: `SKILL.md`, `rules.md`, script, ví dụ | `goal`, `inputs.json`, `rules.md`, mẫu `train`, skill hiện tại, `critique` và điểm từng tiêu chí của vòng trước | `{ "files": [{ "path": string, "content": string }] }` | Read |
| `chay-thu` | Đóng vai người dùng skill: làm theo nội dung `SKILL.md` nhúng trong prompt trên một mẫu (mục 6) | nội dung `SKILL.md`, một mẫu (`input`) | `{ "output": string }` | không có công cụ ngoài Read |
| `cham-diem` | Chấm các tiêu chí `kind = "ai"` | rubric (chỉ tiêu chí `ai`), `input`, `output` của lượt chạy thử, `expected` nếu có | `{ "scores": [{ "id": string, "ratio": number, "reason": string }] }` | Read |
| `phan-bien` | Tìm điểm yếu, đề xuất sửa cụ thể cho vòng sau | điểm từng tiêu chí, lý do chấm, `SKILL.md` hiện tại | `{ "critique": string, "fixes": [string] }` | Read |

### 5.1 Quyền công cụ (không Bash)

- Không vai nào có Bash. Tập công cụ nằm trong `SAFE_AGENT_TOOLS` của `src/core/run/extras.ts` (`Read`, `Grep`, `Glob`, `Edit`, `Write`, `WebSearch`, `WebFetch`); vai workshop chỉ dùng tập con nhỏ nhất như bảng trên. `validateExtraAgents` là mẫu kiểm tra: tên công cụ lạ, `Bash` hoặc `*` bị từ chối. Cấu hình vai workshop đi qua cùng kiểm tra này khi nạp.
- Không vai nào có `Write`/`Edit`: `soan-skill` trả nội dung file trong JSON, chính `skill-pack.ts` ghi vào gói (đã qua kiểm đường dẫn, giới hạn và ghi nguyên tử ở mục 2). Nhờ vậy agent không chạm trực tiếp vào hệ thống file.
- Không vai nào có `WebSearch`/`WebFetch` mặc định. Nội dung mẫu và nội dung lấy từ web là dữ liệu không tin cậy: vai không làm theo chỉ dẫn nằm trong đó (quy tắc cứng 11 của CLAUDE.md).

### 5.2 Vai chấm độc lập với vai soạn

- `cham-diem` chạy ở run riêng, prompt riêng, không dùng chung phiên với `soan-skill`. Nó không thấy lịch sử soạn, không thấy `critique` hay lý do sửa; chỉ thấy rubric, đầu vào, đầu ra của lượt chạy thử và `expected`.
- `cham-diem` không thấy `SKILL.md`, để chấm theo kết quả chứ không theo ý định của người soạn.
- `phan-bien` thấy điểm và lý do chấm nhưng không thấy mẫu `holdout` cụ thể (mục 3.1); phần nó trả về là thứ duy nhất đi sang vòng soạn kế tiếp cùng điểm từng tiêu chí.
- Nên đặt `model` của `cham-diem` khác hoặc cùng mức nhưng prompt hệ thống riêng; không bắt buộc khác model, nhưng bắt buộc khác run và khác ngữ cảnh.

### 5.3 Trả JSON và kiểm lược đồ

- Mỗi vai kết thúc bằng đúng một khối mã ```json ... ``` chứa đối tượng theo bảng trên. Controller lấy khối ```json cuối cùng trong kết quả của run, `JSON.parse`, rồi kiểm lược đồ bằng mã (kiểu, khóa bắt buộc, giới hạn của mục 2.2, `ratio` trong [0, 1], `id` tiêu chí phải có trong rubric).
- Sai (không có khối, JSON hỏng, sai lược đồ): thử lại tối đa 1 lần bằng run mới, prompt nêu lỗi cụ thể bằng tiếng Việt và nhắc định dạng. Vẫn sai: bước ghi `ok: false` trong `rounds.json` rồi chuyển `stopped` kèm lỗi (khớp bảng ở mục 4.4). Chi phí cả hai run đều được cộng vào tổng.
- Khóa lạ trong JSON bị bỏ qua. Mọi đường dẫn trong `files[].path` đi qua kiểm path traversal ở mục 2.1; đường dẫn ngoài tập cho phép (`SKILL.md`, `rules.md`, `inputs.json`, `eval/rubric.json`, `scripts/*`, `examples/train-*.json`) bị từ chối. `soan-skill` không được ghi `meta.json`, `rounds.json` hay `examples/holdout-*`.
- Controller (không phải agent) quyết định `ok`, điểm, và bước kế tiếp.

### 5.4 Nhãn và hiển thị vai

- Thêm tên tiếng Việt cho sáu khóa vai vào `ui/src/roleLabel.ts`.
- `LOOK_KEYS` trong `ui/src/office/city-sim.ts` hiện là: `analyst`, `planner`, `critic`, `implementer`, `qa`, `debug`, `searcher`, `analyzer`, `synthesizer`, `writer`, `editor`, `seo`, `coordinator`. Sáu khóa vai workshop chưa có trong danh sách này; khi làm mã chọn một trong hai: thêm sáu khóa vào `LOOK_KEYS` (kèm kiểu dáng nhân vật tương ứng), hoặc ánh xạ sang khóa có sẵn (ví dụ `phong-van` -> `analyst`, `soan-skill` -> `writer`, `chay-thu` -> `implementer`, `cham-diem` -> `qa`, `phan-bien` -> `critic`, `phan-tich-mau` -> `analyzer`). Đề xuất: ánh xạ, vì `LOOK_KEYS` còn được dùng để chọn ngẫu nhiên khách đi bộ ở `createSim`; thêm khóa mới sẽ làm đổi cả khách đi bộ của mọi tòa.

## 6. Chạy thử không dựa vào Skill(<tên>)

- Chưa kiểm chứng: `Skill(<tên>)` có nạp được skill khi chạy với `--setting-sources project` hay không (đã ghi ở SPEC §4.2b và HANDOVER). Xưởng skill không phụ thuộc vào điều này.
- Vai `chay-thu` nhận nội dung `SKILL.md` (bỏ frontmatter hoặc giữ nguyên, nhưng luôn đặt trong khối dữ liệu có rào rõ ràng) cùng `rules.md` ngay trong prompt, kèm đúng một mẫu `input`. Prompt dặn: làm theo skill như hướng dẫn, trả `output` trong khối ```json. Không thêm `Skill(<tên>)` vào `--allowedTools`, không đăng ký skill vào thư mục skill của Claude Code.
- Giới hạn nhúng: `SKILL.md` < 64 KB (mục 2.2) nhưng phần nhúng vào prompt cắt ở 48 KB cộng `rules.md` <= 16 KB; quá giới hạn thì lỗi 400 ở bước soạn (không cắt im lặng, vì cắt làm đổi hành vi skill so với bản được chấm). Mẫu nhúng một lần một mẫu để giảm ngữ cảnh.
- Mỗi lượt chạy thử là một run riêng, nên không có trạng thái chung giữa các mẫu; điều này làm điểm tái lập được hơn.
- Script trong `scripts/` không được chạy trong `chay-thu` (không Bash). Phần kiểm định bằng script nếu cần do controller chạy theo mục 2.4.
- Sau khi người dùng duyệt, việc cài skill vào nơi Claude Code đọc (ví dụ `.claude/skills/`) là bước riêng, ngoài phạm vi tài liệu này; khi đó mới cần kiểm chứng `Skill(<tên>)`.

## 7. API, giao diện, bản đồ file module

### 7.1 API `/api/skills/...`

- Mọi API cần token và kiểm `Origin`/`Host` như các API hiện có (quy tắc cứng 5, `src/server/auth.ts`); route đặt trong `src/server/http.ts`. Body JSON UTF-8. Lỗi trả `{ "error": "<tiếng Việt>" }`.
- Mã lỗi: 400 dữ liệu sai (slug sai `ID_RE`, vượt giới hạn mục 2.2, rubric lệch trọng số, JSON sai lược đồ); 404 không có skill; 409 trạng thái không cho phép thao tác (ví dụ bắt đầu khi đang `composing`, duyệt khi chưa `awaiting_approval`, tạo trùng slug); 401/403 theo `auth.ts`.

| Phương thức và đường dẫn | Việc | Body / kết quả |
| --- | --- | --- |
| `GET /api/skills` | Liệt kê skill (slug, title, state, bestScore, round, costUsdEstimate) | mảng tóm tắt từ `meta.json` |
| `POST /api/skills` | Tạo skill, trạng thái `idle` | `{ slug?, title, goal, config? }` -> 201 `meta`; thiếu slug thì sinh từ `title` qua `normalizeName`; trùng slug -> 409 |
| `GET /api/skills/:slug` | Chi tiết: `meta`, `inputs`, `rubric`, danh sách file, tóm tắt vòng | không trả mẫu `holdout` |
| `POST /api/skills/:slug/start` | Bắt đầu hoặc tiếp tục huấn luyện (từ `idle` hoặc trạng thái cuối) | `{ passScore?, maxRounds?, costCapUsd? }` -> 202 `meta` |
| `POST /api/skills/:slug/answer` | Trả lời phỏng vấn / bổ sung mẫu khi `awaiting_user` | `{ answers?: [{question, answer}], examples?: [{ kind: "train"\|"holdout", input, expected? }] }`; 409 nếu không ở `awaiting_user` |
| `GET /api/skills/:slug/rounds` | Trạng thái và các vòng (điểm, tiêu chí, bước, chi phí) | nội dung `rounds.json` đã rút gọn |
| `GET /api/skills/:slug/questions` | Câu hỏi phỏng vấn đang chờ | `{ questions: [string] }` |
| `POST /api/skills/:slug/stop` | Dừng -> `stopped` | 200 `meta`; chạy run con thì hủy run đó như `cancel` hiện có |
| `POST /api/skills/:slug/approve` | Duyệt lần cuối, ghi `approvedAt` | 409 nếu không `awaiting_approval` |
| `POST /api/skills/:slug/reject` | Từ chối -> `stopped` | 409 như trên |
| `GET /api/skills/:slug/download` | Tải zip gói skill (không gồm `holdout`, `rounds.json`) | `application/zip`, tên file `<slug>.zip` |

- Tiến độ thời gian thực: dùng lại kênh WS và thăm dò REST dự phòng đã có (trình duyệt nhúng không mở được WebSocket); UI thăm dò `GET /api/skills/:slug/rounds` mỗi 3 giây khi tầng đang chạy.
- Run con của workshop hiện trong Lịch sử như run `research` thường, dưới project nhãn `skill-workshop`.
- Không API nào nhận đường dẫn tệp tùy ý; tên file chỉ qua tập cho phép ở mục 5.3.

### 7.2 Giao diện

- Tòa "Huấn luyện AI": thêm chuỗi `"Huấn luyện AI"` vào mảng `ui.towers` trong `config/controller.json`. `ui.towers` hiện là `["TNF Tower", "Tower 2"]` (mảng chuỗi, chỉ có tên), nên tòa mới chỉ biết tên; kiểu tầng của tòa phải được nhận ra bằng mã UI (so tên với hằng số, hoặc khóa phụ khi làm mã), không do cấu hình quy định.
- Tầng = skill, không phải project. Các tầng project hiện do `projectsToFloors` trong `ui/src/office/floors.ts` tạo: tầng trệt `default` luôn đứng đầu, không xóa được và không tính vào `MAX_FLOORS`; sau đó giữ tối đa `MAX_FLOORS = 5` project thật; `canAddFloor(projectCount)` là `projectCount < MAX_FLOORS`.
- Quyết định: tầng skill KHÔNG tính vào `MAX_FLOORS = 5` của project. Lý do: `MAX_FLOORS` chỉ đếm project thật trong `projectsToFloors`, và tòa skill là tòa khác. Tòa skill có hằng số riêng `MAX_SKILL_FLOORS = 5` cùng hàm `skillsToFloors` và `canAddSkillFloor(skillCount)` đặt trong `floors.ts` (hoặc file mới `ui/src/office/skill-floors.ts`); không có tầng trệt mặc định (không có skill thì tòa trống, hiện nút Thêm tầng). Không sửa chữ ký `projectsToFloors`/`canAddFloor` hiện có để các test của chúng giữ nguyên.
- Kiểu tầng skill riêng: `SkillFloor = { id: slug; name: title; state; score: number; round: number; running: boolean; sub?: string }`; `running` đúng với `interviewing`, `composing`, `trial`, `grading`; `sub` hiển thị điểm kiểu "72/90 · vòng 2".
- Popup biểu mẫu tạo skill: mở bằng nút Thêm tầng của tòa skill (tương tự `pages/AddFloorForm.tsx`): tên (title), mục tiêu (goal), điểm đạt, số vòng tối đa, trần chi phí ước tính; gọi `POST /api/skills` rồi `POST /api/skills/:slug/start`. Chặn gửi khi thiếu trường; hiện lỗi tiếng Việt của API.
- Popup tầng (mở khi bấm tầng skill, dùng `components/Modal.tsx` và trạng thái popup `ui/src/lib/popup.ts`): trạng thái bằng chữ tiếng Việt, điểm tốt nhất và điểm từng tiêu chí, danh sách vòng, chi phí ước tính cộng dồn (luôn ghi "ước tính"), câu hỏi phỏng vấn kèm ô trả lời khi `awaiting_user`, nút Dừng (khi đang chạy hoặc chờ), nút Duyệt và Từ chối (khi `awaiting_approval`), nút Tiếp tục (trạng thái cuối), liên kết tải zip.
- Chuỗi i18n: thêm cả hai bộ khóa vi và en vào `ui/src/i18n.ts` (tên tòa, nhãn trạng thái 12 giá trị, nhãn nút, thông báo lỗi), tiếng Việt là mặc định.
- Bố cục phải đúng ở 375 px và ở khung >= 1280 px (bẫy đã gặp, CLAUDE.md).

### 7.3 Bản đồ file module sẽ tạo

- `src/core/skill-pack.ts`: đọc/ghi gói, lược đồ JSON, giới hạn, chống path traversal, ghi nguyên tử, zip. Test `tests/skill-pack.test.ts`.
- `src/core/skill-scorer.ts`: kiểm tra rubric, các phép đo `code`, công thức điểm, holdout. Test `tests/skill-scorer.test.ts`.
- `src/core/skill-workshop.ts`: bộ điều phối, máy trạng thái, cộng chi phí, khôi phục khi khởi động, parse khối JSON của vai. Test `tests/skill-workshop.test.ts`.
- `config/roles-skill-workshop.json` và nhãn trong `ui/src/roleLabel.ts`: sáu vai (mục 5). Test `tests/skill-roles.test.ts`.
- `src/server/http.ts`: các route mục 7.1. Test `tests/skill-api.test.ts`.
- `config/controller.json`: thêm `skillWorkshop` (mặc định mục 4.3) và `"Huấn luyện AI"` vào `ui.towers`.
- `ui/src/skillWorkshop.ts`: logic thuần (nhãn trạng thái, định dạng điểm, kiểu tầng skill); `ui/src/office/floors.ts` (hoặc `skill-floors.ts`): `MAX_SKILL_FLOORS`, `skillsToFloors`. Test `tests/skill-floors.test.ts`, `tests/skill-workshop-ui.test.ts`.
- `ui/src/pages/SkillWorkshopForm.tsx` (popup biểu mẫu) và `ui/src/pages/SkillWorkshopFloor.tsx` (popup tầng); nối vào `office/CityScene.tsx`/`office/OfficeShell.tsx` và `ui/src/i18n.ts`.
- Test dùng `TNF_FAKE_CLAUDE=1` và fixture giả, không gọi Claude thật; chi tiết từng task ở mục 8.

## 8. Chia task (Lệnh 2 đến Lệnh 10)

Chín task dưới đây khớp lệnh 2 đến lệnh 10 của người dùng, theo thứ tự phụ thuộc. Mỗi task đủ nhỏ cho một lượt implementer (không quá 6 phút), commit ngay khi test nhắm đích qua; không task nào gọi Claude thật (dùng `TNF_FAKE_CLAUDE=1` và fixture giả). Toàn bộ `npm test`, typecheck, build UI để qa.

### Task 1 (Lệnh 2): Gói skill, lược đồ và I/O an toàn

- File: tạo `src/core/skill-pack.ts`, `tests/skill-pack.test.ts`.
- Tiêu chí xong: đọc/ghi đủ các file mục 2 (SKILL.md, inputs.json, rules.md, scripts/, examples/, eval/rubric.json, meta.json, rounds.json); kiểm lược đồ và giới hạn kích thước mục 2.2; slug theo `ID_RE` qua `normalizeName`; chống path traversal bằng `path.resolve` + `realpath` (từ chối `..`, symlink, đường dẫn tuyệt đối); ghi nguyên tử tmp + rename; zip gói không gồm holdout và rounds.json.
- Test offline: `npx vitest run tests/skill-pack.test.ts` (thư mục tạm, không cần server, không gọi Claude).

### Task 2 (Lệnh 3): Rubric và bộ chấm phần code

- File: tạo `src/core/skill-scorer.ts`, `tests/skill-scorer.test.ts`.
- Tiêu chí xong: kiểm rubric (trọng số tổng 100, phần `code` >= 60%, kind `code` hoặc `ai`); các phép đo `code` chạy bằng mã controller; công thức điểm tổng và làm tròn mục 3; tách mẫu train và holdout, vòng soạn không thấy holdout; trộn điểm `ai` từ JSON do vai chấm đưa vào.
- Test offline: `npx vitest run tests/skill-scorer.test.ts` (rubric mẫu, đầu ra giả, không gọi Claude).

### Task 3 (Lệnh 4): Máy trạng thái và vòng lặp với run giả

- File: tạo `src/core/skill-workshop.ts`, `tests/skill-workshop.test.ts`; thêm khóa `skillWorkshop` vào `config/controller.json` và đọc ở `src/core/app/config.ts`.
- Tiêu chí xong: đủ 12 trạng thái (idle, interviewing, awaiting_user, composing, trial, grading, passed, awaiting_approval, failed_max_rounds, stalled, cost_cap, stopped) và bảng chuyển mục 4; mặc định điểm đạt 90, tối đa 5 vòng, dừng khi 2 vòng liền không tăng, trần chi phí ước tính, duyệt lần cuối; mỗi bước là một run riêng, vòng lặp nằm trong mã; cộng dồn `total_cost_usd`; khôi phục từ `rounds.json` khi khởi động lại; bộ chạy run được tiêm vào để thay bằng bản giả.
- Test offline: `npx vitest run tests/skill-workshop.test.ts` (bộ chạy run giả trả điểm theo kịch bản: đạt, hết vòng, đứng yên, vượt trần, dừng).

### Task 4 (Lệnh 5): Cấu hình sáu vai và parse JSON

- File: tạo `config/roles-skill-workshop.json`, `tests/skill-roles.test.ts`; sửa `src/core/skill-workshop.ts` (hàm parse khối json), `ui/src/roleLabel.ts`, `LOOK_KEYS` trong `ui/src/office/city-sim.ts`.
- Tiêu chí xong: sáu vai phong-van, phan-tich-mau, soan-skill, chay-thu, cham-diem, phan-bien; công cụ an toàn không Bash, qua được `validateExtraAgents`; file không có khóa lạ như `$comment`; parse khối ```json và kiểm lược đồ, sai thì thử lại tối đa 1 lần rồi báo lỗi; vai chấm không nhận lịch sử soạn.
- Test offline: `npx vitest run tests/skill-roles.test.ts` (đầu ra vai giả đúng và sai lược đồ).

### Task 5 (Lệnh 6): Chạy thử nhúng prompt và mẫu giữ lại

- File: sửa `src/core/skill-workshop.ts`, `src/core/skill-scorer.ts`; tạo `tests/skill-trial.test.ts`.
- Tiêu chí xong: bước `trial` nhúng nội dung SKILL.md và rules.md vào prompt, không dùng `Skill(<tên>)`; có trần kích thước nhúng (mục 6); chạy thử trên mẫu holdout, kết quả đưa vào chấm điểm; vai chấm chỉ thấy đầu ra và rubric.
- Test offline: `npx vitest run tests/skill-trial.test.ts` (kiểm prompt dựng ra có SKILL.md, không có `Skill(`, không lộ lịch sử soạn).

### Task 6 (Lệnh 7): API `/api/skills/...`

- File: sửa `src/server/http.ts`; tạo `tests/skill-api.test.ts`.
- Tiêu chí xong: đủ các route bảng 7.1 (liệt kê, tạo, chi tiết, start, answer, rounds, questions, stop, approve, reject, download); cần token và kiểm Origin/Host; mã 400/404/409 với thông báo tiếng Việt; không trả holdout; không API nhận đường dẫn tùy ý.
- Test offline: `npx vitest run tests/skill-api.test.ts` (server thử trong tiến trình, `TNF_FAKE_CLAUDE=1`, bộ điều phối giả).

### Task 7 (Lệnh 8): Giao diện tòa và tầng skill

- File: tạo `ui/src/skillWorkshop.ts`, `tests/skill-floors.test.ts`, `tests/skill-workshop-ui.test.ts`; sửa `ui/src/office/floors.ts` (hoặc tạo `ui/src/office/skill-floors.ts`), `office/CityScene.tsx`, `office/OfficeShell.tsx`, `config/controller.json` (`ui.towers`).
- Tiêu chí xong: tòa "Huấn luyện AI" trong `ui.towers`; `MAX_SKILL_FLOORS = 5`, `skillsToFloors`, `canAddSkillFloor`; kiểu `SkillFloor` và nhãn trạng thái 12 giá trị tiếng Việt; không đổi chữ ký `projectsToFloors`/`canAddFloor`, test cũ giữ nguyên.
- Test offline: `npx vitest run tests/skill-floors.test.ts tests/skill-workshop-ui.test.ts` (hàm thuần, không dựng trình duyệt).

### Task 8 (Lệnh 9): Popup biểu mẫu và popup tầng

- File: tạo `ui/src/pages/SkillWorkshopForm.tsx`, `ui/src/pages/SkillWorkshopFloor.tsx`; sửa `ui/src/i18n.ts`, `ui/src/lib/popup.ts`; thêm test logic vào `tests/skill-workshop-ui.test.ts`.
- Tiêu chí xong: biểu mẫu tạo skill gọi `POST /api/skills` rồi `start`, chặn gửi khi thiếu trường, hiện lỗi API; popup tầng hiện trạng thái, điểm, vòng, chi phí ước tính, câu hỏi phỏng vấn, nút Dừng/Duyệt/Từ chối/Tiếp tục, liên kết tải zip; thăm dò 3 giây; khóa i18n đủ vi và en; bố cục đúng ở 375 px và khung >= 1280 px.
- Test offline: `npx vitest run tests/skill-workshop-ui.test.ts` (logic thuần và khóa i18n); qa chạy `npm run typecheck` và `npm run build:ui`.

### Task 9 (Lệnh 10): Nghiệm thu offline end-to-end và ghi nhật ký

- File: tạo `tests/skill-e2e.test.ts` và fixture giả dưới `fixtures/` nếu cần; sửa `docs/PROGRESS.md`, `docs/HANDOVER.md`.
- Tiêu chí xong: kịch bản demo chạy trọn vòng từ tạo skill, phỏng vấn, soạn, chạy thử, chấm đến `awaiting_approval` rồi duyệt, bằng CLI giả; đủ nhánh `failed_max_rounds`, `stalled`, `cost_cap`, `stopped`; ảnh màn hình ở 375 px và >= 1280 px; ghi bằng chứng lệnh và kết quả vào PROGRESS.
- Test offline: `npx vitest run tests/skill-e2e.test.ts --maxWorkers=1 --testTimeout=120000` rồi qa chạy toàn bộ `npm test`, `npm run typecheck`, `npm run build:ui`.
