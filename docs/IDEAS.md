# IDEAS — đề xuất tính năng mới (2026-10-27)

## 1. Tổng quan

Nguồn: đề xuất chỉ dựa trên repo, không có tìm web (README, `docs/HANDOVER.md`, đầu `docs/PROGRESS.md`, mục lục `docs/CONTEXT-SPEC-v1.md`, cấu trúc `src/` và `ui/src/`).

Phạm vi: tính năng giúp người dùng không chuyên kỹ thuật (Kinh Doanh TNF) tin cậy và tiết kiệm công khi dùng app hằng ngày. Không liệt kê lại cái đã có (một màn hình, văn phòng isometric, thư viện vai, lịch sử có bảng chi phí theo ngày, ngân sách mỗi run, nút dọn worktree từng run, phát hành thủ công, điện thoại qua Tailscale).

Ràng buộc từ CLAUDE.md, mọi đề xuất đều tuân thủ: không hook toàn cục, không sửa `~/.claude/settings.json`, không `--bare`, không `bypassPermissions`, không API key, không dịch vụ trả phí (không dùng push server hay SMS bên thứ ba), chỉ bind `127.0.0.1`, chi phí luôn ghi là ước tính. Cách kiểm thử luôn dùng `TNF_FAKE_CLAUDE=1` và các stream trong `fixtures/`.

Ghi chú về "Đã kiểm": mỗi tính năng đã được Grep (không phân biệt hoa thường) trong `src/`, `ui/src/`, README, PROGRESS trước khi đề xuất; kết quả ghi ngay dòng cuối mỗi mục. Chưa có file test nào cho các tính năng mới này; mọi test gọi là "test mới đề xuất" sẽ được viết khi làm.

## 2. Đề xuất

### 2.1 Thông báo khi run xong hoặc cần người
- **Vấn đề**: run coding kéo dài vài chục phút; người dùng phải canh màn hình hoặc điện thoại để biết xong, lỗi hay dừng giữa chừng.
- **Mô tả**: dùng Notification API của trình duyệt (không cần dịch vụ ngoài) và đổi tiêu đề tab ("Xong: <tên project>") khi run chuyển sang trạng thái kết thúc (xong, lỗi, bị cắt, cần commit). Có công tắc bật/tắt ở Cài đặt, nhớ qua `ui/src/lib/prefs.ts`. Chỉ hoạt động khi trang đang mở (ghi rõ trên UI, không hứa gửi khi đóng tab).
- **File/module**: `ui/src/notify.ts` (mới, hàm thuần quyết định có thông báo hay không), `ui/src/App.tsx` hoặc `ui/src/office/useProjectRun.ts` (nơi đã theo dõi run), `ui/src/pages/SettingsPanel.tsx`, `ui/src/lib/prefs.ts`, `ui/src/i18n.ts`.
- **Độ khó**: S
- **Rủi ro**: iPhone chỉ cho Notification khi cài như web app; quyền thông báo có thể bị từ chối; thông báo lặp lại khi WS và thăm dò REST cùng báo (cần khử trùng theo run id + trạng thái).
- **Kiểm thử offline (demo)**: `TNF_FAKE_CLAUDE=1` với `fixtures/hello.stream.jsonl` để một run kết thúc; test vitest mới đề xuất `tests/notify.test.ts` cho hàm thuần (chuyển trạng thái chạy→xong thì thông báo đúng một lần, chạy→chạy thì không); mẫu cách test tùy chọn bền ở `tests/prefs.test.ts`.
- **Công sức ước lượng**: khoảng 1 run, 2 task (hàm thuần + test, rồi nối UI và cài đặt).
- **Giá trị**: cao cho người dùng điện thoại và người làm việc khác trong lúc chờ.
Đã kiểm: `Notification\(|notify|toast` (không phân biệt hoa thường) trong `ui/src` → 0 kết quả; README không có "notification" → chưa có; `ui/src/lib/prefs.ts` và `tests/prefs.test.ts` có thật.

