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
12. **To-do list** (`todo_items`, schema 9): mỗi việc trỏ tới đúng một `projects` (Pre/Post-sales) hoặc `freelance_jobs`,
   xóa dây chuyền theo dự án/job; không trùng trong cùng ngày. Danh mục có màu khai báo ở `COLORED_MASTER_KINDS`.
13. **Bảng & tô sáng**: bảng danh sách dùng `useTableResize(key)` (`src/renderer/lib/tableResize.ts`) — `<tr data-row={id}>`
   để đổi chiều cao dòng, `data-col` cho tiêu đề không có chữ. Tô sáng kết quả tìm kiếm dùng CSS Custom Highlight
   (`src/renderer/lib/highlight.ts`), **không** bọc `<mark>` vào DOM do React quản lý.

## Phát hành bản cập nhật

1. Commit thay đổi (tiêu đề commit thành ghi chú "Có gì mới" hiển thị cho user — viết rõ ràng bằng tiếng Việt;
   commit bắt đầu bằng `chore:`, `ci:`, `test:`, `build:` không được đưa vào ghi chú).
2. `npm version patch` (sửa lỗi) / `minor` (tính năng) / `major` → tạo commit + tag `vX.Y.Z`.
   Muốn tự viết ghi chú thay cho danh sách commit: `npm version minor -m "Bản %s: thêm module Báo cáo"`
   (`%s` là số phiên bản; nội dung này thành tag message và được dùng làm ghi chú).
3. `git push --follow-tags` → GitHub Actions (`.github/workflows/release.yml`) chạy test, build và đăng Release.
   Tag phải khớp `version` trong `package.json`, nếu không workflow dừng.
