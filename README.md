# Personal Project Manager (PPM)

Ứng dụng quản lý công việc/dự án cá nhân chạy **local** trên Windows, xây dựng theo đặc tả
`PPM-SRS-001 v1.2` (gồm Change Request 01 – Job/Năm/Import XLSX và Change Request 02 – Warranty,
Hãng, Experience, quản lý năm). Không cần tài khoản, không gửi dữ liệu ra ngoài máy.

**Tải về và cài đặt:** xem [HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md) — file cài đặt ở trang
[Releases](https://github.com/kimcuong04/Work-Manager-TungHN/releases/latest), không nằm trong mã nguồn.

## Chạy ứng dụng

Yêu cầu: Windows 10/11, Node.js 20+.

```bash
npm install
npm run build      # typecheck + build giao diện + build main process
npm start          # mở ứng dụng
```

Phát triển (hot reload giao diện): `npm run dev` — dùng dữ liệu riêng ở `.dev-data/`, không đụng dữ liệu thật.

Đóng gói local: `npm run dist` → `release/PersonalProjectManager-Setup-x.y.z.exe` (`npm run dist:portable` cho bản portable —
bản portable **không** tự cập nhật).

## Tự cập nhật qua GitHub

App cài bằng bản Setup sẽ tự kiểm tra GitHub Releases khi mở và mỗi 4 giờ, tải ngầm bản mới rồi hiện chấm đỏ trên
**chuông thông báo** ở góc phải topbar (không tự bật hộp thoại). Bấm chuông để xem ghi chú thay đổi và nút
**Cập nhật & khởi động lại**; chưa cập nhật thì bản mới tự cài khi đóng app.
Có thể tắt trong Settings › Dữ liệu & Backup. App chỉ tải thông tin phiên bản/bộ cài, không gửi dữ liệu đi.

**Thiết lập một lần**

1. Tạo repo trên GitHub cá nhân (để **Public** thì app mới tải được bản cập nhật — xem phương án private ở dưới).
2. Đẩy code lên:
   ```bash
   git remote add origin https://github.com/<user>/personal-project-manager.git
   git push -u origin main
   ```
3. Phát hành bản đầu tiên: `git tag v1.2.0 && git push origin v1.2.0`. Sau ~5–10 phút, trang Releases có
   `PersonalProjectManager-Setup-1.2.0.exe` — cài file này trên máy user (lần đầu Windows SmartScreen có thể cảnh báo
   vì app chưa ký số: bấm *More info › Run anyway*).

**Mỗi lần có tính năng mới / sửa lỗi**

```bash
git commit -am "Sửa lỗi lọc Warranty theo tháng"
npm version patch          # hoặc minor khi thêm tính năng
git push --follow-tags
```

GitHub Actions chạy test → build → đăng Release; ghi chú lấy từ tiêu đề các commit kể từ bản trước
(hoặc nội dung tag có chú thích). Máy user sẽ tự nhận bản mới.

**Muốn giữ code private**: tạo thêm một repo Public chỉ để chứa bản phát hành (ví dụ `ppm-releases`), tạo fine-grained
token có quyền *Contents: Read and write* trên repo đó, rồi trong repo code vào *Settings › Secrets and variables › Actions*:
Secret `RELEASES_TOKEN` = token, Variable `RELEASE_REPO` = `<user>/ppm-releases`.

**An toàn dữ liệu khi cập nhật**: database được sao lưu trước mỗi lần nâng cấp schema (`backups/pre-migrate-*.sqlite`),
mỗi lần mở app giữ 10 bản sao gần nhất (`backups/start-*.sqlite`); migration lỗi sẽ rollback, file gốc không đổi và app
cho phép tải ngay bản sửa lỗi từ GitHub thay vì kẹt lại.

## Dữ liệu lưu ở đâu

Mặc định: `%APPDATA%\Personal Project Manager\data\` (theo `productName` trong `package.json`). Đổi sang ổ khác trong
**Settings › Dữ liệu & Backup › Thư mục dữ liệu** (chép → kiểm tra → khởi động lại; vị trí được ghi trong
`%APPDATA%\Personal Project Manager\data-location.json`, bản cũ giữ lại tới khi người dùng dọn).

| Mục | Nội dung |
|-----|----------|
| `ppm.sqlite` | Database SQLite (ghi kiểu file tạm → rename, mỗi thao tác là một transaction) |
| `images/`, `thumbs/` | Ảnh Warranty/Experience và thumbnail do ứng dụng quản lý |
| `backups/` | `start-*.sqlite` (10 lần mở gần nhất), `pre-migrate-*.sqlite` (trước khi nâng cấp schema), bản tự động trước khi Restore |
| `logs/app.log` | Log lỗi (không bao giờ ghi mật khẩu) |

Đặt biến môi trường `PPM_DATA_DIR` để dùng thư mục dữ liệu khác (ví dụ chạy portable từ USB).
Backup/Restore trong **Settings › Dữ liệu & Backup** xuất một file `.zip` gồm database + toàn bộ ảnh.

## Chức năng chính

- **Dashboard**: KPI theo trạng thái, ring chart 3 trạng thái hoạt động, danh sách khẩn cấp (mở chi tiết/mở file),
  **Dự án trong tháng** (STT / Tên / Hãng / Tên SI / Sale / Ngày bắt đầu / Trạng thái; chuyển tháng; **xuất .xlsx** chọn
  cột; cột ngày ghi thành ô ngày Excel dạng mm/dd/yyyy), lọc theo Năm/Nhóm (dự án Job Chính); bấm KPI/biểu đồ để mở
  *Tất cả mục* với bộ lọc tương ứng.
- **Calendar** (kiểu Google Calendar): xem Ngày / Tuần / Tháng / Lịch trình. Dự án mới tự có mục *Bắt đầu dự án* ở ngày
  tiếp nhận; khi sửa dự án, nút xanh **Lưu và thêm vào Calendar** ghi mục *Cập nhật dự án* kèm tóm tắt thay đổi.
  Lớp *Hạn chót dự án* lấy từ ngày tới hạn. Tạo sự kiện riêng (có giờ, màu, liên kết dự án), kéo thả để đổi ngày.
- **Sidebar**: My Workspace › Dashboard, Tất cả mục, Calendar, Job Chính › Năm › Pre-sales / Post-sales / Warranty,
  **Job Freelance** (một bảng), Experience / Kiến thức › Hãng, **Tiện ích › Password, Tools (Tool app / Tool online)**,
  AI Assistant (Coming Soon), Settings. Thêm/đổi tên/xóa năm, “+” thêm Project theo ngữ cảnh.
- **Job Freelance**: một bảng chung cho mọi năm, quản lý riêng với Job Chính — STT (tự +1, không trùng), **Tên dự án**
  (bắt buộc), Bên thuê, Ngày bắt đầu, **Tình trạng** (danh mục riêng, đổi ngay trên bảng; sửa/sắp xếp ở Settings ›
  Master Data › Job Freelance) và **ghi chú theo ngày** như Job Chính (sửa được ngày cũ, dán ảnh). Lọc theo Tình trạng /
  năm, tìm không dấu. Dữ liệu Freelance cũ (Pre/Post-sales) được chuyển sang bảng này khi cập nhật lên v1.5; Warranty
  Freelance cũ chuyển sang Warranty Job Chính cùng năm.
- **Import .xlsx hàng loạt** cho Pre-sales / Post-sales / Warranty (theo năm) và Job Freelance: tự nhận diện dòng header
  và cột theo tên tiêu đề, chỉnh mapping từng cột, xem trước (dòng lỗi được đánh dấu và bỏ qua), Tên SI / Hãng / Sale /
  EU / Tình trạng khớp theo tên, chưa có thì thêm vào danh mục; Pre/Post-sales tạo luôn thư mục dự án nếu chọn. File không có
  cột STT mà tên dự án mở đầu bằng số (`01. ABC`) thì STT lấy theo số đó (tên còn `ABC`), không đánh theo thứ tự dòng.
- **Chọn nhiều để xóa** (Pre-sales / Post-sales / Tất cả mục / Warranty / Job Freelance): bấm **Chọn**, tick từng dòng
  (hoặc bấm vào dòng) hay ô tick đầu bảng để chọn tất cả dòng đang hiển thị, rồi **Xóa**. Dự án có thêm lựa chọn
  *Xóa cả folder local* như khi xóa từng dự án.
- **Password**: danh sách STT / Tên website / Username / Password / Link website — thêm, sửa, xóa, tìm theo Tên website.
  Mật khẩu mã hóa theo tài khoản Windows, che mặc định, bấm mắt để xem (tự ẩn sau 20 giây), sao chép không cần hiện.
- **Tools**: *Tool app* — các tool nhỏ chạy trong app (đăng ký trong `src/renderer/tools/registry.ts`); *Tool online* —
  danh sách STT / Tên tool / Mục đích / Link (bắt buộc là link), thêm, sửa, xóa, tìm theo tên, bấm để mở trình duyệt.
- **Pre-sales / Post-sales** mặc định xem dạng **Danh sách** (bảng sắp xếp theo cột, ẩn/hiện cột; bấm một dòng mở panel
  xem nhanh bên phải với View info / Edit); chuyển sang **Tiến độ** để xem board.
- **Thông tin dự án**: **STT** (tự +1, không trùng) và **Tên dự án** là bắt buộc; Tên SI, Hãng (chọn nhiều), Sale
  (kèm Phòng ban), EU, Ngày bắt đầu, Ngày tới hạn, Priority không bắt buộc. File DWG/TXT nằm trong mục thu gọn
  "File liên kết".
- **Thư mục dự án trên máy**: khi tạo dự án phải chọn nơi lưu (lần sau mặc định nơi đã chọn); app tự tạo thư mục
  `STT.Tên dự án_Tên SI_Hãng` và đổi tên theo khi sửa các trường đó. Xóa dự án có 3 lựa chọn: Hủy / Xóa / Xóa cả
  folder local (thư mục được chuyển vào Thùng rác).
- **Tìm kiếm** trên topbar theo Tên dự án / Tên SI / Serial number / Hãng / Model-Mã thiết bị, kèm bộ lọc ngày/tháng;
  Enter mở trang kết quả đầy đủ.
- **Board 4 cột** Khẩn cấp / Cần chú ý / Mới tiếp nhận / Đã hoàn thành — trạng thái luôn tính tự động từ ngày tới hạn
  và ngưỡng. Kéo thả chỉ bật khi bấm *Chỉnh sửa Board* và chỉ dùng để hoàn thành / bỏ hoàn thành (có xác nhận).
- **Tìm kiếm không dấu** (`thiet ke` ↔ `Thiết kế`), lọc nhiều EU/Tên SI/Hãng/Sale, sắp xếp; bộ lọc giữ trong phiên.
- **Project Detail**: thông tin, thời hạn & ưu tiên, file DWG/TXT liên kết (mở bằng ứng dụng mặc định của Windows,
  cảnh báo khi mất liên kết, chọn lại/gỡ), **Ghi chú theo ngày** (mỗi ngày một mục, định dạng tự do: đậm/nghiêng/màu/
  danh sách/bảng, dán ảnh Ctrl+V; sửa được ghi chú ngày cũ), **Import .xlsx** chỉ lấy bảng **Thông tin các thiết bị**
  (tự nhận diện + mapping cột, preview, lưu mapping tái sử dụng, không ghi đè âm thầm).
- **Warranty**: bảng riêng theo Job/Năm, bấm một dòng mở panel chi tiết bên cạnh (vẫn cuộn/chọn dòng khác được), nút
  **View info** xem đầy đủ trên màn hình lớn (có Edit, chuyển bản trước/sau), form đầy đủ trường, Pass che mặc định + mã hóa (Windows DPAPI),
  lọc khoảng ngày / theo tháng / quick filter, chọn Ngày nhận hoặc Ngày test, lọc Hãng, search, sort, ẩn/hiện cột, ảnh.
- **Experience**: theo Hãng (danh mục dùng chung), liên kết Project nội bộ hoặc nhập text, **Hyperlink** tới file/thư mục
  trên máy, **Link website** nhập tự do (là link thì mở, không phải link thì tìm kiếm trên trình duyệt), ảnh.
- **Kiến thức**: tổng hợp kiến thức theo Hãng hoặc *Kiến thức chung* — tiêu đề, nội dung, Mode Device, link, ảnh; tìm
  không dấu trong toàn bộ nội dung.
- **Ảnh**: ngoài nút *Thêm ảnh*, **kéo thả** file ảnh từ thư mục, hoặc chụp màn hình (Win+Shift+S) / copy ảnh rồi **Ctrl+V**;
  trong trình xem ảnh có *Sao chép ảnh* (Ctrl+C).
- **Settings**: Light/Dark, ngưỡng trạng thái có preview, Master Data theo **phân loại Job Chính** (EU / Tên SI / Hãng /
  Sale & Phòng ban) **/ Job Freelance** (Tình trạng, sắp xếp lên/xuống) — chống trùng, chặn xóa khi đang dùng (gán lại
  hoặc gỡ liên kết; Hãng chỉ Deactivate), quản lý năm (Job Chính), backup/restore, dung lượng ảnh, giới hạn XLSX.

### Thêm Tool app

1. Tạo component trong `src/renderer/tools/`, ví dụ `SubnetTool.tsx` (export một React component, không nhận props).
2. Thêm một mục vào `APP_TOOLS` trong `src/renderer/tools/registry.ts`:
   `{ id: 'subnet', name: 'Chia subnet', description: 'Tính dải IP cho camera', icon: Network, component: SubnetTool }`
   (`icon` lấy từ `lucide-react`; `id` dùng trong đường dẫn `#/tools/app/subnet`, đừng đổi sau khi phát hành).
3. Tool cần đọc/ghi dữ liệu thì thêm method vào `src/shared/api.ts` + `src/main/handlers.ts` như các tính năng khác.

## Kiểm thử

```bash
npm test        # unit + service test (status TC-001..008/013, tìm không dấu, XLSX, danh mục, năm, warranty, backup)
npm run e2e     # chạy app Electron thật bằng Playwright, chụp màn hình vào .e2e-data/shots
```

`npm run e2e` cần chạy `npm run build` trước. Kịch bản gồm cả kiểm tra hiệu năng NFR-001 với 1.100 dự án.

## Kiến trúc

| Layer | Thư mục |
|-------|---------|
| Domain (pure TS, dùng chung) | `src/shared/` — `status.ts` (Phụ lục A), `text.ts` (bỏ dấu), `validation.ts`, `xlsxMapping.ts`, `dates.ts` |
| Persistence | `src/main/db/` — sql.js (SQLite WASM), migrations theo `PRAGMA user_version` |
| Application services | `src/main/services/` — settings, master data & năm, projects & import, warranty & experience, backup |
| Desktop integration | `src/main/integration/` (file, XLSX, ảnh), `platform.ts` (mã hóa, thumbnail), `main.ts` (dialog, shell, IPC) |
| Presentation | `src/renderer/` — React + TypeScript; gọi main process qua `window.ppm.call` (contextIsolation, sandbox) |

Hợp đồng IPC nằm ở `src/shared/api.ts`; main process chỉ chấp nhận các method trong danh sách đó và chỉ mở file
đã được liên kết với một dự án.

## Các quyết định mặc định (điểm cần PO xác nhận – mục 14.2)

| ID | Áp dụng |
|----|---------|
| Q-01, Q-02 | Đơn vị thiết kế, Giai đoạn: **đã bỏ** (cột cũ trong database giữ nguyên, không còn hiển thị/sửa) |
| Q-03 | Priority mặc định **3** |
| Q-04 | Ngày tới hạn phải ≥ Ngày tiếp nhận; **dự án mới** có hạn < hôm nay (nhập bù) được lưu ở trạng thái Đã hoàn thành — chỉ dự án có hạn trong tương lai mới chuyển Khẩn cấp/quá hạn khi tới hạn |
| Q-05 | Tính theo **ngày lịch** |
| Q-06, Q-07 | Một file liên kết/dự án, chỉ lưu đường dẫn (không copy/upload) |
| Q-08 | Kéo thả chỉ hoàn thành / bỏ hoàn thành |
| Q-09 | Lưu `created_at` / `updated_at` / `completed_at` |
| Q-10 | Windows 10/11 desktop (Electron) |

Diễn giải thêm:

- Theo CR02, nhóm **Warranty** chứa *Warranty Record* (bảng riêng), còn Pre-sales/Post-sales chứa *Project*.
- Ngưỡng: Khẩn cấp phải **nhỏ hơn** Cần chú ý (FR-SET-003).
- Warranty Record cần ít nhất *Model* hoặc *Case no*; Experience bắt buộc *Date* và *Event*.
- Mật khẩu Warranty mã hóa bằng tài khoản Windows (DPAPI): restore backup sang **máy/tài khoản khác** sẽ không xem lại
  được mật khẩu cũ (các dữ liệu khác vẫn đầy đủ).
- Mở `.dwg` phụ thuộc AutoCAD (hoặc ứng dụng tương thích) được đặt làm ứng dụng mặc định cho đuôi `.dwg`.