### 2.2 Bảng gỡ rối: dịch lỗi và trạng thái dở dang thành hướng dẫn tiếng Việt
- **Vấn đề**: khi run bị cắt, hết lượt, vượt ngân sách hay lỗi git, người dùng thấy mã/thông báo kỹ thuật và không biết bấm gì tiếp (chạy lại, tiếp tục, đổi ngân sách, hay gọi người hỗ trợ).
- **Mô tả**: một bảng ánh xạ thuần (mã lỗi/loại sự kiện → câu tiếng Việt + nút gợi ý như "Tiếp tục bằng follow-up", "Tăng ngân sách rồi chạy lại", "Mở thư mục run"). Hiện ở đầu trang Lần chạy khi run không thành công. Các loại: `subagent_interrupted`, `api.retry`, hết `max_turns`, vượt `budget_usd`, chưa đăng nhập Claude, worktree không còn, commit thất bại.
- **File/module**: `ui/src/run/runHints.ts` (mới, hàm thuần), `ui/src/pages/RunPage.tsx`, `ui/src/i18n.ts`, tùy chọn tái dùng nút ở `ui/src/run/runActions.ts`; nguồn mã lỗi ở `src/core/run/stream-parser.ts` và `src/core/run/events.ts` (chỉ đọc, không đổi).
- **Độ khó**: S
- **Rủi ro**: gợi ý sai làm người dùng chạy lại tốn hạn mức; cần mỗi gợi ý ghi rõ ảnh hưởng chi phí; mã lỗi mới của Claude Code chưa có trong bảng phải rơi về thông báo chung.
- **Kiểm thử offline (demo)**: `FAKE_CLAUDE_FIXTURE=fixtures/interrupted-subagent.stream.jsonl` với `TNF_FAKE_CLAUDE=1` tạo đúng trường hợp bị cắt; `tests/stream-parser.test.ts` đã có ca cắt vai làm nền; test mới đề xuất `tests/run-hints.test.ts` (mỗi loại lỗi cho một gợi ý, mã lạ cho gợi ý chung).
- **Công sức ước lượng**: khoảng 1 run, 2 task.
- **Giá trị**: cao, giảm số lần phải hỏi người kỹ thuật.
Đã kiểm: `error_code|errorHint|failure|subagent_interrupted|budget_exceeded` trong `ui/src` → chỉ khớp tham số `max_turns`/`budget_usd` ở `ui/src/api.ts` và `CommandPage.tsx`, không có ánh xạ lỗi; `subagent_interrupted` chỉ nằm ở `src/core/run/stream-parser.ts:490` (phát hiện, chưa hướng dẫn).

### 2.3 Tóm tắt kết quả ba dòng ở đầu trang Lần chạy
- **Vấn đề**: người không chuyên phải đọc diff, test, verdict mới biết run đạt hay chưa và đã đổi gì.
- **Mô tả**: khung "Kết quả" dựng tất định (không gọi thêm model, không tốn hạn mức) từ dữ liệu đã có: verdict qa, số commit, số file đổi, trạng thái test, chi phí ước tính, thời gian. Ví dụ "Đạt. 2 commit, 4 file đổi, test qua. Chi phí ước tính khoảng 0,41 USD". Kèm nút chính tiếp theo (Commit vào main hoặc Mở diff).
- **File/module**: `ui/src/run/runSummary.ts` (mới, hàm thuần), `ui/src/pages/RunPage.tsx`, `ui/src/components/run/Verdict.tsx`, `ui/src/i18n.ts`; dữ liệu từ `GET /api/runs/:id` (`verdicts`, `commits`, `changed_files`).
- **Độ khó**: S
- **Rủi ro**: tóm tắt tất định có thể gây hiểu nhầm nếu verdict thiếu hoặc nhiều verdict mâu thuẫn; phải hiện rõ "chưa có verdict" thay vì đoán; cách nói chi phí phải kèm chữ "ước tính".
- **Kiểm thử offline (demo)**: `TNF_FAKE_CLAUDE=1` với `FAKE_CLAUDE_FIXTURE=fixtures/real-coding-pass.stream.jsonl` và `FAKE_CLAUDE_GIT_COMMIT=1`; test mới đề xuất `tests/run-summary.test.ts`; dữ liệu mẫu thật có ở `tests/real-coding.test.ts`.
- **Công sức ước lượng**: khoảng 1 run, 2 task.
- **Giá trị**: cao cho người dùng không đọc được diff.
Đã kiểm: `TL;DR|tóm tắt|summary` trong `ui/src` → chỉ khớp trường `summary` của sự kiện (`ui/src/types.ts`) và đoạn `stat.summary` ở `RunPage.tsx:373`, không có khung kết quả tổng hợp; đã có huy hiệu verdict (`ui/src/components/run/Verdict.tsx`) nên chỉ thiếu phần tổng hợp một câu.

