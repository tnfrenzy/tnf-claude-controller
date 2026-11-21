# CONTEXT-SPEC v1 — TNF Controller cho LẬP TRÌNH

Soạn 2026-10-21. Thay thế `docs/CONTEXT-SPEC.md` (v0, kiến trúc 3 vai nghiên cứu web) cho mọi việc từ Phase 5 trở đi. v0 giữ nguyên làm lịch sử; các mục v0 còn hiệu lực được nhắc lại ở đây chứ không tham chiếu chéo. Nếu thực tế khác đặc tả: **thực tế thắng**, ghi vào `docs/SPIKE-RESULTS.md` rồi sửa file này.

Đầu vào của bản này: `docs/CONTEXT-CODING.md` (mục 3, 4, 7), kết quả spike S1–S3 (`docs/SPIKE-RESULTS.md`, 2026-10-21), quyết định người dùng cùng ngày.

---

## 1. Mục tiêu

Người dùng (Kinh Doanh TNF) gõ **một câu tiếng Việt** → controller chạy một phiên `claude -p` coordinator → coordinator giao việc cho các vai lập trình → agent **sửa code, chạy test, commit** trên **nhánh riêng trong worktree** của một repo thật → UI hiện tiến trình từng vai, **diff**, **kết quả test**, phán quyết review, token/chi phí ước tính → người dùng xem, rồi tự gộp nhánh.

Chỉ dùng hạn mức thuê bao claude.ai. Không API key. Không `--bare`. Không `bypassPermissions`.

**Ngoài phạm vi v1:** push lên remote; tự gộp vào nhánh chính; tạo PR; duyệt quyền tương tác giữa chừng; nhập lịch sử phiên Claude Code Desktop; tải lên cả thư mục; chạy trên VPS.

---

## 2. Quyết định đã chốt (bổ sung D1–D10 của v0)

| # | Quyết định | Căn cứ |
|---|---|---|
| D11 | **Project = repo đích**: đường dẫn tuyệt đối + nhánh gốc, lưu trong SQLite. Nhãn tự do cũ chuyển thành `name`. | CONTEXT-CODING 3D |
| D12 | **Mỗi run một worktree** tại `D:\tnf-claude-workspace\worktrees\<run-id>`, nhánh `tnf/<run-id>` tách từ nhánh gốc. cwd của agent = worktree. `runs/<run-id>` chỉ còn log/artifact. Không xóa worktree tự động. | Người dùng chọn "ngoài repo"; S3 |
| D13 | Agent **được `git commit`** trên nhánh worktree với identity do controller cấp (`GIT_AUTHOR_NAME=TNF Agent`, `agent@example.com`). **Cấm** push, cấm đụng nhánh gốc, cấm thao tác phá hủy. | Người dùng; S2, S3 |
| D14 | Quyền hai lớp: `--allowedTools` phiên chính = **hợp của mọi vai** (trần chung); `tools` trong `--agents` thu hẹp từng vai; **deny** qua file `--settings` (`config/deny-settings.json`) **và** `--disallowedTools` cho vài lệnh chí mạng. | S1b, S2, S2b |
| D15 | Bộ vai v1: **analyst, planner, critic, implementer, qa, debug**, rút từ ai-agents-main (MIT), mỗi prompt ≤ 3 KB, không `mcp__*`. Ba vai nghiên cứu web (searcher/analyzer/synthesizer) **giữ lại** dưới dạng bộ vai thứ hai `config/roles-research.json`, chọn theo loại run. | CONTEXT-CODING 4; người dùng hỏi về vai |
| D16 | UI trang Lần chạy thêm tab **Diff** và **Test**; panel **Môi trường** hiện repo, nhánh gốc, worktree, thư mục log; nút tải artifact. | Người dùng |
| D17 | Điều khiển từ điện thoại: giữ server trên máy Windows, bind `127.0.0.1`, mở qua **Tailscale Serve / Cloudflare Tunnel**; thêm `server.allowedOrigins`. Làm sau khi D16 xong. | Người dùng chọn hướng 3 |
| D18 | Tải lên file đính kèm lệnh (ảnh/md/txt/pdf ≤ 5 MB → `runs/<id>/inbox/`) làm cùng D17. **Không** tải lên/lưu thư mục. | Người dùng |
| D19 | Controller có thể lấy chính `D:\tnf-claude-controller` làm repo đích (tự sửa mình) nhờ worktree; quy tắc 10 của CLAUDE.md đổi thành: "CLAUDE.md của **repo đích** được nạp là điều mong muốn; CLAUDE.md của controller chỉ nạp khi repo đích là controller". | Người dùng |
| D20 | **Ngưỡng 200k token**: khi `usage` của phiên coordinator (cache_read + input + output của lượt gần nhất) vượt 200k, controller **tự** yêu cầu coordinator tóm tắt trạng thái (≤ 40 dòng: việc đã xong, commit, việc còn lại) rồi mở run mới trong **cùng worktree/nhánh** với tóm tắt làm prompt mở đầu (không `--resume`). Không hỏi người dùng; UI hiện mốc "đã chuyển phiên". | Người dùng 2026-10-21 |
| D21 | Nhiều run cùng project chạy **song song**, mỗi run một worktree; UI Văn phòng hiện tất cả. | Người dùng hỏi; thiết kế worktree |

---

## 3. Kiến trúc

```
 Trình duyệt (vi)  http://127.0.0.1:4800  (hoặc qua đường hầm Tailscale/Cloudflare — D17)
   Lệnh · Lần chạy (dòng thời gian · Báo cáo · Diff · Test · Môi trường) · Lịch sử · Văn phòng 2D
        │ REST + WS (token, Origin/Host)
 Controller (Node/TS)
   run-manager ──► git worktree add D:\tnf-claude-workspace\worktrees\<run-id> -b tnf/<run-id> <base>
        │           spawn claude -p (cwd = worktree, env: GIT_*; billing guard trước)
        │           --agents config/roles-coding.json  --append-system-prompt-file config/coordinator-coding.md
        │           --settings config/deny-settings.json  --disallowedTools "Bash(git push*)" ...
        │           --allowedTools <hợp của mọi vai>  --permission-mode dontAsk
        ▼
   coordinator ── Agent ──► analyst → planner → critic → implementer → qa → (debug → qa)
        │  stream-json ──► stream-parser ──► SQLite events + runs/<id>/stream.jsonl
        ▼
   post-run: git diff --stat / diff.patch (base..HEAD) · git status · test-result.txt · verdicts → artifacts
```

### 3.1 Thư mục của một run (hiện trên panel Môi trường)

