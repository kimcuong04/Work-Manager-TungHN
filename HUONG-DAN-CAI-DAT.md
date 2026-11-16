# Hướng dẫn tải và cài đặt Personal Project Manager

> **Lưu ý:** file cài đặt `.exe` **không nằm trong mã nguồn** của repo (thư mục code bạn thấy trên GitHub).
> Nó được GitHub tự build mỗi lần phát hành và đính kèm ở trang **Releases**. Nút xanh *Code › Download ZIP*
> chỉ tải mã nguồn, không chạy được trực tiếp.

## 1. Tải và cài đặt (dành cho người dùng)

1. Mở trang phát hành mới nhất:
   **https://github.com/kimcuong04/Work-Manager-TungHN/releases/latest**
2. Kéo xuống mục **Assets**, bấm vào file **`PersonalProjectManager-Setup-x.y.z.exe`** để tải về
   (x.y.z là số phiên bản, ví dụ `1.2.0`). Không cần tải `latest.yml` hay `Source code`.
3. Mở file vừa tải. Lần đầu Windows có thể hiện **“Windows protected your PC”** vì ứng dụng chưa có chữ ký số:
   bấm **More info › Run anyway**.
4. Làm theo trình cài đặt (có thể đổi thư mục cài). Ứng dụng cài cho tài khoản Windows hiện tại, **không cần quyền Admin**.
5. Mở ứng dụng bằng shortcut **Personal Project Manager** trên Desktop hoặc Start Menu.

Yêu cầu: Windows 10/11 64-bit. Không cần Internet để sử dụng; chỉ cần Internet khi tải bản cập nhật.

## 2. Cập nhật phiên bản mới

Không cần tải lại thủ công. Khi có bản mới, ứng dụng tự tải ngầm rồi hiện **chấm đỏ trên biểu tượng chuông** ở góc phải
thanh trên cùng (không tự bật hộp thoại). Bấm vào chuông để xem bản mới và danh sách thay đổi:

- Bấm **Cập nhật & khởi động lại** → ứng dụng tự cài và mở lại (khoảng 10–30 giây).
- Bấm **Xem chi tiết** để đọc đầy đủ ghi chú thay đổi.
- Chưa cập nhật ngay → bản mới tự được cài khi bạn đóng ứng dụng; chấm đỏ vẫn còn cho tới lúc đó.

Kiểm tra thủ công hoặc bật/tắt tự kiểm tra: **Settings › Dữ liệu & Backup › Cập nhật phần mềm**.

> Bản **portable** (file chạy không cần cài) **không tự cập nhật được** — hãy dùng bản Setup.

## 3. Dữ liệu của bạn

- Dữ liệu lưu trên máy, mặc định tại `%APPDATA%\Personal Project Manager\data` (dán đường dẫn này vào thanh địa chỉ của
  File Explorer để mở). Ứng dụng không gửi dữ liệu dự án hay file đi đâu.
- **Chuyển dữ liệu sang ổ khác** (ví dụ ổ D: cho đỡ chật ổ C): **Settings › Dữ liệu & Backup › Thư mục dữ liệu ›
  Đổi thư mục dữ liệu…** → chọn thư mục mới. Ứng dụng chép toàn bộ database, ảnh, backup sang đó, kiểm tra đủ rồi tự khởi
  động lại và dùng thư mục mới. Bản cũ ở vị trí cũ được giữ lại; khi đã kiểm tra dữ liệu ở vị trí mới đầy đủ, bấm
  **Chuyển vào Thùng rác** để dọn. Muốn quay lại thì bấm **Về thư mục mặc định**.
- Nếu thư mục dữ liệu nằm trên ổ ngoài/USB mà lúc mở app chưa cắm, ứng dụng sẽ hỏi: **Thử lại** (sau khi cắm ổ),
  **Chọn thư mục dữ liệu…**, **Dùng thư mục mặc định** hoặc **Thoát** — không tự tạo dữ liệu trống.