### 2.4 Dọn hàng loạt worktree cũ
- **Trạng thái**: đang làm
- **Vấn đề**: mỗi run coding để lại worktree vài trăm MB (kể cả bản copy `node_modules`); đĩa đầy dần, và nút dọn hiện chỉ làm từng run một.
- **Mô tả**: lệnh `tnf cleanup [--older-than N] [--dry-run]` và nút "Dọn các run cũ" ở tab Môi trường/Cài đặt: liệt kê trước dung lượng và số run sẽ dọn, xác nhận hai bước, bỏ qua run đang chạy và run chưa gộp/chưa commit (chỉ cảnh báo). Dọn cả `inbox-staging` bỏ dở. Gỡ junction `node_modules` trước khi xóa.
- **File/module**: `src/core/run/run-manager.ts` (mở rộng quanh `cleanupWorktree`), `src/core/git/git.ts` (`removeWorktree`), `src/cli.ts`, `src/server/http.ts` (API mới), `ui/src/pages/SettingsPanel.tsx`, `ui/src/api.ts`, `src/core/run/inbox.ts` cho phần staging.
- **Độ khó**: M
- **Rủi ro**: xóa nhầm công việc chưa lưu (cần cờ bảo vệ run có thay đổi chưa commit); xóa junction sai cách có thể xóa `node_modules` của repo gốc; nhánh `tnf/<run-id>` còn lại phải được giữ.
- **Kiểm thử offline (demo)**: `TNF_FAKE_CLAUDE=1` + `FAKE_CLAUDE_GIT_COMMIT=1` tạo vài run rồi chạy `tnf cleanup --older-than 0 --dry-run`; mở rộng `tests/git.test.ts`, `tests/run-manager.test.ts` và `tests/cli.test.ts` (đã có), cộng test mới đề xuất cho trường hợp junction và run đang chạy.
- **Công sức ước lượng**: khoảng 2 run (lõi + CLI rồi API + UI).
- **Giá trị**: trung bình đến cao, nợ đã ghi ở `docs/HANDOVER.md` mục 4.3.
Đã kiểm: `cleanup|older-than|prune` trong `src/` → khớp `cleanup-worktree` ở `src/server/http.ts:465`, `cleanupWorktree` trong `run-manager.ts`, `removeWorktree` trong `git.ts`; không có lệnh `tnf cleanup` và không có dọn hàng loạt, nên chỉ đề xuất phần hàng loạt còn thiếu.

### 2.5 Ước tính chi phí trước khi chạy và cảnh báo ngưỡng theo ngày
- **Vấn đề**: người dùng chỉ biết chi phí sau khi chạy xong; ngân sách mỗi run đã có nhưng không có cảnh báo khi tổng ngày hoặc phần hạn mức thuê bao còn lại sắp hết.
- **Mô tả**: ở trang Lệnh, dựa trên chi phí ước tính của các run coding trước (trung vị và cao nhất từ SQLite) hiện "Thường tốn khoảng X đến Y USD (ước tính)". Cho đặt ngưỡng cảnh báo theo ngày trong `controller.json` (`ui`/`defaults`), vượt thì hiện cảnh báo vàng trước khi bấm Chạy (không chặn cứng, người dùng quyết). Hiện thêm `rate_limit` từ `/api/status` nếu có.
- **File/module**: `src/core/run/run-store.ts` (truy vấn thống kê), `src/server/http.ts` (mở rộng `/api/status` hoặc API mới), `src/core/app/config.ts`, `ui/src/pages/CommandPage.tsx`, `ui/src/components/LeftPanel.tsx`, `ui/src/i18n.ts`.
- **Độ khó**: S
- **Rủi ro**: mẫu nhỏ làm dải ước tính sai; số liệu hạn mức thuê bao không phải hóa đơn nên chữ "ước tính" bắt buộc (quy tắc cứng 9); không được gợi ý rằng có phí API.
- **Kiểm thử offline (demo)**: chạy vài run demo bằng `TNF_FAKE_CLAUDE=1` để có số liệu; mở rộng `tests/run-store.test.ts` (thống kê) và `tests/server.test.ts` (API); test mới đề xuất cho hàm tính dải.
- **Công sức ước lượng**: khoảng 1 run, 2 task.
- **Giá trị**: trung bình đến cao, giảm bất ngờ về hạn mức.
Đã kiểm: `budget|ngân sách|daily|hàng ngày|hạn mức` trong `ui/src` → ngân sách mỗi run ở `CommandPage.tsx:24,137,198`; bảng chi phí theo ngày ở `HistoryPage.tsx:15,61`; không có ngưỡng ngày, không có ước tính trước khi chạy, nên chỉ đề xuất hai phần còn thiếu đó.

