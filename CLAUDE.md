# CLAUDE.md

Personal Project Manager (PPM) — app desktop Electron + React + TypeScript + SQLite (sql.js), quản lý công việc cá nhân
chạy local, theo đặc tả PPM-SRS-001 v1.2. Giao diện và comment bằng tiếng Việt. Xem `README.md` để biết kiến trúc.

## Lệnh

- `npm run dev` — chạy dev (dữ liệu riêng ở `.dev-data/`, không đụng dữ liệu thật của bản cài)
- `npm test` — unit/service test (vitest) · `npm run typecheck`
- `npm run build` rồi `npm run e2e` — chạy app Electron thật bằng Playwright, ảnh chụp ở `.e2e-data/shots`
- `npm run dist` — build bộ cài local vào `release/`

## Quy tắc bắt buộc — dữ liệu người dùng

App tự cập nhật trên máy user, nên mọi thay đổi phải giữ được dữ liệu đang có trong `%APPDATA%\Personal Project Manager\data`.

1. **Schema**: chỉ thêm migration mới vào CUỐI mảng `MIGRATIONS` (`src/main/db/migrations.ts`), version tăng dần.
   Không sửa/xóa migration đã phát hành. Không DROP hoặc tạo lại bảng mà không copy dữ liệu. Thêm test migration
   từ dữ liệu cũ (xem `tests/update-safety.test.ts`, `tests/v14.test.ts`).
   Tạo lại một bảng có bảng con tham chiếu (vd `projects`) thì đặt `foreignKeysOff: true` cho migration — nếu không,
   `DROP TABLE` sẽ xóa dây chuyền ghi chú/lịch/dữ liệu import (ON DELETE CASCADE).
2. **Setting mới**: dùng key mới trong bảng `app_settings` + giá trị mặc định trong `getSettings` — không cần migration.
3. **Không đổi** `productName`, `name`, `build.appId` trong `package.json` (đổi là app đọc thư mục dữ liệu khác).
4. **Ảnh**: bảng chứa ảnh phải có cột `storage_key` để được bảo vệ khỏi bước dọn ảnh mồ côi lúc khởi động.
5. **Mật khẩu Warranty**: giữ định dạng `os:`/`aes:` trong `src/main/platform.ts`; đổi cách mã hóa thì phải đọc được dữ liệu cũ.
6. Không ghi dữ liệu người dùng nhập (nhất là mật khẩu) vào log.
7. **Thư mục dữ liệu** có thể nằm ngoài `%APPDATA%`: luôn lấy từ `ctx.paths`, không tự ghép đường dẫn mặc định.
   Vị trí ghi trong `userData/data-location.json` (xem `src/main/dataLocation.ts`); thêm file/thư mục dữ liệu mới thì
   bổ sung vào `DATA_ENTRIES` để được chép theo khi đổi thư mục.
8. **Job Freelance** là bảng riêng `freelance_jobs` (từ schema 5), không dùng năm/Pre/Post/Warranty và danh mục riêng
   (`freelanceStatuses`, `freelanceHirers`, nhóm `FREELANCE` trong `MASTER_GROUP`). Không tạo lại `job_years` loại `FREELANCE`.
   Calendar hiển thị Freelance/Kinh nghiệm qua `listCalendarFeed` (tính từ dữ liệu, không lưu bảng `calendar_events`).
   Ghi chú theo ngày dùng chung `writeDayNote` với `NoteStore` (`PROJECT_NOTES` / `FREELANCE_NOTES` trong
   `src/main/services/notes.ts`). Mục Password lưu mật khẩu mã hóa giống Warranty, không bao giờ trả về trong list.
9. **STT** dự án duy nhất theo (năm, nhóm) — `ux_projects_stt(job_year_id, work_category, stt)`; Warranty theo năm;
   Job Freelance theo cả bảng. Gợi ý STT luôn dùng `nextProjectStt(jobYearId, category)` / `nextWarrantyStt(jobYearId)`.