| Thứ | Đường dẫn | Ai dùng |
|---|---|---|
| Repo đích | `<project.repo_path>` (ví dụ `D:\my-app`) | chỉ đọc bởi controller (`git worktree add`, `git diff`) |
| Worktree | `D:\tnf-claude-workspace\worktrees\<run-id>` | cwd của coordinator và mọi subagent |
| Nhánh | `tnf/<run-id>` từ `<project.base_branch>` (sha ghi lại) | agent commit vào đây |
| Thư mục run | `D:\tnf-claude-workspace\runs\<run-id>` | `notes/` (controller ghi **ngay khi nhận `task_notification`** của mỗi vai), `inbox/` (D18), artifact do controller sinh. Truyền đường dẫn tuyệt đối cho vai; ngoài ra ghi `notes/` vào `info/exclude` của worktree phòng vai tự ghi vào cwd |
| Stream/DB | `D:\tnf-claude-controller\data\runs\<run-id>\stream.jsonl`, `data\controller.db` | controller |

Follow-up (`--resume`) dùng lại cùng worktree và nhánh.

### 3.2 Vòng đời run

1. Kiểm `claude auth status`, dọn env (billing guard). Kiểm repo đích: tồn tại, là git, nhánh gốc có, cây **sạch hoặc không quan tâm** (worktree tách từ commit, không từ working tree).
2. `git worktree add`. Lỗi → run `error`, không spawn.
3. Spawn `claude -p` (cwd = worktree). Parse stream. Lưu sự kiện.
4. Khi tiến trình thoát: chạy trong worktree `git status --porcelain`, `git log --oneline <base>..HEAD`, `git diff --stat <base>..HEAD`, `git diff <base>..HEAD > diff.patch`; nếu có thay đổi chưa commit thì thêm `git diff > uncommitted.patch`. Lưu `test-result.txt` (xem 6.2). Parse verdict (5.4). Ghi artifact.
5. Run `done` / `error` / `cancelled`. Worktree **giữ nguyên** mọi trường hợp. Nút "Dọn worktree" trên UI xóa bằng tay (`git worktree remove` + `git branch -D` sau khi xác nhận; chỉ khi nhánh đã gộp hoặc người dùng xác nhận bỏ).

---

## 4. Quyền công cụ (B) và bảo vệ git (C)

### 4.1 Điều đã kiểm chứng (S1–S3)

- `--allowedTools` phiên chính là **trần chung**; vai khai `Edit` mà phiên chính không có → bị từ chối.
- Deny thắng allow: `Bash(git push*)` chặn được dù allow `Bash(git *)`, qua cả `--disallowedTools` lẫn `permissions.deny` trong file `--settings`, kể cả lệnh dạng `cd … && git push`.
- Lệnh Bash chỉ đọc (`cat`, `git status`, `git log`) được **tự cho phép** dưới `dontAsk` dù không nằm trong allowlist.
- Deny khớp **tiền tố lệnh**; chưa kiểm `git -C <dir> push`, `git -c k=v push`. Phải liệt kê tường minh (4.3) và kiểm ở S6.
- `result.permission_denials` bỏ sót từ chối Bash → controller dựa vào sự kiện `permission.denied` trong stream.
- (S6, S6c) `git -C … push`, `git -c … push`, `git reset --hard` bị chặn bởi deny v1; `Edit(<wt>/**)`/`Write(<wt>/**)` chặn ghi ngoài worktree, Read ngoài worktree vẫn được.
- (S4) `--setting-sources project` giảm cache_write từ 25,5k xuống 6,0k token (−72 % chi phí run rỗng) → mặc định bật cho run lập trình.
- (S5) Vai chỉ đọc không ghi được notes trong lúc run; implementer haiku bỏ dở sau một từ chối; file `--agents` không được có khóa lạ (`$comment`); `result.ok` không phản ánh việc xong.

### 4.2 Allowlist phiên chính (hợp của mọi vai)

```
Agent Read Grep Glob Edit Write
Bash(npm test*) Bash(npm run *) Bash(npx vitest*) Bash(npx tsc*) Bash(node *)
Bash(git add*) Bash(git commit*) Bash(git diff*) Bash(git status*) Bash(git log*) Bash(git show*) Bash(git branch --show-current*)
```