### 2.6 Tự thử lại một lần khi vai bị cắt giữa chừng
- **Vấn đề**: một lượt gọi subagent bị Claude Code CLI dừng sau khoảng 10 phút (ghi ở CLAUDE.md 0.2.4); hiện run chỉ báo lỗi `subagent_interrupted`, người dùng phải tự tiếp tục.
- **Mô tả**: khi parser phát hiện `subagent_interrupted` và run còn trong trần `maxRoleCalls`, controller tự gửi một follow-up ngắn ("tiếp tục từ commit gần nhất, chỉ làm phần còn lại") đúng một lần, có công tắc trong Cài đặt (mặc định tắt) và hiện rõ trên dòng thời gian là "thử lại tự động 1/1". Không vượt ngân sách của run.
- **File/module**: `src/core/run/run-manager.ts` (vòng đời run, follow-up), `src/core/run/stream-parser.ts` (đã phát hiện), `src/core/app/config.ts` (khóa mới `defaults.coding.autoResume`), `config/coordinator-coding.md` (nếu cần câu nhắc), `ui/src/pages/SettingsPanel.tsx`.
- **Độ khó**: M
- **Rủi ro**: tốn thêm hạn mức nếu cứ bị cắt lại; vòng lặp vô hạn nếu không giới hạn đúng một lần; follow-up có thể lặp lại việc đã commit; phải chạy thật một lần mới biết follow-up có tiếp tục đúng, test offline chỉ kiểm điều kiện kích hoạt.
- **Kiểm thử offline (demo)**: `FAKE_CLAUDE_FIXTURE=fixtures/interrupted-subagent.stream.jsonl` với `TNF_FAKE_CLAUDE=1` cho lượt đầu và một fixture "pass" cho lượt hai; mở rộng `tests/run-manager.test.ts` và `tests/stream-parser.test.ts`; test mới đề xuất kiểm "chỉ thử lại đúng một lần".
- **Công sức ước lượng**: khoảng 2 run.
- **Giá trị**: cao về độ tin cậy, nhưng cần một lần chạy thật để kiểm.
Đã kiểm: `retry|subagent_interrupted` trong `src/` → `api.retry` (retry của chính CLI, chỉ hiển thị) ở `events.ts:54`, `stream-parser.ts:217`; `subagent_interrupted` ở `stream-parser.ts:490`; `config.ts:16` chỉ chừa dư lượt cho một lần retry. Chưa có tự thử lại ở tầng controller, nên đề xuất phần tự động đó.