- **Cập nhật, gỡ cài đặt hay cài lại đều không làm mất dữ liệu.**
- Ứng dụng tự giữ bản sao database của 10 lần mở gần nhất và trước mỗi lần nâng cấp, trong thư mục `backups`.
- Nên **Xuất backup** định kỳ ra USB/ổ khác: **Settings › Dữ liệu & Backup › Xuất backup…** (file `.zip` gồm database và ảnh).

### Đang dùng bản portable, chuyển sang bản Setup

Đóng bản portable → cài bản Setup như mục 1 → mở ứng dụng: dữ liệu cũ hiện ra ngay (hai bản dùng chung thư mục dữ liệu).
Sau đó có thể xóa file portable.

### Chuyển sang máy tính khác

1. Máy cũ: **Settings › Dữ liệu & Backup › Xuất backup…**, chép file `.zip` sang máy mới.
2. Máy mới: cài ứng dụng như mục 1, mở **Settings › Dữ liệu & Backup › Khôi phục từ backup…** và chọn file `.zip`.

> Mật khẩu thiết bị trong Warranty được mã hóa theo tài khoản Windows, nên sau khi chuyển máy sẽ không xem lại được
> mật khẩu cũ (mọi dữ liệu khác vẫn đầy đủ).

## 4. Gỡ cài đặt

**Settings của Windows › Apps › Installed apps › Personal Project Manager › Uninstall.**
Dữ liệu vẫn được giữ trong `%APPDATA%\Personal Project Manager` (hoặc thư mục bạn đã chọn ở Settings › Thư mục dữ liệu);
xóa thư mục đó nếu muốn xóa hẳn dữ liệu.

## 5. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Bấm “Mở file” với `.dwg` báo lỗi | Cài AutoCAD (hoặc DWG TrueView) và đặt làm ứng dụng mặc định cho đuôi `.dwg`: chuột phải file `.dwg` › Open with › Choose another app › tick *Always*. |
| File liên kết báo “không tồn tại” | File đã bị di chuyển/đổi tên — vào chi tiết dự án bấm **Chọn lại**. |
| Không thấy thông báo cập nhật | Kiểm tra Internet; vào Settings › Dữ liệu & Backup bấm **Kiểm tra cập nhật**; đảm bảo đang dùng bản Setup, không phải portable. |
| Windows chặn khi cài | Bấm **More info › Run anyway** (ứng dụng chưa ký số). |
| Mở app báo “Không tìm thấy thư mục dữ liệu” | Thư mục dữ liệu đã chuyển sang ổ khác/USB chưa được cắm hoặc bị đổi tên: cắm ổ rồi bấm **Thử lại**, hoặc **Chọn thư mục dữ liệu…** (thư mục có file `ppm.sqlite`). |
| Ứng dụng báo không khởi động được sau khi cập nhật | Chọn **Tải bản sửa lỗi & cài đặt** trong hộp thoại; dữ liệu gốc không bị thay đổi. |

## 6. Dành cho người phát triển: chạy từ mã nguồn

Yêu cầu: Windows 10/11, [Git](https://git-scm.com/), [Node.js](https://nodejs.org/) 20 trở lên (khuyến nghị 24).

```bash
git clone https://github.com/kimcuong04/Work-Manager-TungHN.git
cd Work-Manager-TungHN
npm ci
npm run dev
```

`npm run dev` dùng dữ liệu thử riêng ở thư mục `.dev-data`, không ảnh hưởng dữ liệu của bản đã cài.

| Lệnh | Tác dụng |
|---|---|
| `npm run build` rồi `npm start` | Chạy bản build hoàn chỉnh từ mã nguồn |
| `npm test` | Chạy unit test |
| `npm run dist` | Tự build file cài `release/PersonalProjectManager-Setup-x.y.z.exe` trên máy mình |

Quy trình phát hành bản cập nhật cho người dùng xem trong [README.md](README.md#tự-cập-nhật-qua-github).