10. **Thư mục dự án trên máy**: `projects.folder_auto = 0` là thư mục có sẵn do người dùng liên kết — không bao giờ
   tự đổi tên/chuyển. Ngoài ra: chỉ tạo/đổi tên/chuyển trong nơi người dùng đã chọn qua hộp thoại; xóa thì chuyển vào
   Thùng rác (`shell.trashItem`), không xóa vĩnh viễn. E2E không được ghi vào clipboard thật của Windows.
11. **Kho thiết bị** (schema 7–9): `equipment_items` (+ `equipment_images`, `category_id` → `equipment_categories`) và
   `equipment_loans` (`due_date` = Ngày hẹn trả, `return_date` = Ngày trả thực tế; `equipment_loan_images`) — không thuộc
   `job_years`. Mỗi thiết bị tối đa **một** lần mượn chưa hoàn trả (`saveEquipmentLoan` chặn); `current_borrow_date` /
   `current_due_date` chỉ là bản sao tính lại bằng `syncCurrent` sau mỗi thay đổi lần mượn — không cho sửa trực tiếp.
   Hãng / Tên SI / Sale dùng chung danh mục Job Chính (Sale chỉ hiện tên), nên mọi cột tham chiếu danh mục phải khai báo
   trong `SPECS` của `src/main/services/master.ts`. Tình trạng thiết bị chỉ tự đổi trong `saveEquipmentLoan`.
12. **To-do list** (`todo_items`, schema 9, tạo lại ở schema 11): mỗi việc là đúng một trong `project_id` (Pre/Post-sales),
   `freelance_job_id` hoặc `title` (việc tự nhập) — CHECK trong bảng; xóa dây chuyền theo dự án/job; job không trùng trong
   cùng ngày. Danh mục có màu khai báo ở `COLORED_MASTER_KINDS`.
13. **Bảng & tô sáng**: bảng danh sách dùng `useTableResize(key)` (`src/renderer/lib/tableResize.ts`) — `<tr data-row={id}>`
   để đổi chiều cao dòng, `data-col` cho tiêu đề không có chữ. Tô sáng kết quả tìm kiếm dùng CSS Custom Highlight
   (`src/renderer/lib/highlight.ts`), **không** bọc `<mark>` vào DOM do React quản lý.
14. **Bảng import thiết bị** (schema 10): một dự án có nhiều `project_imports` (không còn UNIQUE trên `project_id`);
   `commitImport(projectId, payload, replaceImportId)` thêm bảng mới hoặc thay đúng một bảng, `removeImport` gỡ một bảng.
   Từ schema 13 mỗi bảng là một tab sheet: `tab_name` (không trùng trong dự án, không phân biệt hoa/thường — kiểm tra bằng
   `validateImportTabName`) và `sort_order` (trái → phải); import thêm nối vào cuối, Import lại giữ vị trí (tên tự đặt
   theo file thì đổi theo file mới, tên đã đổi tay thì giữ). Đổi tên / thứ tự qua `renameImport` / `reorderImports`.
   Logic dùng chung ở `src/main/services/imports.ts` (`ImportStore`: `PROJECT_IMPORTS`, `EVENT_IMPORTS`); giao diện
   `ProjectImports` nhận `ops` để dùng cho chủ sở hữu khác dự án.
15. **File liên kết** (schema 12): danh sách ở `project_files`; cột `projects.file_*` chỉ là bản sao file đầu tiên (giữ cho
   dữ liệu cũ) — luôn ghi qua `writeFiles`. `openFile` chỉ mở đường dẫn có trong `project_files`. Ảnh trong ghi chú chỉ
   được giữ `width` / `data-scale` / `data-align` (lọc trong `noteHtml.ts`); chỉnh ảnh ở `NoteImageTools.tsx`.