**Không** cấp `Bash(git *)`, `Bash(*)`, `WebFetch`, `WebSearch` cho bộ vai lập trình. Edit/Write giới hạn đường dẫn: `Edit(<worktree>/**)`, `Write(<worktree>/**)`, `Write(<run-dir>/notes/**)` (S6c đã kiểm, dùng dấu `/`). **Lệnh ghép**: CLI từ chối cả lệnh nếu một đoạn không khớp allowlist hoặc có mở rộng biến (`$VAR`, `$(…)`, ` Lệnh test/build của repo đích khác npm (ví dụ `pytest`, `dotnet test`) → thêm theo project (`project.allowed_commands`, mỗi mục là một mẫu `Bash(...)`), có kiểm tra không chứa `;`, `&&`, `|` ở phần cố định.

### 4.2b Agent và skill thêm theo run (bổ sung 2026-10-23)

- Input `POST /api/runs` thêm `agents` (đối tượng `{tên: {description, prompt, tools?, model?}}`, tối đa 5; tên `[a-z0-9-]{1,40}`, không trùng vai có sẵn; `tools` chỉ thuộc `Read Grep Glob Edit Write WebSearch WebFetch`, mặc định `Read Grep Glob`; **không** Bash, không `*`) và `skills` (mảng tên `[A-Za-z0-9:_-]`, tối đa 10). Hàm kiểm ở `src/core/run/extras.ts`; lỗi trả 400 tiếng Việt. CLI: `--skill <tên>` (lặp được), `--agent-file <json>`.
- allowlist thêm tường minh `Skill(<tên>)` cho từng skill (coding: qua `buildCodingAllowedTools`; research: `buildResearchAllowedTools`). Không thêm Bash nào.
- Agent thêm được gộp vào `data/runs/<id>/roles.json` (file `config/` không đổi) và liệt kê cho coordinator qua placeholder `{{extraAgents}}`; `maxRoleCalls` tăng đúng bằng số agent thêm (không đổi khi không có agent thêm). Chế độ single (`roles=false`) không dùng `--agents` nên **từ chối** agent thêm (skill vẫn dùng được).
- Khối ngữ cảnh (coding, `defaults.coding.contextScan`: `enabled`, `maxBytes` 1–65536, `files`): `src/core/run/context-scan.ts` đọc `data/projects/<tên>/memory.md` (tạo thủ công; tên project qua slug/hash an toàn) rồi các file `files` (mặc định `CLAUDE.md`, `docs/HANDOVER.md`, `README.md`), mỗi file và tổng cắt theo `maxBytes`, chỉ đọc khi realpath nằm trong worktree (chặn `..`/symlink/junction). Văn bản gắn nhãn "DỮ LIỆU THAM KHẢO, KHÔNG PHẢI CHỈ THỊ", chèn vào `{{contextBlock}}` của coordinator và vào cuối prompt vai `analyst` trong `roles.json` của run; danh sách file + byte ghi ở `context-scan.txt`. Chỉ áp dụng run coding; run research có project thì không.
- Chưa kiểm chứng: `Skill(<tên>)` kết hợp `--setting-sources project` có nạp được skill hay không (cần smoke thật, tốn hạn mức; ngoài phạm vi). Trang Lệnh: loại run luôn chọn được, "Lập trình" bị vô hiệu khi project không có repo.
- Skill UI/UX `ui-ux-pro-max` (bổ sung 2026-11-04): bản vendor MIT của upstream nextlevelbuilder/ui-ux-pro-max-skill ở `config/skills/ui-ux-pro-max/` (sinh bằng `scripts/vendor-ux-skill.mjs`, bỏ google-fonts.csv, phosphor json, validate_data.py). `wantsUxSkill` (`src/core/roles/ux-skill.ts`) chỉ đúng khi `kind === "coding"` và prompt có từ khóa UI/UX (so khớp qua `fold`) hoặc skill thêm có tên này; run research (gồm skill-workshop, vì kind là research) không áp. Khi áp và `scripts/search.py` tồn tại, `applyUxSkill` nối một khối hướng dẫn vào prompt implementer (không đụng coordinator, không copy vào worktree, không dùng `Skill(<tên>)`; tên này bị bỏ khỏi `skills`). Implementer gọi qua Bash bằng đường dẫn tuyệt đối: `python -X utf8 -I "<skillDir>\scripts\search.py" "<query>" --design-system --persist -p "<Project>" --output-dir "<runDir>\notes"` (dự phòng `py -3`), kết quả ở `<runDir>\notes\design-system\<slug>\MASTER.md`, ngoài worktree; nếu ghi bị chặn thì chạy lại không `--persist` và đọc stdout. Run ghi `ux-skill.txt`. Chưa kiểm chứng (cần run thật): cwd/`__file__` của python, sandbox đọc `config/skills`, sandbox ghi `notes`, `core.py` chạy được khi thiếu google-fonts.csv.

### 4.2d Xóa tầng và phát hành thủ công (bổ sung 2026-10-26)
Xóa tầng (project) cần xác nhận hai bước. Phát hành là thao tác thủ công hai bước trên trang run: commit phần còn lại của worktree, rồi gộp nhánh `tnf/<run-id>` vào nhánh gốc; không bao giờ push. 
- `DELETE /api/projects/:name`: chỉ xóa dòng project, lịch sử run giữ nguyên. Từ chối (400/404/409 kèm thông báo tiếng Việt) với `default`, tên không có, project đang có run hoạt động, hoặc còn run coding chưa xong/còn worktree trên đĩa (cần dọn hoặc phát hành trước). Mã: `RunManager.removeProject`.
- `POST /api/runs/:id/release`: chỉ run coding còn worktree. Kiểm trước khi đổi gì: worktree không bị run khác dùng, project còn repo, repo đích đang ở nhánh base và sạch. Rồi commit phần còn lại của worktree (`chore(tnf): finalize <id>`, loại `node_modules`) và `merge --no-ff tnf/<id>` vào base. Trả `{committed, merged, base, branch, commit}`. Không push, không tag, không checkout, không dọn worktree. Mã: `RunManager.releaseRun`.
- `POST /api/runs/:id/publish`: "Phát hành" run coding đã commit vào main. Kiểm trước khi sửa file: run xong, repo đích ở nhánh base và sạch, có `package.json` hợp lệ với `version` x.y.z, `tnf/<id>` đã gộp vào base (chưa gộp: HTTP 409 `not_merged`; lỗi khác: 400). Rồi nâng patch trong `package.json` (+ `package-lock.json`, cả gốc và `packages[""]`) giữ nguyên định dạng và commit `chore(release): <version>`. Trả `{ok, version, previous, commit}`. Không tag, không push, không npm. Mã: `RunManager.publishRun`, `src/core/app/publish.ts`.
- `GET /api/runs/:id` thêm `merged` (cả ở `run.merged` và cấp ngoài): tính tại chỗ bằng `git merge-base --is-ancestor tnf/<id> <base>` cho run coding có repo; không lưu DB; run research/thiếu repo thì không có trường.

Văn phòng isometric (`OfficeStage`) là màn hình chính, không còn popup. IsoScenery chưa đủ chi tiết thiết kế (cửa sổ tường phải/kệ, hơi cà phê, nội thất).

### 4.2c Thư viện vai/skill/prompt và danh mục vai (bổ sung 2026-10-26)

- Thư viện toàn cục `data/library/library.json` (`src/core/roles/role-library.ts`): vai (`id` `[a-z0-9-]{1,40}`, không trùng vai có sẵn, cùng kiểm tra công cụ như §4.2b: không Bash) tối đa 30; mục `skill|prompt` (tên ≤ 80, nội dung ≤ 64 KB, `roleIds` là vai có sẵn hoặc vai thư viện) tối đa 100. API `/api/library`, `/api/library/roles[/id]`, `/api/library/items[/id]` (lỗi tiếng Việt, mã 400/404/409).
- Nhập vai/skill từ file .md (`POST /api/library/import`): xem `docs/LIBRARY-IMPORT.md`.
- `POST /api/runs {libraryItemIds}`: nội dung mục nối vào prompt các vai được gắn (trong `roles.json` của run) hoặc vào prompt coordinator khi không gắn vai; vai thư viện được gắn kéo vào run như agent thêm (vẫn trần 5); vai có sẵn của loại run khác bị bỏ qua; tổng ≤ 64 KB. Không cấp quyền công cụ nào. Chế độ single từ chối. `library-items.txt` ghi mục đã dùng.
- Danh mục vai mẫu `config/roles-catalog.json` (23 vai, công cụ an toàn, có test mỗi vai hợp lệ và nhét vừa thư viện): `GET /api/role-catalog?q=` (tìm không phân biệt hoa thường và dấu, mọi từ phải khớp) trả `roles` và `in_library`; `POST /api/library/roles/from-catalog/<id>` sao chép vào thư viện (409 nếu đã có hoặc trùng vai có sẵn, 404 nếu không có id).
- Loại run không còn do client chọn: project có repo luôn `coding`, còn lại `research` (CLI `--kind` bị bỏ qua).
- UI: trang `Thư viện` (`ui/src/pages/LibraryPage.tsx`: CRUD vai và mục, tìm vai mới), mục thư viện ở trang Lệnh (`RunLibraryPicker`, `CatalogSearch`), logic thuần có test ở `ui/src/skills/library.ts`.

### 4.2d `node_modules` trong worktree (bổ sung 2026-10-26)

- Agent không được `npm install`, nên controller cấp sẵn `node_modules` của repo đích cho worktree (`src/core/git/node-modules.ts`, `provisionNodeModules`, gọi sau `createWorktree`, chỉ khi repo có thư mục này và git bỏ qua tên `node_modules`).
- **Mặc định là bản copy thật**, không phải junction: từ Bash/Node bị sandbox của subagent, đọc qua junction luôn lỗi `UNKNOWN (-4094)` (readdir, stat, realpath) trong khi đường dẫn thẳng vẫn đọc được, nên `vitest` không resolve được (run `20261026-090255-437781` dừng vì vậy; run 23/10 chỉ qua nhờ agent tự `cpSync`). Copy chạy trong tiến trình `node` con (`cpSync` nhanh gấp khoảng 2–4 lần `fs.promises.cp` trên Windows) nên không chặn server; repo này 106 MB, 3,3k file mất khoảng 38 giây (đo trên máy thật).
- Cấu hình `defaults.coding.nodeModules`: `mode` `copy` (mặc định) | `junction` (hành vi cũ) | `none`; `maxMb` 1–20000 (mặc định 600). Vượt trần, hoặc copy lỗi (dọn bản copy dở), thì dùng junction và ghi lý do. Kết quả mỗi run ghi ở `node-modules.txt`.
- Dọn worktree: `removeWorktree` gỡ junction trước (không bao giờ xóa thư mục gốc); bản copy là file thường nên `git worktree remove --force` tự xóa.

### 4.2e Hàng đợi lệnh và scout (bổ sung 2026-10-28)

Thiết kế đầy đủ ở `docs/PLANNER-QUEUE.md`; mục này chỉ tóm tắt hợp đồng.

- **Hàng đợi theo môi trường**: mỗi project có repo có một hàng đợi; tầng `default` không có. Người dùng đưa một ý tưởng, vai `idea-splitter` (Người chia ý tưởng) chia thành tối đa 20 lệnh. Mỗi lệnh là một run coding thường (worktree riêng, nhánh `tnf/<run-id>`).
- **Hợp đồng JSON** của idea-splitter: `{commands: [{id, title, body, files, dependsOn, parallelGroup?, verify, size 1|2, references?}]}`. `validateSplitterOutput` (`src/core/queue/queue-plan.ts`) kiểm lược đồ, giới hạn độ dài, khóa lạ, id trùng, vòng phụ thuộc, `size`, đường dẫn `files` an toàn; lỗi trả tiếng Việt. `references` (tối đa 5, chỉ `http`/`https`) là nơi duy nhất chứa thông tin từ web, tách khỏi `body`.
- **Từ chối và cảnh báo**: `body` chứa mẫu cấm (`git push`, `rm -rf`, `dangerously-skip-permissions`, `bypassPermissions`, khóa API) bị từ chối bằng so khớp chuỗi; `body` chứa URL hoặc lệnh tải về/cài toàn cục thì vào hàng đợi kèm cảnh báo, người dùng phải xác nhận đã xem.
- **Duyệt tay từng lệnh**: lệnh mới ở "chờ duyệt"; trạng thái: chờ duyệt, đã duyệt, đang chạy, đã commit, đã gộp, bỏ qua, lỗi. "Đã commit" (xong trên nhánh) khác "đã gộp" (đã nằm trong base). Không lệnh nào tự duyệt, tự chạy hay tự gộp.
- **Độc lập và song song**: hai lệnh độc lập khi không phụ thuộc bắc cầu, `files` không giao nhau và không chạm cùng điểm nóng (`queue.hotspots`, mặc định gồm `ui/src/i18n.ts`, `ui/src/api.ts`, `ui/src/types.ts`, `ui/src/App.tsx`, `src/server/http.ts`, `docs/PROGRESS.md`, `package.json`, `package-lock.json`). Controller tự tính đợt (batch) từ `files` và `dependsOn`, `parallelGroup` chỉ là gợi ý. Tối đa `queue.maxParallel` run cùng lúc (mặc định 2, kẹp 1 đến 3, tính trên mọi run coding đang chạy); giao diện cảnh báo máy tải và hạn mức cạn nhanh, hiển thị chi phí gộp **ước tính** của nhóm.
- **Gộp tuần tự**: dùng lại `mergeBranchNoFf` (`--no-ff`, tự `merge --abort` khi lỗi), do người dùng bấm, mỗi lúc một nhánh, kiểm khô bằng `git merge-tree --write-tree` trước; sau gộp chạy typecheck và test, hỏng thì dừng hàng đợi. Controller không tự giải xung đột, không push.
- **Đoạn quy ước chung** do controller chèn đầu prompt mỗi lệnh (không nằm trong `body`): đọc `CLAUDE.md`, test không gọi Claude thật, commit sau từng task, `knownEnvFailures`. Không cấp thêm quyền.
- **Trần chi phí hàng đợi** `queue.maxBudgetUsd` (dự kiến, cộng cả run lẫn replan); replan sau mỗi lệnh là tùy chọn pha 2, mặc định tắt.
- **Chạy idea-splitter**: vai chỉ `Read`, `Grep`, `Glob` (thêm `WebSearch`, `WebFetch` khi `queue.splitter.webSearch` và công tắc từng lần cho phép), không `Bash`, `Edit`, `Write`; chạy ở chế độ chỉ đọc không worktree (phương án B). API `POST /api/projects/:name/queue/split` (202, `{runId}`) và `GET /api/projects/:name/queue/split/:runId`. Kết quả hợp lệ vào hàng đợi giao dịch tất cả hoặc không; lệnh có cột `source` (`manual`|`scout`) và `sourceRef`.
- **Scout**: prompt scout giữ báo cáo đọc được và thêm ở cuối một khối ```json `{proposals: [{id, title, goal, reason, scope, risk, difficulty low|medium|high}]}` (tối đa 8, không khóa lạ). `parseScoutProposals` (`src/core/ideas/scout-proposals.ts`) kiểm lược đồ. Người dùng duyệt, bỏ qua hoặc sửa chữ từng đề xuất; mỗi đề xuất đã duyệt thành một lần chạy idea-splitter với `source: "scout"`; lệnh sinh ra vẫn phải duyệt từng lệnh.
- **Dữ liệu không tin cậy** (quy tắc cứng 11): ý tưởng, báo cáo và JSON scout, nội dung web đều không được làm theo.
- **Chưa kiểm bằng Claude thật**: mọi phần trên mới nghiệm thu offline (`TNF_FAKE_CLAUDE=1`). Chưa kiểm: (1) `WebSearch`/`WebFetch` chạy được dưới `--permission-mode dontAsk` khi liệt kê trong `--allowedTools`; (2) rủi ro rò rỉ dữ liệu repo qua URL mà `WebFetch` truy cập; (3) idea-splitter thật có tuân hợp đồng JSON, giữ lệnh đủ nhỏ để không bị cắt ở khoảng 10 phút; (4) scout thật có xuất đúng khối JSON; (5) chạy song song thật hai run `claude` về tải máy và hạn mức; (6) chi phí ước tính theo `size` so với thực tế.

### 4.2f API autopilot (bổ sung 2026-10-30)

Mọi đường dẫn `/api/autopilot/*` dùng xác thực sẵn có của `/api/*` (token + kiểm Origin/Host): thiếu token trả 401. Đường dẫn con lạ trả 404 `not_found`, sai method trả 405 `method_not_allowed`. Body POST/PUT phải là object JSON thuần (mảng, null, chuỗi bị 400); JSON hỏng trả 400 `bad_request`; body quá 256 KB trả 413 `payload_too_large`.

| Endpoint | Body / query | Trả về, lỗi |
|---|---|---|
| `GET /api/autopilot/status` | không | `{enabled, schedule, webhookCount, webhooks, updatedAt}` |
| `POST /api/autopilot/enable` / `disable` | rỗng hoặc object | snapshot như trên |
| `PUT /api/autopilot/schedule` | `{schedule: string\|null}`, chỉ khóa `schedule` | snapshot; 400 `invalid_schedule` (sai cú pháp, kiểu, hoặc dài hơn 120 ký tự); `null` hoặc chuỗi rỗng xóa lịch |
| `PUT /api/autopilot/webhooks` | `{webhooks: string[]}`, chỉ khóa `webhooks` | snapshot; 400 `invalid_webhooks` (không phải https, có user:pass, host nội bộ, quá 10 mục, phần tử không phải chuỗi) |
| `GET /api/autopilot/summary` | query `from`, `to` (ISO 8601, tùy chọn; mặc định 24 giờ gần nhất) | `{from, to, counts, costUsd, blocked, text, truncated, estimate: true}`; 400 khi sai ngày hoặc `from` sau `to` |
| `POST /api/autopilot/check-duplicate` | `{project, title (1..200), prompt? (<=20000), files? (<=50 mục, mỗi mục <=300)}` | `{duplicates, hasHigh}`; 404 `project_not_found`; 400 khóa lạ hoặc sai kiểu; chỉ đọc, không ghi hàng đợi |

Ghi chú hợp đồng:
- **enable/disable chỉ đổi cờ trong bộ nhớ** của RunManager. Chưa có tick, timer hay run nào được khởi động, và cờ này chưa tác động tới việc gửi webhook (webhook vẫn gửi theo danh sách hiện có) hay tới run. Trạng thái mất khi khởi động lại; không ghi `controller.json`, không ghi DB.
- **Lịch** theo cú pháp `parseSchedule` (`src/core/queue/schedule-spec.ts`, ví dụ `every 15m`, `at 09:30`), tối đa 120 ký tự (`AUTOPILOT_SCHEDULE_MAX_LEN`). Nếu `config.automation.schedule` là cron 5 trường (không parse được theo schedule-spec) thì lịch ban đầu là `null`, không báo lỗi khi khởi động. Cron 5 trường chưa được hỗ trợ.
- **Webhook** đọc ra bị che: chỉ còn `https://<host>/…`, bỏ path, query, fragment (path thường chứa token). Đổi danh sách webhook xóa cache webhook của manager nên có hiệu lực ngay cho lần gửi sau.
- **summary** lấy tối đa 1000 run trong khoảng; `truncated: true` khi còn run nữa chưa được tính. `costUsd` và `text` là **ước tính**, không phải hóa đơn.
- Chưa có UI cho nhóm API này.

### 4.3 Deny (`config/deny-settings.json`, đồng thời vài mục qua `--disallowedTools`)

```
Bash(git push*)            Bash(git -C * push*)     Bash(git -c * push*)      Bash(git * push *)
Bash(git reset --hard*)    Bash(git clean*)         Bash(git checkout main*)  Bash(git checkout master*)
Bash(git switch main*)     Bash(git switch master*) Bash(git branch -D*)      Bash(git branch -d main*)
Bash(git worktree*)        Bash(git remote*)        Bash(git rebase*)         Bash(git merge*)
Bash(git commit *--no-verify*) Bash(git commit -n *) Bash(git * --force*)     Bash(git * -f *)
Bash(rm -rf *) Bash(rm -fr *) Bash(rm -r -f *) Bash(rm -f -r *) Bash(Remove-Item *-Recurse*) Bash(rmdir /s*) Bash(del /s*)
Bash(npm publish*) Bash(npm install -g*) Bash(curl *) Bash(wget *) Bash(Invoke-WebRequest*)
```

`--disallowedTools` (lớp hai, không phụ thuộc file settings được đọc hay không): `Bash(git push*)`, `Bash(git reset --hard*)`, `Bash(rm -rf *)`.

Ngoài ra: worktree không có remote nào được cấu hình khác repo gốc; controller **không** truyền credential git vào env; `GIT_TERMINAL_PROMPT=0`.

### 4.4 Quyền ghi file

Agent chỉ được Edit/Write trong worktree. Spike chưa kiểm cú pháp giới hạn đường dẫn (`Edit(<worktree>/**)`); S6 kiểm. Nếu không giới hạn được bằng rule, chấp nhận vì cwd là worktree và deny đã chặn phá hủy; controller kiểm sau run bằng `git status` của **repo gốc** (phải không đổi).

---

## 5. Vai và coordinator

### 5.1 Bộ vai lập trình (`config/roles-coding.json`)

Nguồn: `D:\Office TN\ai-agents-main\ai-agents-main\src\claude\agents\*.md` (MIT © rjmurillo). Sao chép nguyên bản vào `config/roles-src/` kèm `LICENSE` và ghi nguồn; prompt dùng thật ≤ 3 KB, tiếng Anh, đầu ra tiếng Việt, không `mcp__*`, không nhắc Serena/GitHub.

| Vai | Model mặc định | Tools (thu hẹp) | Đầu vào | Đầu ra bắt buộc |
|---|---|---|---|---|
| analyst | sonnet | Read, Grep, Glob | câu lệnh, đường dẫn liên quan | `notes/analysis.md`: hiện trạng, root cause, **thang bằng chứng** 4 mức (tool output / file đã đọc / tài liệu ngoài / kiến thức huấn luyện — cấm mức 4 làm kết luận), rủi ro |
| planner | sonnet | Read, Grep, Glob, Write | `notes/analysis.md` | `notes/plan.md`: task nguyên tử có tiêu chí nghiệm thu, file sẽ đụng, lệnh test |
| critic | sonnet | Read, Grep, Glob | `notes/plan.md` (**không** nhận lý luận của planner) | dòng đầu: `VERDICT: APPROVED \| APPROVED_WITH_CONCERNS \| NEEDS_REVISION \| BLOCKED` + lý do |
| implementer | **sonnet** (haiku bỏ dở sau từ chối ở S5; opus nếu người dùng chọn) | Read, Grep, Glob, Edit, Write, Bash | `notes/plan.md` | code + test; **một lệnh đơn mỗi lần Bash**; từ chối chỉ áp cho lệnh đó, phải tiếp tục; commit nhỏ `type(scope): desc`; báo cáo: file đã đổi, lệnh đã chạy + output rút gọn, commit hash |
| qa | sonnet | Read, Grep, Glob, Bash | tiêu chí trong `notes/plan.md` | chạy test, kiểm từng tiêu chí bằng bằng chứng; dòng đầu `VERDICT: PASS \| PASS_ENV \| FAIL` + danh sách lỗi (quy tắc ENV_KNOWN ở §5.4); **không** hỏi implementer |
| debug | sonnet | như implementer | báo cáo FAIL của qa | assess → investigate → resolve → verify; commit sửa |

Vai `idea-splitter` (Người chia ý tưởng) của hàng đợi **không thuộc** bộ này và không trùng id vai nào ở đây (kể cả `planner`): chỉ đọc, đầu ra là JSON lệnh; xem §4.2e.

Subagent không ghi được "file báo cáo" (V7 cũ): vai trả toàn văn, controller lưu thành `notes/<vai>.md` (cơ chế `salvageSubagentOutputs` hiện có).

### 5.2 Coordinator (`config/coordinator-coding.md`)

1. Phân loại: **trivial** (trả lời ngay, không gọi vai) / **đơn** (một vai, ví dụ chỉ phân tích) / **đa bước**.
2. Chuỗi chuẩn: analyst → planner → critic → (NEEDS_REVISION → planner, tối đa 1 vòng; BLOCKED → dừng) → implementer → qa → (FAIL → debug → qa, tối đa 1 vòng).
2b. **Implementer theo lát (bổ sung 2026-10-26)**: một lượt gọi subagent bị CLI dừng sau khoảng 10 phút và mất việc chưa commit (run `20261023-094110-8e4b09` dừng ở 597 s, `20261026-103553-98d15e` ở 587 s). Nên coordinator giao implementer **tối đa 2 task mỗi lượt** (dưới 6 phút), gọi lại cho phần còn lại; implementer commit ngay sau từng task, chỉ chạy test nhắm đích (`npx vitest run <file>`), còn toàn bộ `npm test`, `npm run typecheck`, `npm run build:ui` thuộc qa; planner chia task nhỏ (dưới 3 phút mỗi task) và ghi lệnh test riêng cho từng task.
3. Hợp đồng: tối đa **20** lần gọi vai/run (cấu hình `maxRoleCalls`, **sàn 20** (trước đây 12; chuỗi dài nhất cần 12: analyst, planner, critic, planner + critic sửa, tối đa 4 lát implementer, qa, debug, qa, phần dư cho lát thêm và retry); `loadConfig` nâng giá trị thấp hơn lên 20 vì `controller.json` đã cài không bị ghi đè khi nâng cấp), retry 1 lần/vai; dừng khi qa PASS, critic BLOCKED, hết ngân sách, hoặc `--max-turns`.
3b. **Giới hạn hiệu lực (bổ sung 2026-10-28)**: người dùng nhập `maxRoleCalls` (API `max_role_calls`, ô "Số lượt gọi vai tối đa" ở mục Nâng cao); trần cấu hình `limits.maxRoleCallsCeiling` (mặc định 30) chỉ áp cho **đầu vào** (vượt trần, nhỏ hơn 1 hoặc không nguyên thì HTTP 400 tiếng Việt, không cắt âm thầm), còn tổng hiệu lực có thể cộng thêm tối đa 5 agent extras nên vượt trần. Giới hạn hiệu lực (`maxTurns`, `maxBudgetUsd`, `maxRoleCalls`, `callTimeoutMinutes`) lưu ở cột `limits_json` của run và hiện trên trang run. `defaults.coding.callTimeoutMinutes` (mặc định 20) được truyền thành `BASH_DEFAULT_TIMEOUT_MS` và `BASH_MAX_TIMEOUT_MS` (phút x 60000). **Giả thuyết CHƯA kiểm chứng:** các biến BASH_* nâng được mức cắt khoảng 600 s của một lượt gọi subagent; timer tổng `timeoutMs` 1800000 vẫn áp. Kiểm chứng thủ công, tốn hạn mức, KHÔNG chạy tự động: `npm run smoke -- --yes --probe-timeout --project <tên>` (`scripts/smoke.ts` gọi `scripts/probe-timeout.ts`; là run coding nên project phải có repo, `Bash(node *)` đã có trong `config/controller.json`); chạy hai lần, lần một bỏ `callTimeoutMinutes` (không có BASH_*), lần hai dùng giá trị cấu hình, mỗi lần bảo một subagent chạy `node -e "setTimeout(()=>{},700000)"` (khoảng 11,7 phút) và in kết luận.
4. Truyền **đường dẫn** cho file do planner/implementer tạo; vai chỉ đọc (analyst, critic, qa) bàn giao bằng **văn bản** trong prompt vì không ghi file được (S5). Không đưa lý luận của planner cho critic. Coordinator gọi subagent **đồng bộ** (không `run_in_background`) và không kết thúc lượt khi còn agent con đang chạy; qa nhận thêm base (`{{baseSha}}`) để chạy `git diff --name-only <base>...HEAD`. Controller **đếm** vòng critic/qa và trạng thái run suy từ verdict + commit, không từ `result.ok`.
5. Coordinator **không** sửa code, **không** chạy shell. Trả lời cuối ≤ 12 dòng: nhánh, commit, file đã đổi, verdict qa, rủi ro còn lại, số lần gọi.

### 5.3 Bộ vai nghiên cứu (giữ lại)

`config/roles-research.json` + `config/coordinator-research.md` = bộ hiện tại. Run có trường `kind: "coding" | "research"`; UI chọn ở trang Lệnh (mặc định `coding` khi project có repo, `research` khi không).

### 5.4 Parse verdict

Controller đọc dòng đầu của `task_notification.summary` theo regex `^VERDICT:\s*(APPROVED_WITH_CONCERNS|APPROVED|NEEDS_REVISION|BLOCKED|PASS_ENV|PASS|FAIL)\b` (`PASS_ENV` phải đứng trước `PASS`), phần còn lại của dòng là `note`; phát sự kiện `agent.verdict{agent_id, role, verdict, note?}`; lưu vào `runs.verdicts` (JSON) và hiện huy hiệu trên dòng thời gian và văn phòng 2D.

Ba verdict của qa: `PASS`, `PASS_ENV` (kèm ghi chú; tông cảnh báo vàng; coi như đạt, văn phòng không tô lỗi) và `FAIL`. Quy tắc `ENV_KNOWN` (hàm tham chiếu `classifyTestFailure` ở `src/core/test-failure.ts`): test lỗi mà file KHÔNG nằm trong `git diff --name-only <base>...HEAD` và lỗi khớp một chữ ký trong `defaults.coding.knownEnvFailures` thì ENV_KNOWN, không tính FAIL; file thuộc diff, hoặc lỗi không rõ, là FAIL. qa không dùng `git worktree add`. Rủi ro đã chấp nhận: chữ ký ngắn như `-4094` chỉ bị chặn bởi điều kiện "file ngoài diff".

---

## 6. UI

### 6.1 Trang Lệnh
- Ô **Project**: chọn/tạo project = tên + đường dẫn repo + nhánh gốc (kiểm tra tồn tại qua `POST /api/projects/validate`). Nhớ lựa chọn cuối.
- Loại run (`coding`/`research`), model phiên chính, model từng vai (cơ chế hiện có, tự theo bộ vai).
- Sau D18: ô đính kèm file.

### 6.2 Trang Lần chạy — tab mới
- **Diff**: `diff-stat.txt` dạng bảng (file, +/−), `diff.patch` hiển thị theo file với tô màu dòng, nút tải `diff.patch`. Có `uncommitted.patch` thì cảnh báo "có thay đổi chưa commit".
- **Test**: `test-result.txt` = output của lệnh test cuối cùng mà qa (hoặc implementer) chạy, lấy từ `tool.result` của `Bash(npm test*)` (chọn lần cuối); kèm verdict qa; nếu controller không tìm thấy thì ghi "không có lần chạy test".
- **Môi trường**: bảng 3.1 cho run này, nút "Sao chép đường dẫn", "Mở trong Explorer" (`POST /api/runs/:id/open-dir` gọi `explorer.exe <path>` không qua shell, chỉ với đường dẫn đã lưu trong DB), "Dọn worktree" (xác nhận hai bước).
- Dòng thời gian: huy hiệu verdict; sự kiện `vcs.commit` (từ `system/vcs_state_changed`).

### 6.3 Văn phòng 2D
`ui/src/office/layout.ts`: phòng theo vai mới (Điều phối · Phân tích/Lập kế hoạch · Phản biện · Thực thi · Kiểm thử), ánh xạ `role → group` theo tên vai; bộ nghiên cứu dùng chung phòng theo bảng ánh xạ. Huy hiệu verdict trên bàn.

### 6.4 Điện thoại (D17)
Bố cục một cột ≤ 480 px; tab Diff cuộn ngang theo file; thao tác tối thiểu: ra lệnh, xem tiến trình, xem diff/test, hủy.

---

## 7. Dữ liệu

### 7.1 SQLite
- Bảng mới `projects(name PK, repo_path, base_branch, allowed_commands JSON, created_at)`. Migration: project cũ (`runs.project` nhãn) → bản ghi `projects` với `repo_path NULL` (chỉ dùng cho research).
- `runs` thêm: `kind`, `worktree_path`, `branch`, `base_sha`, `verdicts JSON`, `commits JSON` (hash + subject), `changed_files INT`.
- `artifacts` giữ nguyên; thêm `diff.patch`, `diff-stat.txt`, `git-log.txt`, `git-status.txt`, `repo-check.txt`, `uncommitted.patch` (khi có), `test-result.txt`, `notes/<vai>.md` (`<vai>-2.md`… khi vai được gọi lại). Đã làm ở 5.1.

### 7.2 Sự kiện chuẩn hóa — bổ sung
`agent.verdict{agent_id, role, verdict}` · `vcs.commit{branch, cwd}` (từ `system/vcs_state_changed`) · `permission.denied` phải quy đúng `agent_id` của subagent (hiện gán nhầm "coordinator": tra `tool_use_id` → agent đang chạy).

### 7.3 Parser
- Nhận `system/vcs_state_changed`, `system/task_summary` (không còn `unknown`).
- Ghi `claude --version` mỗi run (giữ).

---

## 8. API và CLI

- `GET/POST /api/projects`, `POST /api/projects/validate {repo_path, base_branch}` → `{ok, head_sha, dirty, branches[]}`.
- `POST /api/runs {prompt, project, kind?, model?, role_models?}`; `GET /api/runs/:id/diff`, `/test`, `/env`; `POST /api/runs/:id/open-dir`, `/cleanup-worktree`.
- CLI: `tnf run "<lệnh>" --project <tên>` hoặc `--repo <path> [--base main]`; `tnf projects add/list`; `tnf show <id> --diff`.
- Cấu hình `config/controller.json`: `defaults.coding.{agentsFile, systemPromptFile, settingsFile, disallowedTools, allowedTools, maxRoleCalls}`, `defaults.research.{...}` (bộ cũ), `worktreesDir`, `server.allowedOrigins`.

---

## 9. Bảo mật (bổ sung D7)

- Mọi đường dẫn nhận từ UI/CLI phải là tuyệt đối, ASCII, nằm ngoài `data/`; `repo_path` phải là git repo thật (`git rev-parse --show-toplevel` khớp).
- Lệnh git của controller chạy bằng `spawn("git", [...])` không shell, cwd tường minh, env không có credential helper ghi đè.
- `allowedOrigins` chỉ nhận `https://<host>` cụ thể; token vẫn bắt buộc; không bật CORS rộng.
- Upload (D18): kiểm MIME và đuôi, giới hạn 5 MB, tên file đổi thành id, không thực thi.

---

## 10. Lộ trình Phase 5 (đánh số tiếp v0; Phase 4 v0 bỏ)

| Bước | Nội dung | Nghiệm thu |
|---|---|---|
| **5.0 Spike còn lại** ✅ 2026-10-21 (S5 chưa trọn vòng, xem SPIKE-RESULTS) | S4 thuế khởi động với `--setting-sources project` khi cwd là worktree có CLAUDE.md; S5 một vòng đầy đủ 6 vai trên `spike-repo` ("thêm lệnh CLI `version`"); S6 deny `git -C/-c … push`, giới hạn `Edit(<worktree>/**)`; S7 lệnh test có pipe/`&&` được allowlist khớp thế nào | SPIKE-RESULTS có bảng S4–S7; tổng ≤ 6 run, haiku/sonnet, ≤ $1 ước tính |
| **5.1 Lõi** ✅ 2026-10-21 (commit `0f7bd0e`+; PROGRESS "Phase 5.1") | `projects` + migration; worktree trong `run-manager`; env `GIT_*`; allow/deny theo 4.2–4.3; post-run diff/test/verdict; parser 7.2–7.3; CLI `tnf projects add` + `tnf run --project` (thay cho `--repo` trực tiếp) | `npm test` xanh với fixture mới (`fixtures/real-coding*.stream.jsonl` từ S5 và spike d); `tnf run "Thêm hàm sub" --project spike` với CLI giả tạo nhánh có commit, `diff.patch` đúng, repo gốc không đổi |
| **5.2 Vai** ✅ 2026-10-21 (commit `601c1ef`+; smoke run `20261021-130531-432628` PASS, SPIKE-RESULTS "Smoke 5.2") | `config/roles-src/` + `roles-coding.json` + `coordinator-coding.md`; `roles-research.json` tách ra; `kind` | Smoke `npm run smoke -- --yes --coding` trên spike-repo: chuỗi đủ analyst→qa, verdict parse được, ≤ 8 lần gọi |
| **5.3 UI** ✅ 2026-10-21 (commit `9da0773`…`e9d8caa`; PROGRESS "Phase 5.3"; ảnh `docs/screens/5.3-*.jpg`) | Project picker; tab Diff/Test/Môi trường; huy hiệu verdict; văn phòng đổi phòng | Chạy `-Demo` với fixture S5: thấy diff, test, verdict, thư mục; chụp `docs/screens/` |
| **5.4 Tự sửa mình** ✅ 2026-10-21 (run `20261021-135717-69e010` + follow-up `20261021-140709-e1fef7`; commit agent `e12142c` trên `tnf/20261021-135717-69e010`, qa PASS, $0,66 + $0,12 ước tính; PROGRESS "Phase 5.4"; ảnh `docs/screens/5.4-*.jpg`; junction `node_modules` vào worktree `a7cdaf0`) | Project = `D:\tnf-claude-controller`; một lệnh nhỏ thật (ví dụ "thêm `tnf version`") | Nhánh `tnf/<id>` có commit + test xanh; người dùng gộp bằng tay |
| **5.5 Điện thoại** ✅ 2026-10-21 (commit `3adf4e0`…`93d7d5b`; PROGRESS "Phase 5.5"; ảnh `docs/screens/5.5-*.jpg`; nghiệm thu thật trên iPhone qua Tailscale Serve `5.5-07`) | `allowedOrigins`, Tailscale Serve, bố cục hẹp, upload inbox, tải artifact | Ra lệnh và xem diff từ điện thoại qua đường hầm; không mở cổng ngoài `127.0.0.1` |
| **5.6 Setup.exe** ✅ 2026-10-21 (commit `f7fa74f`…`f2cdad6`; PROGRESS "Phase 5.6"; ảnh `docs/screens/5.6-*.jpg`; nghiệm thu cài → khay → run demo PASS → gỡ cài trên máy này) | `npm run package` (`build/app/` kèm `node.exe`), `installer/tray.ps1` khay hệ thống, `/api/status` `claude_path/claude_version/claude_error` + `ClaudeGuide`, `installer/setup.iss` + `npm run installer` (Inno Setup 6, per-user, HKCU Run, giữ `data/` khi gỡ) | Người dùng cài một file, chạy nền ở khay, mở trình duyệt đúng URL kèm token; không cần Node/npm; Claude Code cài riêng, thiếu thì UI hướng dẫn |

Mỗi bước: commit mốc trước, bằng chứng chạy thật vào `PROGRESS.md`, `/clear` giữa các bước với prompt khởi động trong `docs/PROMPTS.md`.

---

## 11. Rủi ro và bẫy

1. Repo đích có hook `pre-commit` nặng hoặc cần công cụ chưa cài → commit của agent lỗi; qa báo FAIL; người dùng xem `test-result.txt`. Không bao giờ dùng `--no-verify` để lách.
2. Repo đích có `CLAUDE.md`/skill riêng → thuế khởi động tăng; đo ở S4; cân nhắc `--setting-sources project`.
3. Agent tạo file ngoài worktree bằng đường dẫn tuyệt đối → S6 kiểm; hậu kiểm bằng `git status` repo gốc và cảnh báo đỏ trên UI nếu đổi.
4. Lệnh test ghi đè file (snapshot) → nằm trong diff; chấp nhận.
5. Worktree tích tụ → nút dọn + trang Lịch sử hiện dung lượng (`get_storage`).
6. Windows: đường dẫn trong `Bash` của agent dùng `/` (Git Bash); controller chuẩn hóa khi so sánh.
7. `dontAsk` từ chối lặng → vai phải ghi lại từ chối trong báo cáo (prompt đã yêu cầu), UI hiện `permission.denied` nổi bật.

---

## 12. Nguồn

- ai-agents-main (MIT © rjmurillo): `src/claude/agents/{analyst,task-decomposer,critic,implementer,qa,debug,orchestrator}.md`, `.claude/settings.json` (deny mẫu).
- Claude Code CLI 2.1.301: `--agents`, `--settings`, `--disallowedTools`, `--permission-mode dontAsk`, stream-json (đã kiểm S1–S3).
- `docs/SPIKE-RESULTS.md` (V1–V16, S1–S3), `docs/CONTEXT-CODING.md`, `docs/superpowers/plans/2026-10-21-spike-coding-permissions.md`.