### 2.7 Mẫu lệnh có ô điền
- **Vấn đề**: người dùng lặp lại các lệnh na ná nhau ("sửa lỗi trang X", "thêm cột Y vào bảng Z") và phải gõ lại cả câu; thư viện prompt hiện chỉ lưu văn bản cố định.
- **Mô tả**: mục thư viện loại prompt hỗ trợ cú pháp `{{tên_ô}}`; khi chọn mục, trang Lệnh hiện form các ô điền bằng tiếng Việt rồi ghép thành câu lệnh. Kèm vài mẫu dựng sẵn cho việc thường gặp.
- **File/module**: `src/core/roles/role-library.ts`, `ui/src/skills/library.ts` (logic thuần), `ui/src/components/skills/RunLibraryPicker.tsx`, `ui/src/pages/CommandPage.tsx`, `ui/src/pages/LibraryPage.tsx`, `ui/src/skills/useLibrary.ts`.
- **Độ khó**: M
- **Rủi ro**: dữ liệu `data/library/library.json` cũ phải tương thích (mục không có `{{}}` giữ nguyên); chống chèn thêm chỉ dẫn qua ô điền (giá trị chỉ là chuỗi văn bản, không thực thi); thêm trường vào lược đồ thư viện.
- **Kiểm thử offline (demo)**: hoàn toàn thuần, không cần model: mở rộng `tests/library-ui.test.ts` và `tests/role-library.test.ts` (đã có) cho phân tích ô và ghép câu; xem thêm bằng `TNF_FAKE_CLAUDE=1` với `fixtures/hello.stream.jsonl`.
- **Công sức ước lượng**: khoảng 2 run.
- **Giá trị**: trung bình.
Đã kiểm: `\{\{` trong `src/core/roles/role-library.ts` → 0 kết quả; `template|mẫu lệnh|rerun` trong `ui/src` chỉ khớp CSS (`styles.css`, `city.css`); thư viện prompt đã có nhưng chưa có biến, nên chỉ đề xuất phần ô điền.

### 2.8 Duyệt kế hoạch trước khi chạy ("xem trước, rồi mới làm")
- **Vấn đề**: run coding sửa mã thật; người không chuyên không muốn để agent chạy hết trước khi biết nó định làm gì, nhất là khi lệnh mơ hồ.
- **Mô tả**: tùy chọn "Chỉ lập kế hoạch" ở trang Lệnh: chạy riêng các vai analyst và planner (chỉ đọc, không Edit/Write/Bash ghi), hiện kế hoạch bằng tiếng Việt kèm ước tính chi phí; người dùng bấm "Đồng ý, làm tiếp" (tiếp bằng follow-up/resume cùng phiên) hoặc "Sửa lệnh". Không bao giờ tự thêm quyền.
- **File/module**: `src/core/run/run-manager.ts`, `src/core/run/permissions.ts`, `config/coordinator-coding.md` (nhánh plan-only), `src/server/http.ts` (cờ mới của `POST /api/runs`), `src/cli.ts`, `ui/src/pages/CommandPage.tsx`, `ui/src/pages/RunPage.tsx`, `ui/src/run/runKind.ts`.
- **Độ khó**: L
- **Rủi ro**: đụng vào vòng đời run và quyền công cụ (vùng nhạy cảm theo SPEC §4); resume sau khi duyệt chưa kiểm thật; test `tests/coding-prompts.test.ts` giữ nguyên văn nhiều câu quan trọng nên sửa prompt phải cập nhật test; nên chia thành hai run.
- **Kiểm thử offline (demo)**: `TNF_FAKE_CLAUDE=1` với `fixtures/real-coding.stream.jsonl` cắt đúng tại bước kế hoạch; mở rộng `tests/permissions.test.ts` (plan-only không có công cụ ghi), `tests/run-manager.test.ts`, `tests/coding-prompts.test.ts`; test mới đề xuất cho luồng duyệt.
- **Công sức ước lượng**: 3 đến 4 run.
- **Giá trị**: cao về an tâm, nhưng đắt và rủi ro hơn các mục trên.
Đã kiểm: `approval|duyệt|pause|tạm dừng|plan.?only|dry.?run|xem trước` trong `src/` → 1 kết quả duy nhất ở `src/cli.ts:369`, trùng chữ "trình duyệt" (không phải chế độ plan-only), nên chưa có luồng duyệt kế hoạch; `cancel` và `followup` đã có làm nền.