16. **Schema 14–16**:
   - **Priority Point** (schema 15): **5 là cao nhất, 1 thấp nhất** — migration đã đảo dữ liệu cũ (p → 6 − p). Sắp xếp theo
     Priority "tăng dần" nghĩa là ưu tiên cao trước (`sortProjects` so `b.priorityPoint - a.priorityPoint`).
   - To-do **Vô thời hạn** là `todo_items.todo_date = ''` (`TODO_NO_DATE`), không phải NULL — để chỉ mục duy nhất
     (ngày, dự án / job) vẫn chặn trùng. `listTodosRange` không trả về mục này; kéo sang ngày khác qua `moveTodo`.
   - Ghi chú có link (`src/shared/linkNote.ts`): chữ thường, `[Tên](link)` hoặc link dán thẳng; chỉ mở được link
     http/https (qua `openExternalUrl`). Dùng cho `password_entries.note` (không mã hóa) và `knowledge_places.note`.
   - `brands.knowledge_hidden`: Hãng đã xóa khỏi Kiến thức nhưng còn dùng nơi khác (`removeKnowledgeBrand`). Hãng
     không còn dùng ở đâu thì xóa hẳn; viết bài / "Thêm Hãng" trùng tên thì hiện lại.
   - Warranty: `project_id` (dự án Pre/Post-sales) **hoặc** `project_entry_id` (danh mục `warrantyProjects`), không
     cả hai. Job Freelance: `freelance_job_companions` + `freelance_companion_payments` (+ ảnh); không bỏ được người đồng
     hành đã có thanh toán trong job, danh mục `freelanceCompanions` đang dùng chỉ Deactivate.
   - **Sự kiện tạm thời**: `temp_events` (+ `temp_event_files`, `temp_event_notes` qua `EVENT_NOTES`,
     `temp_event_imports`); `openFile` / `openLocalLink` chấp nhận cả file / thư mục liên kết với sự kiện. Cột tham chiếu
     danh mục mới phải khai báo trong `SPECS` của `master.ts`.
   - Schema 16: Hãng của sự kiện ở bảng nối `temp_event_brands` (nhiều Hãng); cột `temp_events.brand_id` không còn dùng.
   - Hộp thoại chọn xlsx (`pickWorkbook(owner)`): thư mục của dự án / sự kiện → thư mục import gần nhất (`app_settings`
     key `last_import_dir`, ghi sau mỗi lần chọn file) → Downloads. Tìm kiếm kiểu `note` ở `searchNotes` (`search.ts`).

## Phát hành bản cập nhật

**Cách nhanh (một lệnh)**: `npm run release` hoặc bấm đúp `release.bat` — tự chạy typecheck + unit test → commit →
`npm version` → `git push --follow-tags` (script: `scripts/release.mjs`, `--dry-run` để xem trước các bước).
Khi Claude làm xong một lượt thay đổi mà không tự chạy được git trên máy user, hãy ghi file `.release-msg.txt`
ở gốc repo (đã gitignore, tự xóa sau khi phát hành):

```
bump: minor
Tiêu đề commit bằng tiếng Việt — thành ghi chú "Có gì mới" cho user
(dòng sau, nếu có: mô tả chi tiết)
```

Rồi chỉ cần nhờ user chạy `release.bat`.

**Quy trình user yêu cầu với Claude**: develop hết một lượt → chạy e2e và cho user xem quá trình test (ảnh chụp các bước)
→ hiện hộp thoại hỏi user có muốn release không. Chỉ khi user đồng ý mới chuẩn bị `.release-msg.txt` / chạy release;
user tự bấm `release.bat` nếu Claude không chạy được git trên máy. Các bước thủ công tương đương:

1. Commit thay đổi (tiêu đề commit thành ghi chú "Có gì mới" hiển thị cho user — viết rõ ràng bằng tiếng Việt;
   commit bắt đầu bằng `chore:`, `ci:`, `test:`, `build:` không được đưa vào ghi chú).
2. `npm version patch` (sửa lỗi) / `minor` (tính năng) / `major` → tạo commit + tag `vX.Y.Z`.
   Muốn tự viết ghi chú thay cho danh sách commit: `npm version minor -m "Bản %s: thêm module Báo cáo"`
   (`%s` là số phiên bản; nội dung này thành tag message và được dùng làm ghi chú).
3. `git push --follow-tags` → GitHub Actions (`.github/workflows/release.yml`) chạy test, build và đăng Release.
   Tag phải khớp `version` trong `package.json`, nếu không workflow dừng.