### 2.9 Hẹn giờ chạy lệnh định kỳ
- **Vấn đề**: việc lặp lại (kiểm tra build mỗi sáng, rà soát repo mỗi tuần) phải nhớ mở app và gõ lệnh.
- **Mô tả**: lịch đơn giản ("mỗi ngày lúc 08:00", "mỗi thứ Hai") lưu trong SQLite, bộ định giờ trong server (chỉ khi app đang chạy ở khay) tạo run bình thường qua cùng đường `POST /api/runs`. Quy tắc an toàn: mặc định chỉ loại research hoặc coding chỉ-đọc, giới hạn ngân sách thấp, tối đa 1 run định kỳ chạy cùng lúc, tự tắt lịch sau 3 lần lỗi liên tiếp, bỏ qua lần hẹn khi máy tắt (không chạy bù).
- **File/module**: `src/core/scheduler.ts` (mới), `src/core/run/run-store.ts` (bảng `schedules`), `src/core/run/run-manager.ts`, `src/server/http.ts`, `src/server/index.ts`, `src/cli.ts`, `ui/src/pages/SettingsPanel.tsx` hoặc trang mới trong modal.
- **Độ khó**: L
- **Rủi ro**: tiêu hạn mức thuê bao khi người dùng không để ý (cần trần ngày, kết hợp mục 2.5); run tự chạy không có người giám sát; lệch múi giờ; thêm bảng DB cần migration.
- **Kiểm thử offline (demo)**: hàm tính lần chạy kế tiếp là hàm thuần có đồng hồ giả; `TNF_FAKE_CLAUDE=1` với `fixtures/hello.stream.jsonl` để kích một lịch; mở rộng `tests/run-store.test.ts`, `tests/run-manager.test.ts`; test mới đề xuất `tests/scheduler.test.ts`.
- **Công sức ước lượng**: 3 đến 4 run.
- **Giá trị**: trung bình, hợp khi người dùng đã tin cậy app.
Đã kiểm: `schedul|cron|hẹn giờ|lịch chạy` trong `src/` → 0 kết quả; không có trong README hay PROGRESS.

## 3. Xếp hạng

Giá trị trên công sức, hạng 1 là nên làm trước.

| Hạng | Tính năng | Giá trị | Công sức | Ghi chú |
|---|---|---|---|---|
| 1 | 2.2 Bảng gỡ rối tiếng Việt | Cao | S | Thuần UI, không đụng quyền, giảm hỏi đáp |
| 2 | 2.1 Thông báo khi xong | Cao | S | Hàm thuần dễ test, đặc biệt hợp điện thoại |
| 3 | 2.3 Tóm tắt ba dòng | Cao | S | Dữ liệu đã có sẵn, không tốn hạn mức |
| 4 | 2.5 Ước tính chi phí và ngưỡng ngày | Trung bình đến cao | S | Cần truy vấn thống kê thêm |
| 5 | 2.4 Dọn hàng loạt worktree | Trung bình đến cao | M | Nợ đã ghi; cẩn thận junction |
| 6 | 2.6 Tự thử lại khi vai bị cắt | Cao | M | Cần một lần chạy thật để kiểm |
| 7 | 2.7 Mẫu lệnh có ô điền | Trung bình | M | Đổi lược đồ thư viện |
| 8 | 2.8 Duyệt kế hoạch trước khi chạy | Cao | L | Đụng quyền và vòng đời run |
| 9 | 2.9 Hẹn giờ chạy định kỳ | Trung bình | L | Nên làm sau 2.5 |

## 4. Ba việc nên làm trước

Cả ba thuộc nhóm hạng 1 đến 3 ở mục 3 (công sức S, giá trị cao), đều thuần UI/hàm thuần, kiểm được hoàn toàn offline. Mỗi câu lệnh làm được trong một run, chia tối đa 2 task mỗi lượt.

1. Bảng gỡ rối tiếng Việt (2.2). File chính: `ui/src/run/runHints.ts`, `ui/src/pages/RunPage.tsx`, `ui/src/i18n.ts`. Kiểm: `npx vitest run tests/run-hints.test.ts`, và chạy demo với `fixtures/interrupted-subagent.stream.jsonl`.

   > Thêm bảng gỡ rối vào trang Lần chạy. Task 1: tạo ui/src/run/runHints.ts là hàm thuần nhận trạng thái run và mã lỗi (subagent_interrupted, hết max_turns, vượt budget_usd, chưa đăng nhập Claude, worktree không còn, lỗi commit) rồi trả về một câu tiếng Việt kèm tên hành động gợi ý, mã lạ trả câu chung; viết tests/run-hints.test.ts. Task 2: hiển thị câu đó ở đầu ui/src/pages/RunPage.tsx khi run không thành công, thêm chữ vào ui/src/i18n.ts (vi và en), nút gợi ý dùng lại hành động follow-up hiện có, không đổi src/. Chỉ chạy test nhắm đích.

2. Thông báo khi run xong (2.1). File chính: `ui/src/notify.ts`, `ui/src/lib/prefs.ts`, `ui/src/pages/SettingsPanel.tsx`. Kiểm: `npx vitest run tests/notify.test.ts tests/prefs.test.ts`.

   > Thêm thông báo khi run xong bằng Notification API của trình duyệt, không dịch vụ ngoài. Task 1: tạo ui/src/notify.ts là hàm thuần quyết định có thông báo hay không khi trạng thái run đổi (chạy sang xong, lỗi hoặc bị cắt thì thông báo đúng một lần cho mỗi run id), viết tests/notify.test.ts. Task 2: nối vào nơi UI đã theo dõi run, đổi tiêu đề tab khi xong, thêm công tắc bật/tắt ở ui/src/pages/SettingsPanel.tsx lưu bằng ui/src/lib/prefs.ts, ghi chú trên UI rằng chỉ hoạt động khi trang đang mở. Không sửa src/, không hook.

3. Tóm tắt ba dòng ở đầu trang Lần chạy (2.3). File chính: `ui/src/run/runSummary.ts`, `ui/src/pages/RunPage.tsx`. Kiểm: `npx vitest run tests/run-summary.test.ts`, và demo `fixtures/real-coding-pass.stream.jsonl` với `FAKE_CLAUDE_GIT_COMMIT=1`.

   > Thêm khung "Kết quả" ở đầu trang Lần chạy, dựng bằng hàm thuần, không gọi thêm model. Task 1: tạo ui/src/run/runSummary.ts nhận verdict, số commit, số file đổi, trạng thái test, chi phí ước tính và thời gian rồi trả về tối đa ba câu tiếng Việt (nói rõ khi chưa có verdict, chi phí luôn kèm chữ ước tính); viết tests/run-summary.test.ts. Task 2: hiển thị khung đó trong ui/src/pages/RunPage.tsx phía trên các tab, thêm chữ vào ui/src/i18n.ts, không đổi src/. Chỉ chạy test nhắm đích.

## 5. Ngoài phạm vi / không đề xuất

- Gửi thông báo khi đã đóng trang qua push server, SMS, email hay chat bên thứ ba: cần dịch vụ ngoài hoặc trả phí, trái ràng buộc của dự án.
- Hook toàn cục của Claude Code hoặc sửa `~/.claude/settings.json` để bắt sự kiện: vi phạm quy tắc cứng 6.
- Chạy bằng API key hoặc đổi sang `--bare` / `bypassPermissions` để chạy nhanh hơn hay không bị hỏi quyền: vi phạm quy tắc cứng 1 và 2.
- Nhúng dịch vụ tính chi phí hay hóa đơn thật: chi phí luôn chỉ là ước tính theo quy tắc 9.
- Sao lưu và khôi phục `data/` bằng một nút, và tìm kiếm toàn văn qua mọi sự kiện run: có giá trị nhưng để vòng sau, chưa đủ cấp thiết so với chín mục trên.
- Cài lại claude-office hay nhúng mã AGPL hoặc mã không rõ giấy phép: bị cấm bởi quy tắc cứng 7.

## 6. Đề xuất tham khảo từ GitHub (2026-11-03)

Mục này chỉ ghi ý tưởng lấy cảm hứng từ các dự án mã nguồn mở; không chép mã từ các dự án nguồn.

### Đã chọn làm
- **(a) Dọn hàng loạt worktree**: chính là mục 2.4 (đang làm). Ý chung, có tham khảo cách vibe-kanban quản lý worktree.
- **(b) Hạn mức khung 5 giờ**: theo dõi mức dùng trong khung 5 giờ của thuê bao. Ý lấy từ ccusage. Liên quan sự kiện `rate_limit`, xem thêm 2.5.
- **Nguồn và giấy phép** (theo thông tin người dùng cung cấp, chưa đối chiếu file LICENSE):
  - ccusage: MIT, https://github.com/ryoppippi/ccusage
  - vibe-kanban: Apache-2.0, https://github.com/BloopAI/vibe-kanban

### Ý tưởng để sau
Cả hai lấy ý từ vibe-kanban, chưa lên lịch.
- Bảng kanban cho hàng đợi run.
- Xem trước dev server của worktree.
