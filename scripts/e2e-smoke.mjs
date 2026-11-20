// Smoke test end-to-end: chạy app Electron thật (bản build), thao tác UI và chụp màn hình vào .e2e-data/shots.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';

const root = path.resolve('.e2e-data');
const dataDir = path.join(root, 'data');
const shots = path.join(root, 'shots');
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return iso(d);
};

const projectsRoot = path.join(root, 'projects');
fs.mkdirSync(projectsRoot, { recursive: true });
const fixtures = path.join(root, 'fixtures');
fs.mkdirSync(fixtures, { recursive: true });
const dwg = path.join(fixtures, 'Bản vẽ mặt bằng tầng 1.dwg');
fs.writeFileSync(dwg, 'fake dwg');
const xlsxFile = path.join(fixtures, 'Bao gia XYZ.xlsx');
{
  const wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add('Project Info', [
    ['Field', 'Value'],
    ['Tên Dự án', 'Chuỗi cửa hàng XYZ – Camera AI'],
    ['Tên SI', 'SI Alpha'],
    ['Sales phụ trách', 'Nguyễn Văn A'],
    ['Hãng', 'VCA, Veracity'],
    ['Ngày nhận', '16/11/2026'],
    ['Ngày deadline', '30/11/2026'],
    ['Ngày hoàn thành', ''],
  ]);
  add('Requirements', [
    ['Round', 'Content', 'Date'],
    [1, 'Báo giá hệ thống camera AI cho 55 cửa hàng.\nYêu cầu nhận diện khuôn mặt.', '16/11/2026'],
    [2, 'Bổ sung máy chủ VMS và license.', '20/11/2026'],
  ]);
  add('Equipment', [
    ['Model', 'Brand', 'Description'],
    ['IPAi685S-MR', 'VCA', 'Cam VCA'],
    ['VCAfaceIP', 'VCA', 'Bản quyền phần mềm nhận diện khuôn mặt'],
    ['COLDSTORE 2U', 'Veracity', 'Máy chủ VMS quản lý 55 camera/cửa hàng'],
  ]);
  fs.writeFileSync(xlsxFile, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
const png = path.join(fixtures, 'anh-loi.png');
fs.writeFileSync(
  png,
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAQ0lEQVR4nO3OMQ0AMAzAsPAnvRHYOS1SgPhv9fYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeHgB3hYBf5Xk9bwAAAAASUVORK5CYII=',
    'base64',
  ),
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    env: { ...process.env, PPM_DATA_DIR: dataDir, VITE_DEV_SERVER_URL: '' },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 880 });
  await win.waitForSelector('.sidebar', { timeout: 20000 });
  return { app, win };
}

const stubOpen = (app, files) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f });
  }, files);
const stubSave = (app, file) =>
  app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
const call = (win, method, ...args) =>
  win.evaluate(
    async ([m, a]) => {
      const r = await window.ppm.call(m, a);
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
    [method, args],
  );
// Không ghi vào clipboard thật của Windows (người dùng có thể đang copy/paste): giả lập clipboard trong main
// và bắn sự kiện paste có ảnh trong renderer.
const fakeClipboardImage = (app, file) =>
  app.evaluate(({ clipboard, nativeImage, ClipboardItem }, f) => {
    const data = nativeImage.createFromPath(f).toPNG();
    clipboard.read = async () => [new ClipboardItem({ 'image/png': new Blob([new Uint8Array(data)], { type: 'image/png' }) })];
  }, file);
const pasteImageEvent = (win) =>
  win.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'clip.png', { type: 'image/png' }));
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
const shot = (win, name) => win.screenshot({ path: path.join(shots, `${name}.png`) });
const go = (win, hash) => win.evaluate((h) => (window.location.hash = h), hash);
const toastText = async (win) => (await win.locator('.toast').last().innerText().catch(() => '')).trim();

let { app, win } = await launch();
const consoleErrors = [];
win.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
win.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  await shot(win, '01-dashboard-empty');
  check('Dashboard empty state', await win.getByText('Bạn chưa có dự án nào').isVisible());

  // --- Tạo dự án qua UI (FR-PROJ-004, FR-FORM-002) ---
  await win.getByRole('button', { name: 'Thêm Project đầu tiên' }).click();
  await win.locator('#pf-name').fill('Nhà máy Đông Á – Thiết kế kỹ thuật PCCC');
  check('Form mới: STT tự gợi ý = 1', (await win.locator('#pf-stt').inputValue()) === '1');
  const combos = win.locator('.form-section').nth(1).locator('input[role="combobox"]');
  await combos.nth(0).click();
  await combos.nth(0).fill('SI Alpha');
  await win.getByRole('button', { name: /Thêm SI “SI Alpha”/ }).click();
  await win.waitForTimeout(250);
  await combos.nth(1).click();
  await combos.nth(1).fill('Hikvision');
  await win.getByRole('button', { name: /Thêm Hãng “Hikvision”/ }).click();
  await win.waitForTimeout(250);
  await combos.nth(1).fill('Axis');
  await win.getByRole('button', { name: /Thêm Hãng “Axis”/ }).click();
  await win.waitForTimeout(250);
  await win.locator('#pf-name').click();
  await combos.nth(3).click();
  await combos.nth(3).fill('Công ty Hòa Bình');
  await win.getByRole('button', { name: /Thêm EU “Công ty Hòa Bình”/ }).click();
  await win.waitForTimeout(250);
  const dueInput = win.locator('.form-section').nth(2).locator('input.input').nth(1);
  await dueInput.fill(day(1).split('-').reverse().join('/'));
  await dueInput.press('Tab');
  await win.getByRole('button', { name: 'Tạo dự án' }).click();
  await win.waitForTimeout(200);
  check('Tick “Tạo thư mục mới” thì phải chọn nơi lưu (hoặc bỏ tick)', await win.getByText(/Chọn nơi lưu, hoặc bỏ tick/).isVisible());
  await stubOpen(app, [projectsRoot]);
  await win.getByRole('button', { name: /Chọn nơi lưu/ }).click();
  await win.waitForTimeout(250);
  const previewName = await win.locator('.folder-name').innerText();
  const formText = await win.locator('.modal').innerText();
  check('Form dự án không còn Đơn vị thiết kế / Giai đoạn', !/Đơn vị thiết kế|Giai đoạn/.test(formText));
  await win.locator('.section-toggle').click();
  await stubOpen(app, [dwg]);
  await win.getByRole('button', { name: /Chọn file \.dwg/ }).click();
  await win.waitForTimeout(300);
  await shot(win, '02-project-form');
  await win.getByRole('button', { name: 'Tạo dự án' }).click();
  await win.waitForTimeout(600);
  check('Tạo dự án qua form', (await toastText(win)).includes('Đã tạo dự án'), await toastText(win));
  const expectFolder = path.join(projectsRoot, '1.Nhà máy Đông Á – Thiết kế kỹ thuật PCCC_SI Alpha_Hikvision-Axis');
  check('Tự tạo thư mục "STT.Tên dự án_Tên SI_Hãng"', previewName === path.basename(expectFolder) && fs.existsSync(expectFolder), previewName);

  // --- Seed thêm dữ liệu qua IPC ---
  const years = await call(win, 'listYears');
  const main = years.find((y) => y.jobType === 'MAIN');
  const cl2 = await call(win, 'createMaster', 'clients', 'Tập đoàn Vingroup');
  const cl3 = await call(win, 'createMaster', 'clients', 'Sở Xây dựng HN');
  const base = { jobYearId: main.id, workCategory: 'PRE_SALES', receivedDate: day(-10), note: '', filePath: null, fileName: null, fileExtension: null };
  const specs = [
    ['Trường THCS Ngô Quyền – camera', cl2, -2, 1, 'PRE_SALES'],
    ['Bệnh viện Đa khoa tỉnh – hệ thống mạng', cl3, 0, 2, 'POST_SALES'],
    ['Khu đô thị Ocean Park – thiết kế cơ sở', cl2, 3, 1, 'PRE_SALES'],
    ['Văn phòng ABC – nâng cấp wifi', cl3, 5, 4, 'POST_SALES'],
    ['Nhà xưởng KCN Bắc Ninh', cl2, 9, 3, 'PRE_SALES'],
    ['Showroom Ô tô Thành Công', cl3, 20, 5, 'POST_SALES'],
  ];
  const created = [];
  for (const [name, c, due, prio, cat] of specs)
    created.push(await call(win, 'createProject', { ...base, projectName: name, clientId: c.id, dueDate: day(due), priorityPoint: prio, workCategory: cat }));
  const fl = await call(win, 'createProject', { ...base, workCategory: 'POST_SALES', projectName: 'Kho xưởng – bản vẽ shopdrawing', clientId: cl2.id, dueDate: day(12), priorityPoint: 2 });
  const legacyKind = await call(win, 'listMaster', 'stages').then(() => 'còn', (e) => String(e.message ?? e));
  check('API không còn danh mục Giai đoạn', /không hợp lệ/.test(legacyKind), legacyKind);
  await call(win, 'setProjectCompleted', created[5].id, true);
  check('Dự án mới nhập với ngày tới hạn đã qua → Đã hoàn thành', created[0].isCompleted === true && created.slice(1).every((x) => !x.isCompleted));
  // Đưa lại về hoạt động để có một dự án quá hạn (Khẩn cấp) cho các bước sau.
  await call(win, 'setProjectCompleted', created[0].id, false);
  await win.reload();
  await win.waitForSelector('.sidebar');

  await go(win, '#/');
  await win.waitForTimeout(400);
  await shot(win, '03-dashboard-light');
  const kpiUrgent = await win.locator('.kpi.st-URGENT .kpi-value').innerText();
  check('KPI Khẩn cấp = 3 (hôm qua/hôm nay/ngày mai)', kpiUrgent === '3', kpiUrgent);

  // --- KPI → Tất cả mục với bộ lọc (FR-DASH-005) ---
  await win.locator('.kpi.st-URGENT').click();
  await win.waitForTimeout(400);
  const cols = await win.locator('.board-col').count();
  check('Click KPI mở Tất cả mục lọc theo Khẩn cấp', cols === 1, `cột hiển thị: ${cols}`);

  // --- Search không dấu (AC-007) ---
  await win.getByRole('button', { name: /Xóa bộ lọc/ }).click();
  await win.getByPlaceholder(/Tìm STT, tên dự án/).fill('thiet ke ky thuat');
  await win.waitForTimeout(300);
  const found = await win.locator('.pcard-title').allInnerTexts();
  check("Tìm không dấu 'thiet ke ky thuat' ra 'Thiết kế kỹ thuật'", found.length === 1 && found[0].includes('Thiết kế kỹ thuật'), found.join(' | '));
  await win.getByPlaceholder(/Tìm STT, tên dự án/).fill('thiet ke');
  await win.waitForTimeout(300);
  const foundTk = await win.locator('.pcard').count();
  check("Tìm 'thiet ke' khớp tên 2 dự án có 'thiết kế'", foundTk === 2, `${foundTk} thẻ`);
  await win.getByPlaceholder(/Tìm STT, tên dự án/).fill('');
  await shot(win, '04-all-board');

  // --- Kéo thả bị khóa ở chế độ xem; bật Chỉnh sửa Board rồi kéo sang Hoàn thành (AC-005/006, FR-PROJ-010) ---
  const firstCard = win.locator('.board-col.st-URGENT .pcard').first();
  check('Chế độ xem: thẻ không draggable', (await firstCard.getAttribute('draggable')) === 'false');
  await win.getByRole('button', { name: /Chỉnh sửa Board/ }).click();
  const cardName = await firstCard.locator('.pcard-title').innerText();
  await firstCard.dragTo(win.locator('.board-col.st-ATTENTION'));
  await win.waitForTimeout(300);
  check('Kéo giữa cột thời hạn bị từ chối', (await toastText(win)).includes('Không thể kéo'), await toastText(win));
  await firstCard.dragTo(win.locator('.board-col.st-COMPLETED'));
  await win.getByRole('button', { name: 'Hoàn thành', exact: true }).click();
  await win.waitForTimeout(200);
  await shot(win, '05-board-edit-pending');
  await win.getByRole('button', { name: /Lưu & thoát/ }).click();
  await win.waitForTimeout(500);
  const doneTitles = await win.locator('.board-col.st-COMPLETED .pcard-title').allInnerTexts();
  check('Kéo sang Đã hoàn thành + xác nhận + lưu', doneTitles.includes(cardName), cardName);

  // --- v1.3: Pre-sales mặc định dạng Danh sách, chuyển được sang Tiến độ ---
  await go(win, `#/job/MAIN/${main.id}/pre-sales`);
  await win.waitForTimeout(400);
  const listRows = await win.locator('.project-table tbody tr').count();
  check('Pre-sales mặc định hiển thị Danh sách', listRows === 4 && (await win.locator('.board-col').count()) === 0, `${listRows} dòng`);
  await shot(win, '04b-presales-list');
  await win.getByRole('button', { name: 'Tiến độ', exact: true }).click();
  await win.waitForTimeout(200);
  check('Chuyển sang chế độ Tiến độ (board 4 cột)', (await win.locator('.board-col').count()) === 4);
  await win.getByRole('button', { name: 'Danh sách', exact: true }).click();
  await win.waitForTimeout(200);
  await win.locator('.project-table th', { hasText: 'Ngày tới hạn' }).click();
  const firstDue = await win.locator('.project-table tbody tr').first().locator('td').nth(8).innerText();
  check('Bấm tiêu đề cột để sắp xếp', firstDue.includes('/'), firstDue.split('\n')[0]);
  const heads = (await win.locator('.project-table th').allInnerTexts()).map((t) => t.replace(/[▲▼]/g, '').trim()).filter(Boolean);
  check('Danh sách có STT / Tên dự án / Tên SI / Hãng / Sale / EU', ['STT', 'Tên dự án', 'Tên SI', 'Hãng', 'Sale', 'EU'].every((h) => heads.includes(h)), heads.join(' | '));
  await win.locator('.project-table tbody tr', { hasText: 'Nhà máy Đông Á' }).click();
  await win.waitForTimeout(250);
  const panel = win.locator('.side-panel');
  check(
    'Pre-sales: panel xem nhanh bên phải có View info / Edit',
    (await panel.isVisible()) && (await panel.getByRole('button', { name: 'View info' }).isVisible()) && (await panel.getByRole('button', { name: 'Edit' }).isVisible()) && (await win.locator('.overlay').count()) === 0,
  );
  await shot(win, '04d-presales-panel');
  await panel.getByRole('button', { name: 'Đóng panel' }).click();
  await win.getByRole('button', { name: /^Cột/ }).click();
  const colBox = await win.locator('.popover').first().boundingBox();
  const sideBox = await win.locator('.sidebar').boundingBox();
  check('Popover "Cột" không bị sidebar che', !!colBox && !!sideBox && colBox.x >= sideBox.x + sideBox.width, `popover x=${Math.round(colBox?.x ?? -1)}, sidebar đến ${Math.round((sideBox?.x ?? 0) + (sideBox?.width ?? 0))}`);
  await shot(win, '04e-column-popover');
  await win.keyboard.press('Escape');
  await win.locator('h1').first().click();
  check('Sidebar không còn xổ danh sách dự án', (await win.locator('.sidebar a[href*="#/project/"]').count()) === 0);
  await win.getByRole('button', { name: /Thêm Project vào Pre-sales/ }).click();
  await win.waitForSelector('.modal');
  const newReceived = win.locator('.form-section').nth(2).locator('input.input').nth(0);
  await newReceived.fill(day(-20).split('-').reverse().join('/'));
  await newReceived.press('Tab');
  const newDue = win.locator('.form-section').nth(2).locator('input.input').nth(1);
  await newDue.fill(day(-1).split('-').reverse().join('/'));
  await newDue.press('Tab');
  await win.waitForTimeout(200);
  const preview = await win.locator('.modal .badge.status').first().innerText();
  check('Form thêm mới: hạn đã qua → xem trước "Đã hoàn thành"', preview.includes('Đã hoàn thành') && (await win.getByText(/sẽ được lưu ở trạng thái Đã hoàn thành/).isVisible()), preview);
  await shot(win, '04c-new-past-due');
  await win.locator('.modal-foot').getByRole('button', { name: 'Hủy' }).click();
  await win.getByRole('button', { name: 'Bỏ thay đổi' }).click();
  await win.waitForTimeout(200);

  // --- v1.3: sửa dự án → Salesperson + 3 lựa chọn lưu ---
  await go(win, `#/project/${created[0].id}`);
  await win.waitForTimeout(400);
  await win.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
  await win.waitForSelector('.modal');
  const salesCombo = win.locator('.form-section').nth(1).locator('input[role="combobox"]').nth(2);
  await salesCombo.click();
  await salesCombo.fill('Anh Tuấn Sale');
  await win.getByRole('button', { name: /Thêm Sale “Anh Tuấn Sale”/ }).click();
  await win.waitForTimeout(400);
  const footBtns = (await win.locator('.modal-foot button').allInnerTexts()).map((t) => t.trim());
  check('Form sửa dự án có Hủy / Lưu / Lưu và thêm vào Calendar', JSON.stringify(footBtns) === JSON.stringify(['Hủy', 'Lưu', 'Lưu và thêm vào Calendar']), footBtns.join(' | '));
  const greenBg = await win.locator('.modal-foot .btn.success').evaluate((el) => getComputedStyle(el).backgroundColor);
  check('Nút "Lưu và thêm vào Calendar" màu xanh', /rgb\(47, 143, 70\)/.test(greenBg), greenBg);
  await shot(win, '07c-edit-three-buttons');
  await win.getByRole('button', { name: /Lưu và thêm vào Calendar/ }).click();
  await win.waitForTimeout(600);
  check('Lưu và thêm vào Calendar thành công', (await toastText(win)).includes('thêm vào Calendar'), await toastText(win));
  const timelineUpd = await win.locator('.timeline-item', { hasText: 'Cập nhật dự án' }).count();
  const timelineNote = await win.locator('.timeline-item', { hasText: 'Cập nhật dự án' }).first().innerText().catch(() => '');
  check('Chi tiết dự án: Sale + lịch sử Calendar có mục Cập nhật', (await win.getByText('Anh Tuấn Sale').first().isVisible()) && timelineUpd === 1 && timelineNote.includes('Sale: — → Anh Tuấn Sale'), timelineNote.replace(/\n/g, ' / '));
  await shot(win, '07d-detail-calendar-card');

  // --- Ghi chú theo ngày: định dạng tự do + dán ảnh Ctrl+V ---
  await win.getByRole('button', { name: 'Ghi chú hôm nay', exact: true }).click();
  await win.locator('.note-editing .note-editor').click();
  await win.keyboard.type('Khảo sát hiện trường: ');
  await win.keyboard.press('Control+B');
  await win.keyboard.type('cần thêm 2 camera');
  await win.keyboard.press('Control+B');
  await win.keyboard.press('Enter');
  fs.writeFileSync(png, await win.screenshot());
  await fakeClipboardImage(app, png);
  await pasteImageEvent(win);
  await win.waitForSelector('.note-editing .note-editor img', { timeout: 5000 }).catch(() => {});
  await shot(win, '07e-note-editing');
  await win.locator('.note-editing').getByRole('button', { name: 'Lưu', exact: true }).click();
  await win.waitForTimeout(600);
  const boldCount = await win.locator('.note-entry .note-content b').count();
  const noteImgs = await win.locator('.note-entry .note-content img').count();
  check('Ghi chú hôm nay: chữ đậm + ảnh dán Ctrl+V được lưu', boldCount >= 1 && noteImgs === 1, `${boldCount} đoạn đậm, ${noteImgs} ảnh`);
  // --- v1.12: ảnh trong ghi chú — kéo góc đổi cỡ, chuột phải nhập tỉ lệ, căn lề ---
  {
    const todayLbl = day(0).split('-').reverse().join('/');
    await win.getByRole('button', { name: `Sửa ghi chú ngày ${todayLbl}` }).click();
    const edImg = win.locator('.note-editing .note-editor img').first();
    await edImg.waitFor();
    await win.waitForTimeout(300);
    await edImg.click();
    await win.waitForSelector('.note-editing .img-handle');
    await win.locator('.note-editing .note-editor').evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await win.waitForTimeout(200);
    const w0 = (await edImg.boundingBox()).width;
    const hb = await win.locator('.note-editing .img-handle').boundingBox();
    await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await win.mouse.down();
    await win.mouse.move(hb.x - 120, hb.y + hb.height / 2, { steps: 8 });
    await win.mouse.up();
    const w1 = (await edImg.boundingBox()).width;
    const dragAttr = await edImg.getAttribute('width');
    await edImg.click({ button: 'right' });
    await win.waitForSelector('.img-menu');
    const scaleInput = win.locator('.img-menu input[aria-label="Tỉ lệ ảnh"]');
    await scaleInput.fill('0.123');
    await win.locator('.img-menu').getByRole('button', { name: 'Áp dụng' }).click();
    const errTxt = await win.locator('.img-menu .field-error').innerText().catch(() => '');
    await scaleInput.fill('0,5');
    await win.locator('.img-menu').getByRole('button', { name: 'Áp dụng' }).click();
    await win.locator('.img-menu').getByRole('button', { name: 'Căn giữa' }).click();
    const nat = await edImg.evaluate((i) => i.naturalWidth);
    const wAttr = await edImg.getAttribute('width');
    await shot(win, '58-note-image-resize');
    await win.locator('.note-editing').getByRole('button', { name: 'Lưu', exact: true }).click();
    await win.waitForTimeout(600);
    const savedNote = (await call(win, 'listProjectNotes', created[0].id)).find((n) => n.noteDate === day(0));
    const shownAlign = await win.locator('.note-entry .note-content img').first().getAttribute('data-align');
    check(
      'Ảnh trong ghi chú: kéo góc để thu nhỏ, chuột phải nhập tỉ lệ (tối đa 2 chữ số thập phân), căn giữa — được lưu',
      w1 < w0 - 80 && !!dragAttr && /2 chữ số/.test(errTxt) && Number(wAttr) === Math.round(nat * 0.5) &&
        /data-scale="0.5"/.test(savedNote?.html ?? '') && /data-align="center"/.test(savedNote?.html ?? '') && shownAlign === 'center',
      `kéo ${Math.round(w0)}→${Math.round(w1)}px · tỉ lệ 0.5 = ${wAttr}px (gốc ${nat}px)`,
    );
  }
  await call(win, 'saveProjectNote', created[0].id, { noteDate: day(-3), html: '<div>Gửi báo giá lần 1</div>' });
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, `#/project/${created[0].id}`);
  await win.waitForSelector('.note-entry');
  const entries = await win.locator('.note-entry').count();
  const oldLabel = day(-3).split('-').reverse().join('/');
  await win.getByRole('button', { name: `Sửa ghi chú ngày ${oldLabel}` }).click();
  await win.locator('.note-editing .note-editor').click();
  await win.keyboard.press('Control+End');
  await win.keyboard.type(' (đã gọi lại)');
  await win.locator('.note-editing').getByRole('button', { name: 'Lưu', exact: true }).click();
  await win.waitForTimeout(500);
  const oldText = await win.locator('.note-entry', { hasText: oldLabel }).innerText();
  check('Ghi chú lưu theo ngày, sửa được ghi chú ngày cũ', entries === 2 && oldText.includes('Gửi báo giá lần 1 (đã gọi lại)'), `${entries} ngày`);
  const [attW, noteW] = await win.evaluate(() => [...document.querySelector('.notes-row').children].map((c) => c.getBoundingClientRect().width));
  check('Panel Ghi chú rộng hơn hẳn panel Attachments', noteW > attW * 1.8, `${Math.round(attW)} px / ${Math.round(noteW)} px`);
  await win.locator('.notes-card').scrollIntoViewIfNeeded();
  await shot(win, '07f-notes-panel');

  // --- Chi tiết + Import XLSX (FR-XLSX) ---
  await go(win, `#/project/${created[2].id}`);
  await win.waitForTimeout(400);
  await stubOpen(app, [xlsxFile]);
  await win.getByRole('button', { name: 'Import .xlsx' }).click();
  await win.waitForSelector('.wizard', { timeout: 10000 });
  await win.waitForTimeout(300);
  await shot(win, '06-import-wizard');
  check(
    'Import chỉ còn bảng Thiết bị, bỏ A/B và tab Dữ liệu sheet',
    (await win.getByRole('button', { name: 'Dữ liệu sheet' }).count()) === 0 && (await win.getByText('A. Thông tin dự án').count()) === 0 && (await win.getByText('B. Nội dung yêu cầu').count()) === 0,
  );
  await win.getByRole('button', { name: 'Xác nhận Import' }).click();
  await win.waitForTimeout(600);
  check('Import XLSX thành công (3 thiết bị)', (await win.getByText('COLDSTORE 2U').isVisible()) && (await win.locator('.req-round').count()) === 0);
  await shot(win, '07-project-detail-imported');

  // --- v1.10 + v1.13/v1.14: Import thêm nhiều bảng xlsx — mỗi bảng là một tab sheet kiểu Excel, thanh tab ở trên bảng ---
  {
    const pid = created[2].id;
    const tabNames = async () => (await win.locator('.xl-tabs [role="tab"]').allInnerTexts()).map((t) => t.trim());
    const activeTab = async () => (await win.locator('.xl-tab[aria-selected="true"]').innerText()).trim();
    const apiNames = async () => (await call(win, 'listProjectImports', pid)).map((i) => i.name).join('|');
    await stubOpen(app, [xlsxFile]);
    await win.getByRole('button', { name: 'Import thêm xlsx' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    const addTitle = await win.locator('.modal-head, .modal h2').first().innerText().catch(() => '');
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.waitForTimeout(700);
    let imps = await call(win, 'listProjectImports', pid);
    const names1 = await tabNames();
    const active1 = await activeTab();
    await win.locator('.xl-book').scrollIntoViewIfNeeded();
    const sheetBox = await win.locator('.xl-sheet').boundingBox();
    const barBox = await win.locator('.xl-tabbar').boundingBox();
    await shot(win, '54-project-imports-tabs');
    check(
      'Import thêm xlsx: mỗi bảng là một tab sheet (kiểu Excel), thanh tab nằm phía trên bảng, tên theo file, trùng thì thêm (2); bảng mới tự mở',
      imps.length === 2 && /Import thêm/.test(addTitle) && names1.join('|') === 'Bao gia XYZ|Bao gia XYZ (2)' && active1 === 'Bao gia XYZ (2)' && barBox.y + barBox.height <= sheetBox.y + 2,
      `${names1.join(' | ')} · đang mở: ${active1}`,
    );

    await win.locator('.xl-tab').nth(0).click();
    const infoName = (await win.locator('.xl-info .ellipsis').first().innerText()).trim();
    await win.locator('.xl-tab').nth(0).dblclick();
    await win.locator('.xl-tab-edit').fill('Camera tầng 1');
    await win.locator('.xl-tab-edit').press('Enter');
    await win.waitForTimeout(500);
    await win.locator('.xl-tab').nth(1).press('F2');
    await win.locator('.xl-tab-edit').fill('CAMERA TẦNG 1');
    await win.locator('.xl-tab-edit').press('Enter');
    await win.waitForTimeout(200);
    const dupToast = await win.locator('.toast.error').last().innerText().catch(() => '');
    const stillEditing = await win.locator('.xl-tab-edit').count();
    await win.locator('.xl-tab-edit').press('Escape');
    await win.locator('.xl-tab').nth(1).click({ button: 'right' });
    await win.waitForSelector('.xl-menu');
    await shot(win, '61-import-tab-menu');
    await win.locator('.xl-menu').getByRole('menuitem', { name: /Đổi tên/ }).click();
    await win.locator('.xl-tab-edit').fill('Máy chủ VMS');
    await win.locator('.xl-tab-edit').press('Enter');
    await win.waitForTimeout(500);
    const renamed = await apiNames();
    check(
      'Đổi tên tab: bấm đúp / F2 / chuột phải › Đổi tên; tên trùng (không phân biệt hoa thường) bị chặn',
      infoName === 'Bao gia XYZ' && /Đã có bảng tên/.test(dupToast) && stillEditing === 1 && renamed === 'Camera tầng 1|Máy chủ VMS' && (await tabNames()).join('|') === renamed,
      `${renamed} · "${dupToast}"`,
    );

    const rackFile = path.join(fixtures, 'Tu rack.xlsx');
    {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Model', 'Brand', 'Description'], ['RACK-42U', 'APC', 'Tủ rack 42U phòng server']]), 'Equipment');
      fs.writeFileSync(rackFile, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }
    await stubOpen(app, [rackFile]);
    await win.getByRole('button', { name: 'Thêm bảng mới (import xlsx)' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.waitForTimeout(700);
    const added = `${(await tabNames()).join('|')} › ${await activeTab()}`;
    await win.locator('.xl-tab').nth(2).dragTo(win.locator('.xl-tab').nth(0), { targetPosition: { x: 4, y: 10 } });
    await win.waitForTimeout(600);
    const afterDrag = await apiNames();
    await win.locator('.xl-tab').nth(0).click({ button: 'right' });
    await win.locator('.xl-menu').getByRole('menuitem', { name: 'Di chuyển sang phải' }).click();
    await win.waitForTimeout(500);
    const afterMenu = await apiNames();
    await win.locator('.xl-tab', { hasText: 'Tu rack' }).press('Alt+ArrowRight');
    await win.waitForTimeout(500);
    const afterKey = await apiNames();
    check(
      'Đổi thứ tự tab: kéo thả tab, chuột phải › Di chuyển sang phải, Alt + →; nút + thêm bảng mới ở cuối',
      added === 'Camera tầng 1|Máy chủ VMS|Tu rack › Tu rack' &&
        afterDrag === 'Tu rack|Camera tầng 1|Máy chủ VMS' &&
        afterMenu === 'Camera tầng 1|Tu rack|Máy chủ VMS' &&
        afterKey === 'Camera tầng 1|Máy chủ VMS|Tu rack' &&
        (await tabNames()).join('|') === afterKey,
      `${added} · kéo: ${afterDrag} · menu: ${afterMenu} · Alt+→: ${afterKey}`,
    );

    await win.locator('.xl-tab', { hasText: 'Máy chủ VMS' }).click();
    await win.reload();
    await win.waitForSelector('.sidebar');
    await win.waitForSelector('.xl-tab[aria-selected="true"]');
    const remembered = await activeTab();
    const searchModel = async (text) => {
      await win.locator('select[aria-label="Kiểu tìm kiếm"]').selectOption('model');
      await win.locator('.gsearch-input').fill(text);
      await win.waitForSelector('.gsearch-results .opt');
      await win.locator('.gsearch-results .opt', { hasText: created[2].projectName }).first().click();
      await win.waitForFunction(() => (CSS.highlights?.get('ppm-search')?.size ?? 0) > 0, null, { timeout: 5000 }).catch(() => undefined);
      await win.waitForTimeout(200);
      const hit = await win.evaluate(() => [...(CSS.highlights?.get('ppm-search') ?? [])].map((r) => r.toString()));
      return { tab: await activeTab(), hit, hash: await win.evaluate(() => location.hash) };
    };
    await go(win, '#/');
    await win.waitForTimeout(300);
    const fromHome = await searchModel('rack-42u');
    await win.locator('.page-head h1').click();
    await win.locator('.xl-tab', { hasText: 'Camera tầng 1' }).click();
    const samePage = await searchModel('rack-42u');
    await win.locator('.xl-book').scrollIntoViewIfNeeded();
    await shot(win, '62-import-tab-search');
    await win.locator('.page-head h1').click();
    await win.locator('.gsearch-input').fill('');
    await win.locator('select[aria-label="Kiểu tìm kiếm"]').selectOption('name');
    check(
      'Tab đang mở được nhớ; mở kết quả tìm Model → tự mở đúng tab có Model đó và tô sáng (cả khi đang ở sẵn trang dự án)',
      remembered === 'Máy chủ VMS' &&
        fromHome.hash === `#/project/${pid}` &&
        fromHome.tab === 'Tu rack' &&
        fromHome.hit.some((t) => t.toLowerCase() === 'rack-42u') &&
        samePage.tab === 'Tu rack' &&
        samePage.hit.length > 0,
      `nhớ: ${remembered} · từ Dashboard: ${fromHome.tab} (${fromHome.hit.join(', ')}) · tại trang: ${samePage.tab}`,
    );

    const vms = (await call(win, 'listProjectImports', pid)).find((i) => i.name === 'Máy chủ VMS');
    await win.locator('.xl-tab', { hasText: 'Máy chủ VMS' }).click();
    await stubOpen(app, [xlsxFile]);
    await win.getByRole('button', { name: 'Import lại bảng Máy chủ VMS' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.locator('.modal').getByRole('button', { name: 'Thay thế' }).click();
    await win.waitForTimeout(700);
    imps = await call(win, 'listProjectImports', pid);
    const replacedOk = imps.length === 3 && !imps.some((i) => i.id === vms.id) && imps[1].name === 'Máy chủ VMS' && (await activeTab()) === 'Máy chủ VMS';
    await win.locator('.xl-tab', { hasText: 'Camera tầng 1' }).click();
    await win.getByRole('button', { name: 'Gỡ bảng Camera tầng 1' }).click();
    await win.locator('.modal').getByRole('button', { name: 'Gỡ bảng' }).click();
    await win.waitForTimeout(500);
    imps = await call(win, 'listProjectImports', pid);
    const left = await activeTab();
    check(
      'Import lại giữ vị trí và tên tab đã đổi; Gỡ một bảng giữ các bảng còn lại, mở bảng bên cạnh',
      replacedOk && imps.map((i) => i.name).join('|') === 'Máy chủ VMS|Tu rack' && left === 'Máy chủ VMS' && (await win.getByText('COLDSTORE 2U').first().isVisible()),
      `còn ${imps.map((i) => i.name).join(' | ')} · đang mở: ${left}`,
    );
  }

  // --- Mở file DWG: không có ứng dụng .dwg thì báo lỗi có hướng xử lý (AC-010) ---
  await go(win, `#/project/${(await call(win, 'listProjects')).find((p) => p.filePath).id}`);
  await win.waitForTimeout(500);
  await shot(win, '08-project-detail-file');

  // --- Warranty ---
  const brand = (await call(win, 'listMaster', 'brands')).find((b) => b.name === 'Axis') ?? (await call(win, 'createMaster', 'brands', 'Axis'));
  const brand2 = await call(win, 'createMaster', 'brands', 'Allied Telesis');
  fs.writeFileSync(png, await win.screenshot());
  const [img] = await (async () => {
    await stubOpen(app, [png]);
    return call(win, 'pickImages');
  })();
  await call(win, 'createWarranty', {
    jobYearId: main.id, model: 'AXIS P3265-LVE', brandId: brand.id, ipAddress: '192.168.1.90', username: 'root', password: 'Axis@123',
    macAddress: 'AC:CC:8E:12:34:56', serialNumber: 'ACCC8E123456', receivedDate: day(-3), testedDate: day(-1),
    customerReport: 'Camera mất hình vào ban đêm', inspection: 'IR không hoạt động', result: 'Lỗi board IR', resolution: 'Đổi mới thiết bị (RMA)', caseNumber: 'RMA-2026-001', images: [img],
  });
  await call(win, 'createWarranty', {
    jobYearId: main.id, model: 'AT-GS950/28PS', brandId: brand2.id, ipAddress: '10.0.0.2', username: 'manager', password: 'friend',
    macAddress: '00:1A:EB:00:00:01', serialNumber: 'G1Q2W3', receivedDate: day(-40), testedDate: null,
    customerReport: 'Switch treo định kỳ', inspection: 'Firmware cũ', result: '', resolution: 'Nâng cấp firmware', caseNumber: 'RMA-2026-002', images: [],
  });
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, `#/job/MAIN/${main.id}/warranty`);
  await win.waitForTimeout(500);
  await shot(win, '09-warranty-table');
  await win.locator('select[aria-label="Khoảng thời gian"]').selectOption('thisMonth');
  await win.waitForTimeout(200);
  const rowsThisMonth = await win.locator('.tbl tbody tr.clickable').count();
  check('Lọc Warranty "Tháng này" theo Ngày nhận', rowsThisMonth >= 1 && rowsThisMonth <= 2, `${rowsThisMonth} dòng`);
  await win.locator('select[aria-label="Khoảng thời gian"]').selectOption('all');
  await win.getByText('RMA-2026-001').click();
  await win.waitForTimeout(300);
  check('Warranty: panel chi tiết cố định, không phủ mờ', (await win.locator('.side-panel').isVisible()) && (await win.locator('.drawer-wrap, .overlay').count()) === 0);
  await win.getByText('RMA-2026-002').click();
  await win.waitForTimeout(200);
  const panelTitle2 = await win.locator('.side-panel-head h2').innerText();
  check('Panel đang mở vẫn chọn được dòng khác', panelTitle2.includes('RMA-2026-002'), panelTitle2);
  await win.getByText('RMA-2026-001').click();
  await win.waitForTimeout(200);
  const masked = await win.locator('.side-panel code').innerText();
  check('Pass bị che mặc định (TC-WAR-006)', masked.includes('•'), masked);
  await win.getByRole('button', { name: 'Hiện mật khẩu' }).click();
  await win.waitForTimeout(200);
  check('Reveal pass hiển thị đúng', (await win.locator('.side-panel code').innerText()) === 'Axis@123');
  await win.waitForFunction(() => document.querySelector('.side-panel .thumb img')?.complete);
  const thumbW = await win.locator('.side-panel .thumb img').evaluate((el) => el.naturalWidth);
  check('Thumbnail ảnh hiển thị qua ppm-img:// (thumbnail 320px)', thumbW === 320, `naturalWidth=${thumbW}`);
  await win.locator('.side-panel .thumb').click();
  await win.waitForTimeout(300);
  const fullW = await win.locator('.lightbox img').evaluate((el) => el.naturalWidth);
  check('Preview ảnh gốc', fullW > 320, `naturalWidth=${fullW}`);
  await win.keyboard.press('Escape');
  await shot(win, '10-warranty-detail');
  await win.getByRole('button', { name: 'View info' }).click();
  await win.waitForSelector('.modal .view-info');
  check('View info: hiển thị đầy đủ, có nút Edit', (await win.locator('.modal .info-block').count()) === 4 && (await win.locator('.modal-foot').getByRole('button', { name: 'Edit' }).isVisible()));
  await shot(win, '10b-warranty-view-info');
  await win.locator('.modal-foot').getByRole('button', { name: 'Edit' }).click();
  await win.waitForTimeout(300);
  check('Edit từ View info mở form sửa', await win.getByText('Sửa Warranty Record').isVisible());

  // --- v1.3: dán ảnh (Ctrl+V) thẳng vào mục ảnh của form ---
  const thumbsBefore = await win.locator('.modal').last().locator('.thumbs .thumb').count();
  await fakeClipboardImage(app, png);
  await win.locator('.modal').last().locator('.form-section h3', { hasText: 'Ảnh' }).click();
  await pasteImageEvent(win);
  await win.waitForTimeout(800);
  const thumbsAfter = await win.locator('.modal').last().locator('.thumbs .thumb').count();
  check('Ctrl+V dán ảnh chụp màn hình vào form', thumbsAfter === thumbsBefore + 1, `${thumbsBefore} → ${thumbsAfter} ảnh`);
  await shot(win, '10c-warranty-paste');
  await win.getByRole('button', { name: 'Lưu', exact: true }).click();
  await win.waitForTimeout(500);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  check('Ảnh dán được lưu cùng bản ghi', (await win.locator('.side-panel .thumb').count()) === thumbsAfter, `${await win.locator('.side-panel .thumb').count()} ảnh trong panel`);
  await win.keyboard.press('Escape');

  // --- Experience ---
  await call(win, 'createExperience', {
    brandId: brand.id, experienceDate: day(0), projectId: created[2].id, projectText: null, deviceModel: 'P3265-LVE',
    event: 'Firmware 11.x làm mất cấu hình WDR sau khi reboot.\nGiải pháp: hạ về 10.12 LTS.', webUrl: 'https://www.axis.com/support', images: [img],
  });
  await call(win, 'createExperience', {
    brandId: brand.id, experienceDate: day(-35), projectId: null, projectText: 'Dự án cũ 2025', deviceModel: 'Q6135',
    event: 'PTZ bị rung khi gió mạnh, cần gia cố chân đế.', webUrl: '', images: [],
  });
  await go(win, '#/experience');
  await win.waitForTimeout(400);
  await shot(win, '11-experience-home');
  await go(win, `#/experience/${brand.id}`);
  await win.waitForTimeout(400);
  await shot(win, '12-experience-brand');

  // --- v1.3: Kiến thức ---
  await call(win, 'createKnowledge', {
    brandId: null, knowledgeDate: day(-2), title: 'Tính công suất PoE cho switch', deviceModel: '',
    content: 'PoE 802.3af: 15.4W/cổng\nPoE+ 802.3at: 30W/cổng\nCộng dồn và chừa 20% dự phòng.', webUrl: 'https://en.wikipedia.org/wiki/Power_over_Ethernet', images: [img],
  });
  await call(win, 'createKnowledge', {
    brandId: brand.id, knowledgeDate: day(-1), title: 'Reset camera Axis về mặc định', deviceModel: 'P3265-LVE',
    content: 'Giữ nút Control 15–30 giây khi cấp nguồn.', webUrl: '', images: [],
  });
  await go(win, '#/knowledge');
  await win.waitForTimeout(400);
  check('Trang Kiến thức có mục Kiến thức chung', await win.locator('.brand-card', { hasText: 'Kiến thức chung' }).isVisible());
  await win.getByPlaceholder(/Tìm Hãng hoặc nội dung/).fill('cong suat poe');
  await win.waitForTimeout(300);
  check('Tìm không dấu trong nội dung Kiến thức', (await win.locator('.card .tbl tbody tr').count()) === 1);
  await shot(win, '12b-knowledge-home');
  await win.locator('.card .tbl tbody tr').first().click();
  await win.waitForTimeout(400);
  check('Mở kết quả → trang Kiến thức chung, panel chi tiết mở sẵn', (await win.locator('.side-panel-head h2').innerText()).includes('PoE'));
  await shot(win, '12c-knowledge-list');

  // --- v1.4: Kiến thức có Hyperlink + Link website nhập tự do ---
  const localDoc = path.join(fixtures, 'Tai lieu PoE.txt');
  fs.writeFileSync(localDoc, 'tai lieu');
  const k = (await call(win, 'listKnowledge', {})).find((x) => x.title.includes('PoE'));
  await call(win, 'updateKnowledge', k.id, { ...k, webUrl: 'cong suat poe switch', localPath: localDoc });
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, '#/knowledge/general');
  await win.waitForTimeout(300);
  await win.locator('.tbl tbody tr').first().click();
  await win.waitForTimeout(250);
  check(
    'Kiến thức: Hyperlink file trên máy + Link website tự do (không phải link → tìm kiếm)',
    (await win.locator('.side-panel .link-chip', { hasText: 'Tai lieu PoE.txt' }).isVisible()) &&
      (await win.locator('.side-panel .link-chip', { hasText: 'cong suat poe switch' }).getAttribute('title'))?.startsWith('Tìm trên trình duyệt'),
  );
  await shot(win, '12d-knowledge-links');

  // --- v1.4: Tìm kiếm toàn cục theo loại + lọc ngày ---
  await win.locator('select[aria-label="Kiểu tìm kiếm"]').selectOption('serial');
  await win.locator('.gsearch-input').fill('ACCC8E');
  await win.waitForSelector('.gsearch-results .opt');
  await shot(win, '20-search-serial');
  await win.locator('.gsearch-results .opt').first().click();
  await win.waitForTimeout(500);
  check('Tìm theo Serial → mở Warranty và chọn đúng bản ghi', (await win.locator('.side-panel-head h2').innerText()).includes('RMA-2026-001'));
  await win.locator('select[aria-label="Kiểu tìm kiếm"]').selectOption('model');
  await win.locator('.gsearch-input').fill('coldstore');
  await win.locator('.gsearch-input').press('Enter');
  await win.waitForTimeout(500);
  const modelHits = await win.locator('.tbl tbody tr').count();
  check('Tìm theo Model/Mã thiết bị trong bảng thiết bị import → trang kết quả', modelHits === 1 && (await win.getByText('COLDSTORE 2U').first().isVisible()), `${modelHits} kết quả`);
  await win.getByRole('button', { name: 'Bộ lọc ngày' }).click();
  await win.locator('.gsearch-pop select[aria-label="Khoảng thời gian"]').selectOption('lastMonth');
  await win.waitForTimeout(400);
  check('Lọc ngày: Tháng trước không còn kết quả', (await win.locator('.tbl tbody tr').count()) === 0);
  await shot(win, '20b-search-page');
  await win.locator('.gsearch-pop select[aria-label="Khoảng thời gian"]').selectOption('all');
  await win.keyboard.press('Escape');
  await win.locator('.gsearch-input').fill('');
  await win.locator('select[aria-label="Kiểu tìm kiếm"]').selectOption('name');

  // --- v1.3: Dashboard › Dự án trong tháng (+ v1.4 xuất xlsx) ---
  await go(win, '#/');
  await win.waitForTimeout(400);
  const monthCard = win.locator('.card', { hasText: 'Dự án trong tháng' });
  const monthRows = await monthCard.locator('tbody tr').count();
  check('Dashboard có panel "Dự án trong tháng" dưới Dự án khẩn cấp', monthRows > 0, `${monthRows} dự án`);
  const monthHeads = (await monthCard.locator('th').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  check('Dự án trong tháng: STT / Tên dự án / Hãng / Tên SI / Sale / Ngày bắt đầu / Trạng thái', monthHeads.join('|') === 'STT|Tên dự án|Hãng|Tên SI|Sale|Ngày bắt đầu|Trạng thái', monthHeads.join(' | '));
  await shot(win, '03b-dashboard-month');
  const xlsxOut = path.join(root, 'du-an-thang.xlsx');
  await stubSave(app, xlsxOut);
  await monthCard.getByRole('button', { name: /Xuất xlsx/ }).click();
  await win.waitForSelector('.modal .export-cols');
  await win.locator('.modal .export-cols label', { hasText: 'Ghi chú gần nhất' }).click();
  await shot(win, '03c-export-columns');
  await win.getByRole('button', { name: /Xuất \.xlsx/ }).click();
  await win.waitForTimeout(600);
  const exported = fs.existsSync(xlsxOut) ? XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(xlsxOut)).Sheets['Tháng ' + (new Date().getMonth() + 1) + '-' + new Date().getFullYear()] ?? {}, { header: 1 }) : [];
  {
    const ci = (exported[0] ?? []).findIndex((h) => String(h).startsWith('Ghi chú trong tháng'));
    const cells = exported.slice(1).map((r) => String(r[ci] ?? '')).filter(Boolean);
    const hit = cells.find((c) => c.includes('Gửi báo giá lần 1')) ?? '';
    check(
      'Xuất xlsx: cột "Ghi chú trong tháng" gộp ghi chú theo ngày (• Ngày dd/mm/yyyy / - nội dung)',
      ci >= 0 && /^• Ngày \d{2}\/\d{2}\/\d{4}\n {4}- /.test(hit) && !cells.some((c) => /tháng trước/.test(c)),
      hit.split('\n').slice(0, 3).join(' ⏎ '),
    );
  }
  check('Xuất xlsx theo cột đã chọn', exported.length === monthRows + 1 && exported[0][0] === 'STT' && !exported[0].includes('Ghi chú gần nhất'), `${exported.length} dòng, cột: ${(exported[0] ?? []).join(', ')}`);
  {
    const ws = Object.values(XLSX.read(fs.readFileSync(xlsxOut)).Sheets)[0];
    const us = (d) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : null);
    const known = new Set((await call(win, 'listProjects')).flatMap((x) => [us(x.receivedDate), us(x.dueDate)]).filter(Boolean));
    const dateCells = [];
    for (const label of ['Ngày bắt đầu', 'Ngày tới hạn']) {
      const c = exported[0].indexOf(label);
      for (let r = 1; c >= 0 && r < exported.length; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== '') dateCells.push(cell);
      }
    }
    check(
      'Xuất xlsx: Ngày bắt đầu / Ngày tới hạn là ô ngày Excel dạng mm/dd/yyyy',
      dateCells.length >= monthRows && dateCells.every((x) => x.t === 'n' && /^\d{2}\/\d{2}\/\d{4}$/.test(x.w) && known.has(x.w)),
      dateCells.slice(0, 4).map((x) => x.w).join(', '),
    );
  }  // --- v1.12: tick dự án để xuất; không tick = xuất tất cả ---
  {
    const boxes = monthCard.locator('tbody input[type="checkbox"]');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    const stayed = await win.evaluate(() => location.hash);
    const xlsxPick = path.join(root, 'du-an-thang-da-chon.xlsx');
    await stubSave(app, xlsxPick);
    await monthCard.getByRole('button', { name: /Xuất 2 dự án đã chọn/ }).click();
    await win.waitForSelector('.modal .export-cols');
    await shot(win, '59-month-export-picked');
    await win.getByRole('button', { name: /Xuất \.xlsx/ }).click();
    await win.waitForTimeout(600);
    const picked = fs.existsSync(xlsxPick) ? XLSX.utils.sheet_to_json(Object.values(XLSX.read(fs.readFileSync(xlsxPick)).Sheets)[0], { header: 1 }) : [];
    await monthCard.getByRole('button', { name: 'Bỏ chọn' }).click();
    const allBtn = await monthCard.getByRole('button', { name: /Xuất xlsx \(tất cả\)/ }).count();
    check('Dự án trong tháng: tick dự án → chỉ xuất các dự án đó; bỏ tick → xuất tất cả', picked.length === 3 && allBtn === 1 && stayed === '#/', `${picked.length - 1} dòng đã xuất`);
  }


  // --- v1.4: Xóa dự án — Hủy / Xóa / Xóa cả folder local ---
  await app.evaluate(({ shell }) => {
    globalThis.__trashed = [];
    shell.trashItem = async (p) => {
      globalThis.__trashed.push(p);
    };
  });
  const temp = await call(win, 'createProject', { jobYearId: main.id, workCategory: 'POST_SALES', receivedDate: day(0), dueDate: day(30), projectName: 'Dự án tạm để xóa', clientId: null, folderParent: projectsRoot, note: '', filePath: null, fileName: null, fileExtension: null, priorityPoint: 3 });
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, `#/project/${temp.id}`);
  await win.waitForTimeout(300);
  await win.locator('.page-head').getByRole('button', { name: 'Xóa', exact: true }).click();
  await win.waitForSelector('.modal');
  const delBtns = (await win.locator('.modal-foot button').allInnerTexts()).map((t) => t.trim());
  check('Xóa dự án có 3 lựa chọn Hủy / Xóa / Xóa cả folder local', JSON.stringify(delBtns) === JSON.stringify(['Hủy', 'Xóa', 'Xóa cả folder local']), delBtns.join(' | '));
  await shot(win, '21-delete-3-options');
  await win.getByRole('button', { name: 'Xóa cả folder local' }).click();
  await win.waitForTimeout(500);
  const trashed = await app.evaluate(() => globalThis.__trashed);
  check('Xóa cả folder local → thư mục chuyển vào Thùng rác', trashed.length === 1 && trashed[0] === temp.folderPath && !(await call(win, 'listProjects')).some((x) => x.id === temp.id), trashed.join(', '));

  // --- v1.3: Calendar ---
  await go(win, '#/calendar');
  await win.waitForSelector('.cal-month');
  await win.waitForTimeout(300);
  // Ô hôm nay còn có mục Kinh nghiệm (hiện tự động) và hạn chót, nên tạm bỏ tick nguồn Kinh nghiệm để chip dự án không bị dồn
  // vào “+N” (số mục trong ô phụ thuộc dự án nào đã được kéo sang Hoàn thành ở bước Board).
  await win.locator('.cal-layer', { hasText: 'Kinh nghiệm' }).locator('input').uncheck();
  await win.waitForTimeout(150);
  const startChips = await win.locator('.ev-chip', { hasText: 'Nhà máy Đông Á' }).count();
  check('Calendar: dự án mới tự có ở ngày tiếp nhận', startChips >= 1, `${startChips} chip`);
  check('Calendar: hiển thị mục "Cập nhật dự án" hôm nay', (await win.locator('.cal-cell.today .ev-chip', { hasText: 'Trường THCS' }).count()) === 1);
  await shot(win, '19-calendar-month');
  await win.locator('.ev-chip', { hasText: 'Nhà máy Đông Á' }).first().click();
  await win.waitForSelector('.cal-pop');
  check('Bấm sự kiện mở thẻ chi tiết', await win.locator('.cal-pop').getByRole('button', { name: 'Mở dự án' }).isVisible());
  await shot(win, '19b-calendar-popover');
  await win.keyboard.press('Escape');
  await win.locator('.cal-layer', { hasText: 'Kinh nghiệm' }).locator('input').check();
  await win.getByRole('button', { name: /Tạo sự kiện/ }).click();
  await win.waitForSelector('.modal');
  await win.locator('.modal input.input').first().fill('Họp khảo sát hiện trường');
  await win.locator('.modal label', { hasText: 'Cả ngày' }).click();
  await win.getByRole('button', { name: 'Lưu', exact: true }).click();
  await win.waitForTimeout(500);
  check('Tạo sự kiện từ Calendar', (await toastText(win)).includes('Đã thêm sự kiện'), await toastText(win));
  await win.getByRole('button', { name: 'Tuần', exact: true }).click();
  await win.waitForTimeout(300);
  check('Calendar: chế độ Tuần có sự kiện theo giờ', (await win.locator('.ev-block', { hasText: 'Họp khảo sát' }).count()) === 1);
  await shot(win, '19c-calendar-week');
  await win.getByRole('button', { name: 'Lịch trình', exact: true }).click();
  await win.waitForTimeout(300);
  check('Calendar: chế độ Lịch trình', (await win.locator('.cal-agenda-item').count()) >= 1);
  await shot(win, '19d-calendar-agenda');
  await win.getByRole('button', { name: 'Tháng', exact: true }).click();

  // --- Settings: ngưỡng + dark mode ---
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Quy tắc trạng thái' }).click();
  await win.waitForTimeout(200);
  await shot(win, '13-settings-rules');
  await win.getByRole('button', { name: 'Giao diện', exact: true }).click();
  await win.getByRole('button', { name: /Dark Mode/ }).click();
  await win.waitForTimeout(300);
  await go(win, '#/');
  await win.waitForTimeout(400);
  await shot(win, '14-dashboard-dark');
  await go(win, '#/all');
  await win.waitForTimeout(400);
  await shot(win, '15-board-dark');
  await go(win, `#/project/${created[2].id}`);
  await win.waitForTimeout(400);
  await shot(win, '16-detail-dark');
  await go(win, '#/calendar');
  await win.waitForSelector('.cal-month');
  await win.waitForTimeout(300);
  await shot(win, '16b-calendar-dark');
  const dept = await call(win, 'createMaster', 'departments', 'Kinh doanh 1');
  const sale = (await call(win, 'listMaster', 'salespersons')).find((x) => x.name === 'Anh Tuấn Sale');
  await call(win, 'setSalespersonDepartment', sale.id, dept.id);
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Danh mục (Master Data)' }).click();
  const masterTabs = await win.locator('.tabs.small button').allInnerTexts();
  check('Settings › Master Data không còn tab Đơn vị thiết kế / Giai đoạn', masterTabs.join('|') === 'EU|Tên SI|Hãng|Sale & Phòng ban|Dự án (Warranty)', masterTabs.join(' | '));
  await win.getByRole('button', { name: 'Sale & Phòng ban' }).click();
  await win.waitForTimeout(250);
  await shot(win, '16e-settings-sale-dept');
  await go(win, `#/project/${created[0].id}`);
  await win.waitForTimeout(300);
  check('Chi tiết dự án hiển thị Sale "Tên/Phòng ban"', await win.getByText('Anh Tuấn Sale/Kinh doanh 1').isVisible());
  await go(win, `#/job/MAIN/${main.id}/warranty`);
  await win.waitForTimeout(400);
  await win.getByText('RMA-2026-001').click();
  await win.waitForTimeout(300);
  await shot(win, '16c-warranty-panel-dark');
  await go(win, `#/job/MAIN/${main.id}/post-sales`);
  await win.waitForTimeout(400);
  await shot(win, '16d-postsales-list-dark');

  // --- Giao diện cập nhật: chạy từ source nên updater "disabled"; giả lập sự kiện đã tải xong bản mới ---
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Dữ liệu & Backup' }).click();
  await win.waitForTimeout(200);
  check('Settings hiển thị lý do không tự cập nhật ở bản dev', await win.getByText(/chỉ có ở bản cài đặt/).isVisible());
  check('Chưa có bản mới: chuông thông báo không có chấm đỏ', (await win.locator('.notif-btn').isVisible()) && (await win.locator('.notif-dot').count()) === 0);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('ppm:event', {
      type: 'update',
      status: {
        state: 'downloaded',
        currentVersion: '1.2.0',
        version: '1.2.1',
        releaseDate: new Date().toISOString(),
        releaseNotes: '• Sửa lỗi lọc Warranty theo tháng\n• Thêm cột Ghi chú vào board',
      },
    });
  });
  await win.waitForSelector('.notif-dot');
  await win.waitForTimeout(400);
  const bellBox = await win.locator('.notif-btn').boundingBox();
  check(
    'Có bản mới: chỉ hiện chuông + chấm đỏ ở góc phải, không tự bật hộp thoại',
    (await win.locator('.modal').count()) === 0 && !!bellBox && bellBox.x > 1300,
    `chuông ở x=${Math.round(bellBox?.x ?? -1)}`,
  );
  await shot(win, '18-update-bell');
  await win.locator('.notif-btn').click();
  await win.waitForSelector('.notif-pop');
  check(
    'Bấm chuông: thấy bản mới, ghi chú và nút cập nhật',
    (await win.locator('.notif-pop').getByText('Có phiên bản mới 1.2.1').isVisible()) &&
      (await win.locator('.notif-pop').getByText('Thêm cột Ghi chú vào board').isVisible()) &&
      (await win.locator('.notif-pop').getByRole('button', { name: /Cập nhật & khởi động lại/ }).isVisible()),
  );
  await shot(win, '18b-update-bell-open');
  await win.locator('.notif-pop').getByRole('button', { name: 'Xem chi tiết' }).click();
  await win.waitForSelector('.modal');
  check('"Xem chi tiết" mở hộp thoại cập nhật đầy đủ', await win.locator('.modal').getByText('Thêm cột Ghi chú vào board').isVisible());
  await shot(win, '17-update-dialog');
  await win.getByRole('button', { name: 'Để sau' }).click();
  check('Sau "Để sau" chấm đỏ vẫn còn trên chuông', (await win.locator('.notif-dot').count()) === 1);

  // --- Backup / restore (AC-012) ---
  const bk = path.join(root, 'backup-test.zip');
  await stubSave(app, bk);
  const saved = await call(win, 'exportBackup');
  check('Xuất backup', saved === bk && fs.existsSync(bk));
  await call(win, 'deleteProject', fl.id);
  await stubOpen(app, [bk]);
  const info = await call(win, 'pickBackup');
  await call(win, 'restoreBackup', info.path);
  const after = await call(win, 'listProjects');
  check('Restore khôi phục dự án đã xóa', after.some((p) => p.id === fl.id), `${after.length} dự án`);

  // --- v1.4.2: đổi thư mục dữ liệu sang "ổ khác" → chép, kiểm tra, khởi động lại ---
  const newDataDir = path.join(root, 'o-D', 'PPM-Data');
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Dữ liệu & Backup' }).click();
  await win.waitForSelector('text=Đang lưu tại');
  const locCard = win.locator('.card', { has: win.locator('h2', { hasText: 'Thư mục dữ liệu' }) });
  check('Settings hiện thư mục dữ liệu hiện tại (Mặc định)', await locCard.getByText('Mặc định', { exact: true }).isVisible());
  await shot(win, '22-data-location');
  await app.evaluate(({ app: a }) => {
    globalThis.__relaunch = 0;
    a.relaunch = () => {
      globalThis.__relaunch++;
    };
    a.exit = () => {};
  });
  await stubOpen(app, [newDataDir]);
  await win.getByRole('button', { name: /Đổi thư mục dữ liệu/ }).click();
  await win.getByRole('button', { name: 'Chọn thư mục…' }).click();
  await win.waitForSelector('text=Đã chuyển dữ liệu', { timeout: 20000 });
  await win.waitForTimeout(900);
  await shot(win, '22b-data-moving');
  const relaunched = await app.evaluate(() => globalThis.__relaunch);
  const pointer = JSON.parse(fs.readFileSync(path.join(dataDir, 'electron-profile', 'data-location.json'), 'utf8'));
  check(
    'Đổi thư mục dữ liệu: chép đủ sang thư mục mới, ghi vị trí, khởi động lại',
    relaunched === 1 && pointer.dataDir === newDataDir && fs.existsSync(path.join(newDataDir, 'ppm.sqlite')) && fs.readdirSync(path.join(newDataDir, 'images')).length > 0,
    `relaunch=${relaunched}, dataDir=${pointer.dataDir}`,
  );

  await app.close();

  // --- Mở lại: dữ liệu + settings còn (AC-001, AC-011, TC-014) — giờ đọc từ thư mục dữ liệu mới ---
  ({ app, win } = await launch());
  const theme = await win.evaluate(() => document.documentElement.dataset.theme);
  const n = (await call(win, 'listProjects')).length;
  const loc = await call(win, 'getDataLocation');
  check('Mở lại app: dữ liệu và theme được giữ', theme === 'dark' && n === 8, `theme=${theme}, projects=${n}`);
  check('Mở lại app dùng thư mục dữ liệu mới, còn nhắc bản cũ', loc.dataDir === newDataDir && !loc.isDefault && loc.previousDir === dataDir, `${loc.dataDir} | cũ: ${loc.previousDir}`);
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Dữ liệu & Backup' }).click();
  await win.waitForSelector('text=Dữ liệu ở vị trí cũ vẫn còn');
  await shot(win, '22c-data-location-after');

  // --- v1.5: Job Freelance là một bảng riêng (không còn năm / Pre / Post / Warranty) ---
  await go(win, '#/');
  await win.waitForTimeout(300);
  const sideText = await win.locator('.sidebar').innerText();
  check('Sidebar: Job Freelance là một mục, có Password và Tools (Tool app / Tool online)', /Job Freelance/.test(sideText) && /Password/.test(sideText) && /Tool app/.test(sideText) && /Tool online/.test(sideText));
  await win.locator('.sidebar a[href="#/freelance"]').click();
  await win.waitForSelector('text=Chưa có job Freelance nào');
  await win.locator('.page-head').getByRole('button', { name: 'Thêm job' }).click();
  await win.waitForSelector('.modal #fl-name');
  const flStt = await win.locator('#fl-stt').inputValue();
  await win.locator('#fl-name').fill('Thiết kế logo quán cà phê');
  await win.locator('#fl-hirer').click();
  await win.locator('#fl-hirer').fill('Chị Hoa');
  await win.getByRole('button', { name: /Thêm Bên thuê “Chị Hoa”/ }).click();
  await win.waitForTimeout(250);
  await win.locator('.modal .rich-editor, .modal [contenteditable="true"]').first().click();
  await win.keyboard.type('Gửi 3 phương án logo');
  await shot(win, '30-freelance-form');
  await win.getByRole('button', { name: 'Thêm job' }).last().click();
  await win.waitForTimeout(500);
  const flJobs = await call(win, 'listFreelance');
  check(
    'Thêm job Freelance: STT tự +1, Bên thuê, Tình trạng mặc định, ghi chú hôm nay',
    flStt === '1' && flJobs.length === 1 && flJobs[0].hirer === 'Chị Hoa' && flJobs[0].statusName === 'Mới nhận' && flJobs[0].note.includes('Gửi 3 phương án logo'),
    JSON.stringify(flJobs.map((j) => [j.stt, j.projectName, j.statusName])),
  );
  const flHeads = (await win.locator('.freelance-table th').allInnerTexts()).map((t) => t.replace(/[▲▼]/g, '').trim()).filter(Boolean);
  check('Bảng Freelance: STT / Tên dự án / Bên thuê / Ngày bắt đầu / Tình trạng / Thanh toán / Ghi chú', flHeads.join('|') === 'STT|Tên dự án|Bên thuê|Ngày bắt đầu|Tình trạng|Thanh toán|Người đồng hành|TT đồng hành|Ghi chú gần nhất', flHeads.join(' | '));
  const statuses = await call(win, 'listMaster', 'freelanceStatuses');
  await win.locator('.freelance-table select').first().selectOption({ label: 'Đang làm' });
  await win.waitForTimeout(400);
  check('Đổi Tình trạng ngay trên bảng', (await call(win, 'listFreelance'))[0].statusName === 'Đang làm');
  await shot(win, '31-freelance-list');
  await win.locator('.freelance-table tbody tr').first().locator('td').nth(1).click();
  await win.waitForSelector('text=Thông tin job');
  await win.getByRole('button', { name: /Ngày khác/ }).click();
  const yesterday = day(-1);
  await win.locator('.modal input').first().fill(`${yesterday.slice(8, 10)}/${yesterday.slice(5, 7)}/${yesterday.slice(0, 4)}`);
  await win.getByRole('button', { name: 'Mở ghi chú' }).click();
  await win.locator('.note-editing [contenteditable="true"]').click();
  await win.keyboard.type('Khách duyệt phương án 2');
  await win.locator('.note-editing').getByRole('button', { name: 'Lưu', exact: true }).click();
  await win.waitForTimeout(500);
  const flNotes = await call(win, 'listFreelanceNotes', flJobs[0].id);
  check(
    'Ghi chú Freelance theo ngày (log ngày cũ), không có nút Calendar',
    flNotes.length === 2 && flNotes[1].noteDate === yesterday && (await win.getByRole('button', { name: /Lưu và thêm vào Calendar/ }).count()) === 0,
    flNotes.map((n) => n.noteDate).join(', '),
  );
  await shot(win, '32-freelance-detail');

  // --- v1.5: Settings › Master Data có phân loại Job Chính / Job Freelance ---
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Danh mục (Master Data)' }).click();
  await win.locator('[aria-label="Phân loại danh mục"]').getByRole('button', { name: 'Job Freelance' }).click();
  await win.waitForTimeout(250);
  const flTabs = await win.locator('.tabs.small button').allInnerTexts();
  await win.getByPlaceholder('Tên Tình trạng mới').fill('Chờ nghiệm thu');
  await win.getByRole('button', { name: 'Thêm', exact: true }).first().click();
  await win.waitForTimeout(300);
  await win.getByRole('button', { name: 'Đưa Chờ nghiệm thu lên' }).click();
  await win.waitForTimeout(300);
  const st2 = (await call(win, 'listMaster', 'freelanceStatuses')).map((x) => x.name);
  check(
    'Master Data › Job Freelance › Tình trạng: thêm mới, sắp xếp lên/xuống',
    flTabs.join('|') === 'Tình trạng|Trạng thái thanh toán|Bên thuê|Người đồng hành' && statuses.length === 5 && st2.length === 6 && st2[4] === 'Chờ nghiệm thu',
    st2.join(' > '),
  );
  await shot(win, '33-settings-freelance-status');
  await win.locator('[aria-label="Phân loại danh mục"]').getByRole('button', { name: 'Job Chính' }).click();
  await win.waitForTimeout(200);
  check('Phân loại Job Chính vẫn có EU / Tên SI / Hãng / Sale (+ Dự án (Warranty))', (await win.locator('.tabs.small button').allInnerTexts()).join('|') === 'EU|Tên SI|Hãng|Sale & Phòng ban|Dự án (Warranty)');

  // --- v1.5: Import hàng loạt từ .xlsx (mapping cột) ---
  const bulkProjects = path.join(fixtures, 'Danh sach du an.xlsx');
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['DANH SÁCH DỰ ÁN TỔNG HỢP'],
        [],
        ['STT', 'Tên công trình', 'Nhà tích hợp', 'Hãng', 'Sales', 'Chủ đầu tư', 'Ngày nhận', 'Deadline', 'Ghi chú'],
        [null, 'Nhà máy Hưng Yên – CCTV', 'SI Alpha', 'Hikvision, Bosch', 'Anh Tuấn Sale', 'Tập đoàn Vingroup', '01/11/2026', '30/12/2026', 'Đã gửi BOQ'],
        [null, 'Siêu thị Q7 – Access Control', 'SI Mới Toanh', 'Axis', null, null, '05/11/2026', null, null],
        [null, '', 'SI Alpha', null, null, null, null, null, 'dòng thiếu tên'],
        [null, 'Ngày sai', null, null, null, null, '45/13/2026', null, null],
      ]),
      'DS',
    );
    fs.writeFileSync(bulkProjects, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  const preBefore = (await call(win, 'listProjects')).length;
  await go(win, `#/job/MAIN/${main.id}/pre-sales`);
  await win.waitForTimeout(400);
  await stubOpen(app, [bulkProjects]);
  await win.getByRole('button', { name: 'Import xlsx' }).first().click();
  await win.waitForSelector('.modal .bulk-preview');
  await win.waitForTimeout(500);
  const badRows = await win.locator('.bulk-preview tr.bulk-bad').count();
  const goodRows = await win.locator('.bulk-preview tbody tr:not(.bulk-bad)').count();
  check('Import xlsx: tự nhận diện header + cột, đánh dấu dòng lỗi', goodRows === 2 && badRows === 2, `${goodRows} hợp lệ, ${badRows} lỗi`);
  await shot(win, '34-bulk-import-projects');
  await win.getByRole('button', { name: 'Import 2 dòng' }).click();
  await win.waitForTimeout(800);
  const afterBulk = await call(win, 'listProjects');
  const hy = afterBulk.find((p) => p.projectName === 'Nhà máy Hưng Yên – CCTV');
  const newSi = (await call(win, 'listMaster', 'siPartners')).some((m) => m.name === 'SI Mới Toanh');
  check(
    'Import Pre-sales: ghi dự án, khớp danh mục theo tên, thêm mục mới, tạo thư mục',
    afterBulk.length === preBefore + 2 &&
      hy?.workCategory === 'PRE_SALES' &&
      hy?.siName === 'SI Alpha' &&
      hy?.brands.map((b) => b.name).join('+') === 'Hikvision+Bosch' &&
      hy?.receivedDate === '2026-11-01' &&
      newSi &&
      !!hy?.folderPath &&
      fs.existsSync(hy.folderPath),
    `${afterBulk.length - preBefore} dự án mới · ${hy?.folderPath ?? 'không có thư mục'}`,
  );

  // --- v1.5.1: nút Chọn → tick từng dòng / tất cả → xóa các mục đã chọn ---
  await win.reload();
  await win.waitForSelector('.sidebar');
  await go(win, `#/job/MAIN/${main.id}/pre-sales`);
  await win.waitForSelector('.project-table tbody tr');
  const doneTitle = win.locator('.project-table tr.row-done .pt-title').first();
  const deco = (await doneTitle.count()) ? await doneTitle.evaluate((el) => getComputedStyle(el).textDecorationLine) : 'không có dòng hoàn thành';
  check('Tên dự án Đã hoàn thành hiển thị bình thường (không gạch ngang)', deco === 'none', deco);
  await win.getByRole('button', { name: 'Chọn', exact: true }).click();
  await win.waitForSelector('.select-banner');
  const preRows = await win.locator('.project-table tbody tr').count();
  await win.getByRole('checkbox', { name: 'Chọn tất cả' }).check();
  const allText = await win.locator('.select-banner').innerText();
  await win.getByRole('checkbox', { name: 'Chọn tất cả' }).uncheck();
  await win.getByRole('checkbox', { name: /Nhà máy Hưng Yên/ }).check();
  await win.locator('.project-table tbody tr', { hasText: 'Siêu thị Q7' }).click();
  const twoText = await win.locator('.select-banner').innerText();
  await shot(win, '39-select-projects');
  check(
    'Chọn: tick tất cả / bỏ tick / tick từng dòng (bấm ô tick hoặc bấm dòng)',
    allText.includes(`Đã chọn ${preRows}/${preRows}`) && twoText.includes(`Đã chọn 2/${preRows}`),
    `${allText.split('.')[0]} → ${twoText.split('.')[0]}`,
  );
  await win.locator('.select-banner').getByRole('button', { name: /Xóa 2 mục/ }).click();
  await win.waitForSelector('.modal');
  await shot(win, '39b-delete-selected-dialog');
  await win.getByRole('button', { name: 'Xóa 2 dự án' }).click();
  await win.waitForTimeout(600);
  const afterSelDel = await call(win, 'listProjects');
  check(
    'Xóa 2 dự án đã chọn (giữ thư mục trên máy), thoát chế độ chọn',
    afterSelDel.length === afterBulk.length - 2 && !afterSelDel.some((x) => /Hưng Yên|Siêu thị Q7/.test(x.projectName)) && (await win.locator('.select-banner').count()) === 0 && fs.existsSync(hy.folderPath),
    `${afterBulk.length} → ${afterSelDel.length} dự án`,
  );

  await go(win, `#/job/MAIN/${main.id}/warranty`);
  await win.waitForTimeout(500);
  const wBefore = (await call(win, 'listWarranty', main.id)).length;
  await win.getByRole('button', { name: 'Chọn', exact: true }).click();
  await win.getByRole('checkbox', { name: 'Chọn tất cả' }).check();
  await win.locator('.select-banner').getByRole('button', { name: /Xóa \d+ mục/ }).click();
  await win.getByRole('button', { name: `Xóa ${wBefore} bản ghi` }).click();
  await win.waitForTimeout(500);
  check('Warranty: chọn tất cả rồi xóa', wBefore > 0 && (await call(win, 'listWarranty', main.id)).length === 0, `${wBefore} bản ghi`);

  const bulkFreelance = path.join(fixtures, 'Freelance jobs.xlsx');
  {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Tên dự án', 'Bên thuê', 'Bắt đầu', 'Trạng thái'],
        ['Landing page spa', 'Anh Tú', '02/11/2026', 'đang làm'],
        ['App đặt lịch', 'Chị Mai', '10/11/2026', 'Chờ nghiệm thu'],
      ]),
      'Jobs',
    );
    fs.writeFileSync(bulkFreelance, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }
  await go(win, '#/freelance');
  await win.waitForTimeout(300);
  await stubOpen(app, [bulkFreelance]);
  await win.getByRole('button', { name: 'Import xlsx' }).first().click();
  await win.waitForSelector('.modal .bulk-preview');
  await win.getByRole('button', { name: 'Import 2 dòng' }).click();
  await win.waitForTimeout(800);
  const flAll = await call(win, 'listFreelance');
  check(
    'Import Job Freelance: STT tiếp theo, Tình trạng khớp theo tên',
    flAll.length === 3 && flAll.map((j) => j.statusName).join('|') === 'Đang làm|Đang làm|Chờ nghiệm thu' && flAll[2].stt === 3,
    flAll.map((j) => `${j.stt}.${j.projectName}=${j.statusName}`).join(', '),
  );
  await shot(win, '35-freelance-after-import');
  const hitFl = await call(win, 'globalSearch', { mode: 'name', text: 'landing page' });
  check('Tìm kiếm Tên dự án ra cả Job Freelance', hitFl.length === 1 && hitFl[0].kind === 'freelance', JSON.stringify(hitFl.map((h) => h.title)));
  await win.getByRole('button', { name: 'Chọn', exact: true }).click();
  await win.getByRole('checkbox', { name: /App đặt lịch/ }).check();
  await shot(win, '39c-select-freelance');
  await win.locator('.select-banner').getByRole('button', { name: /Xóa 1 mục/ }).click();
  await win.getByRole('button', { name: 'Xóa 1 job' }).click();
  await win.waitForTimeout(500);
  const flLeft = await call(win, 'listFreelance');
  check('Job Freelance: chọn 1 job rồi xóa', flLeft.length === 2 && !flLeft.some((j) => j.projectName === 'App đặt lịch'), flLeft.map((j) => j.projectName).join(', '));

  // --- v1.5: Password ---
  await win.locator('.sidebar a[href="#/passwords"]').click();
  await win.waitForSelector('text=Chưa có thông tin đăng nhập nào');
  for (const [site, user, pass, url] of [
    ['Gmail công việc', 'me@company.vn', 'P@ss-Gmail-01', 'mail.google.com'],
    ['Cổng hãng Axis', 'partner01', 'Axis#2026', ''],
  ]) {
    await win.locator('.page-head').getByRole('button', { name: 'Thêm' }).click();
    await win.locator('#pw-site').fill(site);
    await win.locator('#pw-user').fill(user);
    await win.locator('#pw-pass').fill(pass);
    await win.locator('#pw-url').fill(url);
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
    await win.waitForTimeout(350);
  }
  const pwMasked = await win.locator('code.secret').first().innerText();
  await win.getByRole('button', { name: 'Hiện mật khẩu Gmail công việc' }).click();
  await win.waitForTimeout(250);
  const revealed = await win.locator('code.secret').first().innerText();
  await win.evaluate(() => {
    window.__copied = null;
    navigator.clipboard.writeText = async (t) => {
      window.__copied = t;
    };
  });
  await win.getByRole('button', { name: 'Sao chép mật khẩu Cổng hãng Axis' }).click();
  await win.waitForTimeout(250);
  const copied = await win.evaluate(() => window.__copied);
  check('Password: che mặc định, bấm mắt để xem, sao chép không cần hiện', pwMasked === '••••••••' && revealed === 'P@ss-Gmail-01' && copied === 'Axis#2026', `${pwMasked} → ${revealed}`);
  await shot(win, '36-passwords');
  await win.getByPlaceholder('Tìm theo Tên website…').fill('axis');
  await win.waitForTimeout(200);
  const pwRows = await win.locator('.tbl tbody tr').count();
  check('Password: tìm theo Tên website', pwRows === 1 && (await win.locator('.tbl tbody').innerText()).includes('Cổng hãng Axis'));
  await win.getByPlaceholder('Tìm theo Tên website…').fill('');

  // --- v1.5: Tools ---
  await win.locator('.sidebar a[href="#/tools/app"]').click();
  await win.waitForSelector('text=Chưa có tool nào');
  await shot(win, '37-tool-app');
  await win.locator('.sidebar a[href="#/tools/online"]').click();
  await win.waitForSelector('text=Chưa có tool online nào');
  for (const [name, purpose, url] of [
    ['TinyPNG', 'Nén ảnh PNG/JPG trước khi gửi khách', 'tinypng.com'],
    ['IP Calculator', 'Chia subnet cho hệ thống camera', 'https://jodies.de/ipcalc'],
  ]) {
    await win.locator('.page-head').getByRole('button', { name: 'Thêm tool' }).click();
    await win.locator('#tool-name').fill(name);
    await win.locator('#tool-purpose').fill(purpose);
    await win.locator('#tool-url').fill(url);
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
    await win.waitForTimeout(300);
  }
  await win.locator('.page-head').getByRole('button', { name: 'Thêm tool' }).click();
  await win.locator('#tool-name').fill('Sai link');
  await win.locator('#tool-url').fill('nén ảnh online');
  await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
  const linkErr = await win.locator('.modal .field-error').innerText().catch(() => '');
  await win.locator('.modal-foot').getByRole('button', { name: 'Hủy' }).click();
  await win.getByPlaceholder('Tìm theo tên tool…').fill('tiny');
  await win.waitForTimeout(200);
  const toolRows = await win.locator('.tbl tbody tr').count();
  await win.getByPlaceholder('Tìm theo tên tool…').fill('');
  await win.waitForTimeout(200);
  check('Tool online: thêm, bắt buộc Link hợp lệ, tìm theo tên', (await call(win, 'listOnlineTools')).length === 2 && /Link không hợp lệ/.test(linkErr) && toolRows === 1, linkErr);
  await shot(win, '38-tool-online');

  // --- v1.6: Calendar có Job Freelance + Kinh nghiệm, tick Nguồn / Loại ---
  const deletedGone = !(await call(win, 'listCalendarEvents', {})).some((e) => /Hưng Yên|Siêu thị Q7/.test(e.title));
  check('Xóa dự án thì các mục Bắt đầu/Cập nhật của nó biến mất khỏi Calendar', deletedGone);
  await go(win, '#/calendar');
  await win.waitForSelector('.cal-layers');
  const flChip = win.locator('.ev-chip', { hasText: 'Thiết kế logo quán cà phê' });
  await win.waitForTimeout(400);
  const chipBefore = await flChip.count();
  await shot(win, '40-calendar-sources');
  await win.locator('.cal-layer', { hasText: 'Job Freelance' }).locator('input').uncheck();
  await win.waitForTimeout(200);
  const chipOff = await flChip.count();
  await win.locator('.cal-layer', { hasText: 'Job Freelance' }).locator('input').check();
  const sideTxt = await win.locator('.cal-side').innerText();
  check(
    'Calendar: Job Freelance hiện tự động, tick Nguồn (Job Chính / Job Freelance / Kinh nghiệm) và Loại để lọc',
    chipBefore > 0 && chipOff === 0 && /Nguồn/.test(sideTxt) && /Kinh nghiệm/.test(sideTxt) && /Hạn chót/.test(sideTxt),
    `${chipBefore} → ${chipOff} mục Freelance khi bỏ tick`,
  );

  // --- v1.6: STT riêng cho Pre-sales / Post-sales ---
  const pre = await call(win, 'listProjects');
  const maxIn = (cat) => Math.max(0, ...pre.filter((x) => x.jobYearId === main.id && x.workCategory === cat).map((x) => x.stt));
  const nextPost = await call(win, 'nextProjectStt', main.id, 'POST_SALES');
  check('STT +1 theo từng danh sách (Post-sales không nhảy theo Pre-sales)', nextPost === maxIn('POST_SALES') + 1, `Pre max ${maxIn('PRE_SALES')}, Post tiếp theo ${nextPost}`);

  // --- v1.6: Duplicate dự án (cạnh View info) + bỏ tick tạo thư mục ---
  await go(win, `#/job/MAIN/${main.id}/pre-sales`);
  await win.waitForSelector('.project-table tbody tr');
  await win.locator('.project-table tbody tr', { hasText: 'Nhà máy Đông Á' }).click();
  await win.locator('.side-panel').getByRole('button', { name: 'Duplicate' }).click();
  await win.waitForSelector('.modal #pf-name');
  await win.waitForTimeout(300);
  const dupName = await win.locator('#pf-name').inputValue();
  const dupStt = await win.locator('#pf-stt').inputValue();
  await win.getByRole('checkbox', { name: 'Tạo thư mục mới cho dự án' }).uncheck();
  await shot(win, '41-duplicate-project');
  await win.getByRole('button', { name: 'Tạo dự án' }).click();
  await win.waitForTimeout(600);
  const dup = (await call(win, 'listProjects')).find((x) => x.projectName === dupName);
  check(
    'Duplicate dự án: điền sẵn thông tin, STT tiếp theo của danh sách, bỏ tick thì không tạo thư mục',
    /\(bản sao\)$/.test(dupName) && Number(dupStt) === maxIn('PRE_SALES') + 1 && !!dup && dup.siName === 'SI Alpha' && dup.folderPath === null,
    `${dupStt}. ${dupName}`,
  );

  // --- v1.6: Warranty STT + Duplicate ---
  await call(win, 'createWarranty', {
    jobYearId: main.id, model: 'P1375', brandId: null, ipAddress: '10.0.0.5', username: 'root', password: 'Pass#1', macAddress: '', serialNumber: 'SN1',
    receivedDate: day(0), testedDate: null, customerReport: 'Mất hình', inspection: '', result: '', resolution: '', caseNumber: 'RMA-77', images: [],
  });
  await go(win, `#/job/MAIN/${main.id}/warranty`);
  await win.waitForTimeout(500);
  const wHeads = (await win.locator('.tbl thead th').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  await win.locator('.tbl tbody tr', { hasText: 'P1375' }).click();
  await win.locator('.side-panel').getByRole('button', { name: 'Duplicate' }).click();
  await win.waitForSelector('.modal');
  await win.waitForTimeout(300);
  const wDupStt = await win.locator('.modal input[aria-label="STT"]').inputValue();
  await shot(win, '42-warranty-duplicate');
  await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
  await win.waitForTimeout(500);
  const ws2 = await call(win, 'listWarranty', main.id);
  const copyW = ws2.find((w) => w.stt === 2);
  check(
    'Warranty: cột STT đứng đầu, Case no sau; Duplicate ra STT mới, chép thông tin và mật khẩu',
    wHeads[0] === 'STT' && wHeads[1] === 'Case no' && wDupStt === '2' && !!copyW && copyW.model === 'P1375' && copyW.hasPassword && (await call(win, 'revealWarrantyPassword', copyW.id)) === 'Pass#1',
    `${wHeads.slice(0, 3).join(' | ')} · bản sao STT ${wDupStt}`,
  );

  // --- v1.6: Master Data › Job Freelance › Bên thuê ---
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Danh mục (Master Data)' }).click();
  await win.locator('[aria-label="Phân loại danh mục"]').getByRole('button', { name: 'Job Freelance' }).click();
  await win.getByRole('button', { name: 'Bên thuê', exact: true }).click();
  await win.waitForTimeout(250);
  const hirerNames = (await call(win, 'listMaster', 'freelanceHirers')).map((h) => h.name);
  await shot(win, '43-settings-hirers');
  check('Master Data › Job Freelance có danh mục Bên thuê', hirerNames.includes('Chị Hoa') && (await win.getByText('Chị Hoa').first().isVisible()), hirerNames.join(', '));

  // --- v1.7: Panel Pre-sales xem hết ghi chú theo ngày (kèm ảnh), cuộn được ---
  const dong = (await call(win, 'listProjects')).find((x) => x.projectName.startsWith('Nhà máy Đông Á') && !/bản sao/.test(x.projectName));
  {
    const [img] = await call(win, 'importDroppedImages', [png]);
    const long = Array.from({ length: 14 }, (_, i) => `<p>Dòng ${i + 1}: trao đổi với khách về phương án thiết kế</p>`).join('');
    await call(win, 'saveProjectNote', dong.id, { noteDate: day(-3), html: `<p>Khảo sát hiện trường</p><p><img src="ppm-img://full/${encodeURIComponent(img.storageKey)}"></p>` }, {});
    await call(win, 'saveProjectNote', dong.id, { noteDate: day(-2), html: long }, {});
    const allNotes = await call(win, 'listProjectNotes', dong.id);
    await go(win, `#/job/MAIN/${main.id}/pre-sales`);
    await win.waitForSelector('.project-table tbody tr');
    await win.locator('.project-table tbody tr', { hasText: dong.projectName }).filter({ hasNotText: 'bản sao' }).first().click();
    await win.waitForSelector('.side-panel .panel-notes .note-entry');
    await win.waitForFunction(() => document.querySelector('.side-panel .panel-notes img')?.complete);
    const entries = await win.locator('.side-panel .panel-notes .note-entry').count();
    const imgW = await win.locator('.side-panel .panel-notes img').first().evaluate((el) => el.naturalWidth);
    const sc = await win.locator('.side-panel-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return { sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop };
    });
    await shot(win, '44-presales-panel-notes');
    check(
      'Panel Pre-sales: xem hết ghi chú theo ngày kèm ảnh, cuộn được',
      entries === allNotes.length && entries >= 2 && imgW > 0 && sc.sh > sc.ch && sc.top > 0,
      `${entries}/${allNotes.length} ngày, ảnh ${imgW}px, cuộn ${sc.top}/${sc.sh - sc.ch}px`,
    );
    await win.locator('.side-panel .panel-notes img').first().click();
    check('Bấm ảnh ghi chú trong panel → phóng to', await win.locator('.lightbox').isVisible());
    await win.locator('.lightbox').getByRole('button', { name: 'Đóng' }).click();
  }

  // --- v1.7: File đính kèm nhận thêm .docx / .pdf ---
  {
    const docx = path.join(fixtures, 'Thuyết minh kỹ thuật.docx');
    const pdf = path.join(fixtures, 'Báo giá thiết bị.pdf');
    fs.writeFileSync(docx, 'PK fake docx');
    fs.writeFileSync(pdf, '%PDF-1.4 fake');
    await stubOpen(app, [docx]);
    const fDocx = await call(win, 'pickLinkFile');
    await stubOpen(app, [xlsxFile]);
    const fXlsx = await call(win, 'pickLinkFile');
    const zip = path.join(fixtures, 'Ban ve nen.zip');
    fs.writeFileSync(zip, 'PK fake zip');
    await stubOpen(app, [zip]);
    const xlsxErr = await call(win, 'pickLinkFile').then(
      () => '',
      (e) => String(e),
    );
    await go(win, `#/project/${dong.id}`);
    await win.waitForSelector('text=File & Attachments');
    await stubOpen(app, [pdf]);
    await win.locator('section', { hasText: 'File & Attachments' }).getByRole('button', { name: /^(Chọn file|Thay file)$/ }).first().click();
    await win.waitForTimeout(500);
    const linked = (await call(win, 'listProjects')).find((x) => x.id === dong.id);
    await shot(win, '45-project-pdf-attachment');
    check(
      'File đính kèm nhận .docx / .pdf / .xlsx (vẫn từ chối file khác)',
      fDocx?.extension === 'docx' && fXlsx?.extension === 'xlsx' && /\.pdf, \.xlsx/.test(xlsxErr) && linked.fileExtension === 'pdf' && (await win.locator('.file-row .file-ext', { hasText: 'pdf' }).isVisible()),
      `${fDocx?.name} · ${linked.fileName}`,
    );
    // v1.12: nhiều file cho một dự án
    await stubOpen(app, [docx, xlsxFile]);
    await win.locator('section', { hasText: 'File & Attachments' }).getByRole('button', { name: 'Thêm file' }).click();
    await win.waitForTimeout(500);
    const three = (await call(win, 'listProjects')).find((x) => x.id === dong.id).files;
    const rows3 = await win.locator('section', { hasText: 'File & Attachments' }).locator('.file-row', { has: win.locator('.file-ext') }).count();
    await shot(win, '60-project-multi-files');
    await win.locator('.file-row', { hasText: 'Thuyết minh kỹ thuật.docx' }).getByRole('button', { name: 'Gỡ liên kết' }).click();
    await win.locator('.modal').getByRole('button', { name: 'Gỡ liên kết' }).click();
    await win.waitForTimeout(500);
    const two = (await call(win, 'listProjects')).find((x) => x.id === dong.id).files;
    check(
      'Dự án liên kết nhiều file (thêm nhiều file một lần, gỡ từng file)',
      three.map((f) => f.extension).join(',') === 'pdf,docx,xlsx' && rows3 >= 3 && two.map((f) => f.extension).join(',') === 'pdf,xlsx',
      `${three.map((f) => f.name).join(', ')} → ${two.map((f) => f.name).join(', ')}`,
    );
  }

  // --- v1.7–v1.9: Kho thiết bị (riêng, ngoài Job Chính) ---
  const dmy = (isoDay) => isoDay.split('-').reverse().join('/');
  await go(win, '#/');
  await win.locator('.sidebar').getByRole('link', { name: 'Kho thiết bị' }).click();
  await win.waitForSelector('text=Kho thiết bị chưa có thiết bị nào');
  check('Sidebar có mục Kho thiết bị riêng, trang trống có hướng dẫn', await win.getByRole('heading', { name: 'Kho thiết bị', exact: true }).isVisible());
  await win.getByRole('button', { name: 'Thêm thiết bị' }).first().click();
  await win.waitForSelector('.modal #eq-name');
  await win.waitForTimeout(300);
  const eqStt = await win.locator('.modal input[aria-label="STT"]').inputValue();
  const noCurrentFields = (await win.locator('.modal #eq-borrow, .modal #eq-due').count()) === 0 && !(await win.locator('.modal').innerText()).includes('Ngày mượn hiện tại');
  await win.locator('#eq-name').fill('Camera Axis P1375-E');
  await win.locator('#eq-category').click();
  await win.locator('#eq-category').fill('Camera');
  await win.keyboard.press('Enter');
  await win.locator('#eq-brand').click();
  await win.locator('#eq-brand').fill('Axis');
  await win.keyboard.press('Enter');
  await win.locator('#eq-serial').fill('ACCC8E-7731');
  await win.locator('#eq-handover').fill('15/10/2026');
  await win.locator('#eq-handover').press('Tab');
  await win.locator('.modal textarea[aria-label="Mô tả"]').fill('Camera bullet 4MP, kèm chân đế');
  await win.locator('.modal textarea[aria-label="Tình trạng"]').fill('Mới, đủ phụ kiện');
  await stubOpen(app, [png]);
  await win.locator('.modal').getByRole('button', { name: 'Thêm ảnh' }).click();
  await win.waitForSelector('.modal .thumb');
  await shot(win, '44-equipment-form');
  await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
  await win.waitForSelector('.side-panel');
  let eq = (await call(win, 'listEquipment'))[0];
  check(
    'Thêm thiết bị: STT tự +1, Tên sp, Phân loại (thêm ngay trong ô chọn), Hãng, Serial, ảnh; không còn ô Ngày mượn / hẹn trả hiện tại',
    noCurrentFields && eqStt === '1' && eq?.stt === 1 && eq.productName === 'Camera Axis P1375-E' && eq.categoryName === 'Camera' && eq.brandName === 'Axis' && eq.serialNumber === 'ACCC8E-7731' && eq.images.length === 1 && eq.currentBorrowDate === null,
    `${eq?.stt}. ${eq?.productName} · ${eq?.categoryName} · ${eq?.brandName} · ${eq?.images.length} ảnh`,
  );
  const eqPanelTxt = await win.locator('.side-panel').innerText();
  check(
    'Thiết bị có Mô tả và Ngày nhận bàn giao gắn trực tiếp, hiện ở panel phải',
    eq.description === 'Camera bullet 4MP, kèm chân đế' && eq.handoverDate === '2026-10-15' && eq.loans.length === 0 && /Camera bullet 4MP/.test(eqPanelTxt) && /15\/10\/2026/.test(eqPanelTxt),
    `${eq.description} · ${eq.handoverDate}`,
  );

  const eqPanel = win.locator('.side-panel');
  await eqPanel.getByRole('button', { name: 'Thêm lần mượn' }).click();
  await win.waitForSelector('.modal #loan-si');
  const loanLabels = await win.locator('.modal .field-label, .modal label').allInnerTexts();
  await win.locator('#loan-si').click();
  await win.locator('#loan-si').fill('SI Alpha');
  await win.keyboard.press('Enter');
  await win.locator('#loan-sale').click();
  await win.locator('#loan-sale').fill('Anh Tuấn Sale');
  const saleOpts = await win.locator('[role="option"]').allInnerTexts();
  await win.keyboard.press('Enter');
  const saleInput = await win.locator('#loan-sale').inputValue();
  await win.locator('.modal textarea[aria-label="Lý do mượn"]').fill('Demo cho khách ABC');
  await win.locator('#loan-due').fill(dmy(day(7)));
  await win.locator('#loan-due').press('Tab');
  await stubOpen(app, [png]);
  await win.locator('.modal').getByRole('button', { name: 'Thêm ảnh' }).click();
  await win.waitForSelector('.modal .thumb');
  await shot(win, '46-equipment-loan-form');
  await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
  await win.waitForTimeout(500);
  eq = (await call(win, 'listEquipment'))[0];
  const lentTxt = await eqPanel.innerText();
  const loanLabelTxt = loanLabels.join('|');
  check(
    'Thêm lần mượn: Tên SI, Sale, Ngày mượn, Ngày hẹn trả (đổi tên từ "Ngày trả"), Lý do, Ảnh → Đang cho mượn',
    /Ngày hẹn trả/.test(loanLabelTxt) && !/Ngày trả thực tế/.test(loanLabelTxt) &&
      eq.loans.length === 1 && eq.loans[0].siName === 'SI Alpha' && eq.loans[0].reason === 'Demo cho khách ABC' && eq.loans[0].dueDate === day(7) && eq.loans[0].returnDate === null && eq.loans[0].images.length === 1 &&
      eq.currentBorrowDate === day(0) && eq.currentDueDate === day(7) && /Đang cho mượn/.test(lentTxt) && /Còn 7 ngày/.test(lentTxt),
    `${eq.loans[0]?.siName} · hẹn trả ${eq.loans[0]?.dueDate} · ${eq.loans[0]?.images.length} ảnh`,
  );
  check(
    'Kho thiết bị: Sale chỉ hiện tên, không kèm Phòng ban (ô chọn và lịch sử mượn)',
    eq.loans[0].salespersonName === 'Anh Tuấn Sale' && saleInput === 'Anh Tuấn Sale' && saleOpts.some((o) => o.trim() === 'Anh Tuấn Sale') && /Anh Tuấn Sale/.test(lentTxt) && !/Kinh doanh 1/.test(lentTxt) && !saleOpts.some((o) => /Kinh doanh 1/.test(o)),
    `ô chọn "${saleInput}", gợi ý ${saleOpts.join(' | ')}`,
  );
  const loanImgs = await eqPanel.locator('.loan-images img').count();
  const addDisabled = await eqPanel.getByRole('button', { name: 'Thêm lần mượn' }).isDisabled();
  const eqRow1 = win.locator('.equipment-table tbody tr', { hasText: 'ACCC8E-7731' });
  const siCol = await eqRow1.locator('td').nth((await win.locator('.equipment-table thead th').allInnerTexts()).findIndex((h) => h.trim() === 'Tên SI mượn')).innerText();
  const saleCol = await eqRow1.locator('td').nth((await win.locator('.equipment-table thead th').allInnerTexts()).findIndex((h) => h.trim() === 'Sale mượn')).innerText();
  check(
    'Panel hiện ảnh của lần mượn; bảng tách cột Tên SI mượn / Sale mượn; chưa hoàn trả thì không thêm được lần mượn mới',
    loanImgs === 1 && addDisabled && siCol.trim() === 'SI Alpha' && saleCol.trim() === 'Anh Tuấn Sale',
    `ảnh ${loanImgs} · SI "${siCol}" · Sale "${saleCol}" · nút Thêm lần mượn ${addDisabled ? 'bị khóa' : 'bật'}`,
  );
  const blocked = await call(win, 'saveEquipmentLoan', eq.id, null, { siId: null, salespersonId: null, borrowDate: day(0), dueDate: null, returnDate: null, reason: '', returnCondition: '', images: [] }).then(
    () => '',
    (e) => String(e),
  );
  check('Thêm lần mượn khi lần trước chưa hoàn trả bị chặn cả ở dữ liệu', /Đã hoàn trả/.test(blocked), blocked.slice(0, 120));

  // Quá ngày hẹn trả mà chưa bấm "Đã hoàn trả" → Quá hạn
  await eqPanel.getByRole('button', { name: /^Sửa lần mượn/ }).click();
  await win.waitForSelector('.modal #loan-borrow');
  await win.locator('#loan-borrow').fill(dmy(day(-5)));
  await win.locator('#loan-borrow').press('Tab');
  await win.locator('#loan-due').fill(dmy(day(-1)));
  await win.locator('#loan-due').press('Tab');
  await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
  await win.waitForTimeout(500);
  const overdueRow = await eqRow1.innerText();
  const overdueN = await (async () => {
    await win.locator('select[aria-label="Trạng thái mượn"]').selectOption('overdue');
    const n = await win.locator('.equipment-table tbody tr.clickable').count();
    await win.locator('select[aria-label="Trạng thái mượn"]').selectOption('all');
    return n;
  })();
  check('Quá ngày hẹn trả mà chưa bấm Đã hoàn trả → trạng thái Quá hạn', /Quá hạn/.test(overdueRow) && /Quá hạn 1 ngày/.test(overdueRow) && overdueN === 1, overdueRow.replace(/\s+/g, ' ').slice(0, 140));

  await eqPanel.getByRole('button', { name: /^Đã hoàn trả lần mượn/ }).click();
  await win.waitForSelector('.modal #loan-return');
  const retDefault = await win.locator('#loan-return').inputValue();
  await win.locator('#loan-return').fill(dmy(day(-1)));
  await win.locator('#loan-return').press('Tab');
  await win.locator('.modal textarea[aria-label="Tình trạng khi trả"]').fill('Trầy nhẹ vỏ, đủ phụ kiện');
  await shot(win, '47-equipment-return');
  await win.locator('.modal-foot').getByRole('button', { name: 'Xác nhận hoàn trả' }).click();
  await win.waitForTimeout(500);
  eq = (await call(win, 'listEquipment'))[0];
  const backTxt = await eqPanel.innerText();
  await shot(win, '47-equipment-panel');
  check(
    'Đã hoàn trả: Ngày trả thực tế mặc định hôm nay (sửa được), về Trong kho, Tình trạng lấy theo lần trả cuối',
    retDefault === dmy(day(0)) && eq.loans[0].returnDate === day(-1) && eq.currentBorrowDate === null && eq.condition === 'Trầy nhẹ vỏ, đủ phụ kiện' &&
      /Trong kho/.test(backTxt) && /Ngày trả thực tế\s+\d{2}\/\d{2}\/\d{4}/.test(backTxt) && /theo lần trả/.test(backTxt) && (await eqPanel.getByRole('button', { name: 'Thêm lần mượn' }).isEnabled()),
    `mặc định ${retDefault} → trả ${eq.loans[0].returnDate} · ${eq.condition}`,
  );

  const eqRows = () => win.locator('.equipment-table tbody tr.clickable').count();
  const stateSel = win.locator('select[aria-label="Trạng thái mượn"]');
  await stateSel.selectOption('lent');
  const nLent = await eqRows();
  await stateSel.selectOption('in');
  const nIn = await eqRows();
  await stateSel.selectOption('all');
  const eqSearch = win.locator('.toolbar input[aria-label^="Tìm STT"]');
  await eqSearch.fill('si alpha');
  const nSi = await eqRows();
  await eqSearch.fill('khong co thiet bi nay');
  const nNone = await eqRows();
  await eqSearch.fill('');
  check('Kho thiết bị: lọc Trạng thái (Đang cho mượn / Trong kho), tìm theo SI đã mượn', nLent === 0 && nIn === 1 && nSi === 1 && nNone === 0, `lent ${nLent}, in ${nIn}, "si alpha" ${nSi}`);

  await eqPanel.getByRole('button', { name: 'Duplicate' }).click();
  await win.waitForSelector('.modal #eq-name');
  await win.waitForTimeout(300);
  const dupEqName = await win.locator('#eq-name').inputValue();
  const dupEqStt = await win.locator('.modal input[aria-label="STT"]').inputValue();
  const dupSerial = await win.locator('#eq-serial').inputValue();
  await win.locator('#eq-serial').fill('ACCC8E-7732');
  await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
  await win.waitForTimeout(500);
  const eqs = await call(win, 'listEquipment');
  check(
    'Duplicate thiết bị: chép Tên sp / Phân loại / Hãng / Mô tả, STT tiếp theo, Serial và Ngày nhận bàn giao để trống, không chép lịch sử mượn',
    dupEqName === 'Camera Axis P1375-E' && dupEqStt === '2' && dupSerial === '' && eqs.length === 2 && eqs[0].stt === 2 && eqs[0].categoryName === 'Camera' && eqs[0].brandName === 'Axis' && eqs[0].description === 'Camera bullet 4MP, kèm chân đế' && eqs[0].handoverDate === null && eqs[0].loans.length === 0,
    `${dupEqStt}. ${dupEqName}`,
  );

  // Kéo mép tiêu đề cột / mép dưới dòng để đổi kích thước (lưu lại), bấm đúp mép dòng để trả về
  {
    const sortBefore = await win.evaluate(() => localStorage.getItem('ppm:equipment-sort'));
    const th = win.locator('.equipment-table th[data-col="name"]');
    const before = await th.boundingBox();
    await win.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
    await win.mouse.down();
    await win.mouse.move(before.x + before.width + 60, before.y + before.height / 2, { steps: 6 });
    await win.mouse.up();
    const after = await th.boundingBox();
    const sortAfter = await win.evaluate(() => localStorage.getItem('ppm:equipment-sort'));
    const row = win.locator('.equipment-table tbody tr[data-row]').first();
    const rb = await row.boundingBox();
    await win.mouse.move(rb.x + 40, rb.y + rb.height - 2);
    await win.mouse.down();
    await win.mouse.move(rb.x + 40, rb.y + rb.height + 50, { steps: 6 });
    await win.mouse.up();
    const rb2 = await row.boundingBox();
    const saved = await win.evaluate(() => JSON.parse(localStorage.getItem('ppm:tbl-size:equipment') ?? 'null'));
    await shot(win, '49-table-resize');
    const viewOpened = await win.locator('.modal .loan-log').count();
    await win.mouse.dblclick(rb2.x + 40, rb2.y + rb2.height - 2);
    await win.waitForTimeout(200);
    const rb3 = await row.boundingBox();
    const viewAfterDbl = await win.locator('.modal .loan-log').count();
    check(
      'Bảng: kéo mép cột đổi độ rộng, kéo mép dòng đổi chiều cao (lưu lại); bấm đúp mép dòng trả về, không mở View info / không sắp xếp',
      after.width >= before.width + 50 && rb2.height >= rb.height + 40 && !!saved?.cols?.name && Object.keys(saved?.rows ?? {}).length === 1 && rb3.height < rb2.height - 30 && viewOpened === 0 && viewAfterDbl === 0 && sortAfter === sortBefore,
      `cột ${Math.round(before.width)}→${Math.round(after.width)}px · dòng ${Math.round(rb.height)}→${Math.round(rb2.height)}→${Math.round(rb3.height)}px`,
    );
  }

  await win.locator('.equipment-table tbody tr', { hasText: 'ACCC8E-7731' }).dblclick();
  await win.waitForSelector('.modal .loan-log');
  await win.waitForTimeout(400);
  const viewTxt = await win.locator('.modal').innerText();
  await shot(win, '48-equipment-view-info');
  check(
    'View info thiết bị: đủ thông tin và lịch sử mượn / trả (kèm Ngày trả thực tế, ảnh lần mượn)',
    /ACCC8E-7731/.test(viewTxt) && /lịch sử mượn \/ trả/i.test(viewTxt) && /Demo cho khách ABC/.test(viewTxt) && /Trầy nhẹ vỏ/.test(viewTxt) && /Ngày nhận bàn giao\s*15\/10\/2026/.test(viewTxt) && /Phân loại\s*Camera/.test(viewTxt) && /Ngày trả thực tế/.test(viewTxt) && (await win.locator('.modal .loan-images img').count()) === 1,
    viewTxt.replace(/\s+/g, ' ').slice(0, 160),
  );
  await win.locator('.modal-foot').getByRole('button', { name: 'Đóng' }).click();

  const eqHits = (await call(win, 'globalSearch', { mode: 'serial', text: 'ACCC8E-7731' })).filter((h) => h.kind === 'equipment');
  check('Tìm kiếm toàn cục theo Serial ra thiết bị trong Kho', eqHits.length === 1 && eqHits[0].title === '1. Camera Axis P1375-E', eqHits.map((h) => h.title).join(', '));

  await win.locator('.equipment-table tbody tr', { hasText: 'ACCC8E-7732' }).click();
  await win.locator('.side-panel').getByRole('button', { name: 'Xóa' }).click();
  await win.locator('.modal').getByRole('button', { name: 'Xóa', exact: true }).click();
  await win.waitForTimeout(400);
  check('Xóa thiết bị', (await eqRows()) === 1 && (await call(win, 'listEquipment')).length === 1);

  // --- v1.9: Tìm kiếm trên topbar → mở đúng chỗ và tô sáng từ khóa; bấm bất kỳ đâu để bỏ ---
  await go(win, '#/');
  await win.waitForTimeout(300);
  await win.locator('select[aria-label="Kiểu tìm kiếm"]').selectOption('serial');
  await win.locator('.gsearch-input').fill('accc8e-7731');
  await win.waitForSelector('.gsearch-results .opt');
  await win.locator('.gsearch-results .opt', { hasText: 'Kho thiết bị' }).first().click();
  await win.waitForFunction(() => (CSS.highlights?.get('ppm-search')?.size ?? 0) > 0, null, { timeout: 5000 }).catch(() => undefined);
  const hl = await win.evaluate(() => {
    const h = CSS.highlights?.get('ppm-search');
    return { n: h?.size ?? 0, text: h ? [...h].map((r) => r.toString()).slice(0, 3) : [], hash: location.hash };
  });
  const hlPanel = await win.locator('.side-panel').isVisible();
  await shot(win, '50-search-highlight');
  await win.locator('.page-head h1').click();
  const hlAfter = await win.evaluate(() => CSS.highlights?.get('ppm-search')?.size ?? 0);
  check(
    'Bấm kết quả tìm kiếm: mở đúng thiết bị, tô sáng từ khóa (không phân biệt hoa thường), bấm chỗ trống thì bỏ tô sáng',
    hl.hash.startsWith('#/equipment') && hlPanel && hl.n >= 1 && hl.text.every((t) => t.toLowerCase() === 'accc8e-7731') && hlAfter === 0,
    `${hl.hash} · ${hl.n} chỗ (${hl.text.join(', ')}) → sau khi bấm: ${hlAfter}`,
  );
  await win.locator('.gsearch-input').fill('');

  // --- v1.9: Job Freelance — Trạng thái thanh toán, màu Tình trạng ---
  await go(win, '#/settings');
  await win.getByRole('button', { name: 'Danh mục (Master Data)' }).click();
  await win.locator('[aria-label="Phân loại danh mục"]').getByRole('button', { name: 'Job Freelance' }).click();
  await win.getByRole('button', { name: 'Tình trạng', exact: true }).click();
  await win.locator('input[aria-label="Màu của Đang làm"]').fill('#0ea5e9');
  await win.waitForTimeout(900);
  const flStatus = (await call(win, 'listMaster', 'freelanceStatuses')).find((m) => m.name === 'Đang làm');
  await shot(win, '51-master-status-colors');
  const eqTabs = await (async () => {
    await win.locator('[aria-label="Phân loại danh mục"]').getByRole('button', { name: 'Kho thiết bị' }).click();
    await win.waitForTimeout(200);
    return (await win.locator('.tabs.small button').allInnerTexts()).join('|');
  })();
  await go(win, '#/freelance');
  await win.waitForSelector('.freelance-table');
  const flRow = win.locator('.freelance-table tbody tr').first();
  await flRow.locator('select[aria-label^="Tình trạng"]').selectOption({ label: 'Đang làm' });
  await win.waitForTimeout(300);
  await flRow.locator('select[aria-label^="Trạng thái thanh toán"]').selectOption({ label: 'Đã thanh toán' });
  await win.waitForTimeout(400);
  const statusStyle = await flRow.locator('select[aria-label^="Tình trạng"]').evaluate((el) => getComputedStyle(el).borderTopColor);
  const contrast = await flRow.locator('select[aria-label^="Tình trạng"]').evaluate((el) => {
    const ctx2 = document.createElement('canvas').getContext('2d');
    const rgb = (c) => {
      ctx2.clearRect(0, 0, 1, 1);
      ctx2.fillStyle = '#000';
      ctx2.fillStyle = c;
      ctx2.fillRect(0, 0, 1, 1);
      const d = ctx2.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const o = getComputedStyle(el.options[1]);
    const sel = getComputedStyle(el);
    return { select: ratio(sel.color, sel.backgroundColor), option: ratio(o.color, o.backgroundColor), selAlpha: rgb(sel.backgroundColor)[3], optAlpha: rgb(o.backgroundColor)[3] };
  });
  check(
    'Ô Tình trạng Freelance: chữ tương phản rõ với nền (cả ô chọn lẫn danh sách xổ xuống), nền không trong suốt',
    contrast.select >= 4.5 && contrast.option >= 4.5 && contrast.selAlpha === 255 && contrast.optAlpha === 255,
    `ô ${contrast.select.toFixed(1)}:1 · danh sách ${contrast.option.toFixed(1)}:1`,
  );
  const flHeads2 = (await win.locator('.freelance-table th').allInnerTexts()).map((t) => t.replace(/[▲▼]/g, '').trim()).filter(Boolean);
  const flJob = (await call(win, 'listFreelance')).find((j) => j.paymentStatusName === 'Đã thanh toán') ?? {};
  await shot(win, '52-freelance-payment');
  check(
    'Job Freelance: cột Thanh toán (danh mục riêng, có màu), Tình trạng tô màu theo Settings; Master Data có Kho thiết bị › Phân loại',
    flHeads2.includes('Thanh toán') && flJob.paymentStatusName === 'Đã thanh toán' && flStatus?.color === '#0ea5e9' && flJob.statusColor === '#0ea5e9' && statusStyle === 'rgb(14, 165, 233)' && eqTabs === 'Phân loại',
    `${flJob.statusName} ${flJob.statusColor} · ${flJob.paymentStatusName} · viền ${statusStyle} · tabs ${eqTabs}`,
  );

  // --- v1.9: Đổi tên My Workspace ---
  await win.locator('.sidebar .ws-name').dblclick();
  await win.locator('.sidebar input[aria-label="Tên workspace"]').fill('Kho dự án Tùng');
  await win.locator('.sidebar input[aria-label="Tên workspace"]').press('Enter');
  await win.waitForTimeout(300);
  const wsName = await win.locator('.sidebar .ws-name').innerText();
  const wsSaved = (await call(win, 'getSettings')).workspaceName;
  check('Đổi tên "My Workspace" ngay trên sidebar (lưu lại)', wsName === 'Kho dự án Tùng' && wsSaved === 'Kho dự án Tùng', `${wsName} / ${wsSaved}`);

  // --- v1.9: To-do list ---
  await win.locator('.sidebar').getByRole('link', { name: 'To-do list' }).click();
  await win.waitForSelector('text=Chưa có việc nào cho');
  const todoDate = await win.locator('#todo-date').inputValue();
  await win.getByRole('button', { name: 'Chọn dự án / job' }).first().click();
  await win.waitForSelector('.todo-pick-list');
  const pickTxt = await win.locator('.todo-pick-list').innerText();
  await win.locator('.modal [aria-label="Loại job"]').getByRole('button', { name: 'Job Chính' }).click();
  await win.locator('.todo-pick input').nth(0).check();
  await win.locator('.todo-pick input').nth(1).check();
  await win.locator('.modal [aria-label="Loại job"]').getByRole('button', { name: 'Job Freelance' }).click();
  await win.locator('.todo-pick input').nth(0).check();
  await win.locator('.modal-foot').getByRole('button', { name: /^Thêm 3 việc$/ }).click();
  await win.waitForSelector('.todo-item');
  let todoList = await call(win, 'listTodos', day(0));
  check(
    'To-do list (dưới Calendar): mặc định hôm nay, chọn dự án Job Chính (không có Warranty) và job Freelance',
    todoDate === dmy(day(0)) && todoList.length === 3 && todoList.filter((t) => t.kind === 'MAIN').length === 2 && todoList.filter((t) => t.kind === 'FREELANCE').length === 1 && !/Warranty/.test(pickTxt),
    todoList.map((t) => `${t.kind}:${t.title}`).join(' | '),
  );
  const firstBefore = todoList[0].id;
  const third = todoList[2];
  await win.locator(`[data-grip="${third.id}"]`).dragTo(win.locator(`li[data-todo="${firstBefore}"]`), { targetPosition: { x: 30, y: 4 } });
  await win.waitForTimeout(500);
  todoList = await call(win, 'listTodos', day(0));
  const dragOk = todoList[0].id === third.id;
  await win.locator(`[data-grip="${todoList[2].id}"]`).focus();
  const movedId = todoList[2].id;
  await win.keyboard.press('ArrowUp');
  await win.waitForTimeout(400);
  todoList = await call(win, 'listTodos', day(0));
  check('To-do: kéo biểu tượng ☰ để đổi thứ tự ưu tiên (hoặc phím mũi tên)', dragOk && todoList[1].id === movedId, todoList.map((t) => t.title).join(' > '));
  await win.getByRole('button', { name: `Đánh dấu đã hoàn thành: ${todoList[0].title}` }).click();
  await win.waitForTimeout(400);
  todoList = await call(win, 'listTodos', day(0));
  const doneTxt = await win.locator('section', { hasText: 'Đã hoàn thành (1)' }).innerText().catch(() => '');
  await shot(win, '53-todo-list');
  check(
    'To-do: đánh dấu Đã hoàn thành → chuyển sang mục Đã hoàn thành',
    todoList.filter((t) => t.doneAt).length === 1 && todoList[2].doneAt && /Đã hoàn thành/.test(doneTxt) && (await win.locator('.todo-item.done').count()) === 1,
    todoList.map((t) => `${t.title}${t.doneAt ? ' ✓' : ''}`).join(' > '),
  );

  // --- v1.11: To-do — việc tự nhập (chỉ có tên), xem 3 / 5 / 7 ngày ---
  {
    const quick = win.locator(`input[aria-label="Thêm việc mới ngày ${dmy(day(0))}"]`);
    await quick.fill('Gọi lại khách hàng ABC');
    await quick.press('Enter');
    await win.waitForTimeout(400);
    let list = await call(win, 'listTodos', day(0));
    const task = list.find((t) => t.kind === 'TASK');
    const cleared = (await quick.inputValue()) === '';
    await win.locator('.todo-item .todo-title', { hasText: 'Gọi lại khách hàng ABC' }).dblclick();
    await win.locator('input[aria-label="Tên việc"]').fill('Gọi lại khách hàng ABC lúc 15h');
    await win.locator('input[aria-label="Tên việc"]').press('Enter');
    await win.waitForTimeout(400);
    list = await call(win, 'listTodos', day(0));
    check(
      'To-do: thêm việc mới chỉ cần Tên (Enter), đổi tên bằng bấm đúp; nằm cuối danh sách cần làm',
      !!task && task.targetId === null && cleared && list.find((t) => t.id === task.id)?.title === 'Gọi lại khách hàng ABC lúc 15h' && list.filter((t) => !t.doneAt).at(-1)?.id === task.id,
      list.map((t) => `${t.kind}:${t.title}${t.doneAt ? ' ✓' : ''}`).join(' | '),
    );

    const view = win.locator('[aria-label="Chế độ xem"]');
    await view.getByRole('button', { name: '3 ngày' }).click();
    await win.waitForSelector('.todo-day.v-column');
    const cols3 = await win.locator('.todo-day.v-column:not(.nodate)').count();
    const boxes3 = await Promise.all((await win.locator('.todo-day.v-column:not(.nodate)').all()).map((l) => l.boundingBox()));
    const tomorrowInput = win.locator(`input[aria-label="Thêm việc mới ngày ${dmy(day(1))}"]`);
    await tomorrowInput.fill('Chuẩn bị tài liệu nghiệm thu');
    await tomorrowInput.press('Enter');
    await win.waitForTimeout(400);
    const range3 = await call(win, 'listTodosRange', day(0), day(2));
    await shot(win, '55-todo-3-days');
    check(
      'To-do xem 3 ngày: 3 cột dọc cạnh nhau, thêm việc thẳng vào cột ngày mai',
      cols3 === 3 && boxes3.every((b, i) => i === 0 || (Math.abs(b.y - boxes3[0].y) < 2 && b.x > boxes3[i - 1].x)) &&
        range3.some((t) => t.todoDate === day(1) && t.title === 'Chuẩn bị tài liệu nghiệm thu') && (await win.locator('.todo-day.today').count()) === 1,
      `${cols3} cột · ${range3.length} việc trong 3 ngày`,
    );
    await view.getByRole('button', { name: '5 ngày' }).click();
    await win.waitForTimeout(400);
    const cols5 = await win.locator('.todo-day.v-column:not(.nodate)').count();
    const boxes5 = await Promise.all((await win.locator('.todo-day.v-column:not(.nodate)').all()).map((l) => l.boundingBox()));
    await shot(win, '56-todo-5-days');
    await view.getByRole('button', { name: '7 ngày' }).click();
    await win.waitForTimeout(400);
    const rows7 = await win.locator('.todo-day.v-row').count();
    const boxes7 = await Promise.all((await win.locator('.todo-day.v-row').all()).map((l) => l.boundingBox()));
    const heads7 = await win.locator('.todo-day.v-row .todo-day-head').allInnerTexts();
    await shot(win, '57-todo-7-days');
    check(
      'To-do xem 5 ngày (5 cột dọc) và 7 ngày (liệt kê từng ngày từ trên xuống)',
      cols5 === 5 && boxes5.every((b) => Math.abs(b.y - boxes5[0].y) < 2) && rows7 === 7 && boxes7.every((b, i) => i === 0 || (Math.abs(b.x - boxes7[0].x) < 2 && b.y > boxes7[i - 1].y)) &&
        heads7[0].includes(dmy(day(0))) && heads7[6].includes(dmy(day(6))),
      `${cols5} cột · ${rows7} ngày: ${heads7[0].replace(/\s+/g, ' ')} … ${heads7[6].replace(/\s+/g, ' ')}`,
    );
    await win.getByRole('button', { name: '7 ngày sau' }).click();
    await win.waitForTimeout(300);
    const next7 = await win.locator('.todo-day.v-row .todo-day-head').first().innerText();
    await view.getByRole('button', { name: '1 ngày' }).click();
    await win.getByRole('button', { name: 'Hôm nay', exact: true }).click();
    await win.waitForTimeout(300);
    check('To-do: nút sau / trước nhảy theo số ngày đang xem; quay lại 1 ngày', next7.includes(dmy(day(7))) && (await win.locator('#todo-date').inputValue()) === dmy(day(0)), next7.replace(/\s+/g, ' '));
  }

  // --- v1.14: To-do — mục Vô thời hạn, kéo việc sang ngày khác ---
  {
    const view = win.locator('[aria-label="Chế độ xem"]');
    await win.locator('.todo-day.nodate').waitFor();
    const nd = win.locator('input[aria-label="Thêm việc mới Vô thời hạn"]');
    await nd.fill('Đọc tài liệu SDK mới');
    await nd.press('Enter');
    await win.waitForTimeout(400);
    const seen = [];
    for (const label of ['3 ngày', '5 ngày', '7 ngày', '1 ngày']) {
      await view.getByRole('button', { name: label }).click();
      await win.waitForTimeout(300);
      seen.push(await win.locator('.todo-day.nodate').isVisible());
    }
    let today = await call(win, 'listTodos', day(0));
    const mover = today.find((t) => !t.doneAt && t.kind === 'TASK') ?? today.find((t) => !t.doneAt);
    await win.locator('[data-grip="' + mover.id + '"]').dragTo(win.locator('.todo-day.nodate .todo-day-head'), { targetPosition: { x: 20, y: 8 } });
    await win.waitForTimeout(700);
    let undated = await call(win, 'listTodos', '');
    today = await call(win, 'listTodos', day(0));
    await shot(win, '63-todo-no-date');
    check(
      'To-do: mục Vô thời hạn luôn hiện ở 1 / 3 / 5 / 7 ngày; thêm việc mới tại đây; kéo việc của ngày vào Vô thời hạn',
      seen.every(Boolean) && undated.some((t) => t.title === 'Đọc tài liệu SDK mới' && t.todoDate === '') && undated.some((t) => t.id === mover.id) && !today.some((t) => t.id === mover.id),
      undated.map((t) => t.title).join(' | '),
    );

    await view.getByRole('button', { name: '3 ngày' }).click();
    await win.waitForTimeout(400);
    let tomorrow = await call(win, 'listTodos', day(1));
    const first = tomorrow.find((t) => !t.doneAt);
    await win.locator('[data-grip="' + mover.id + '"]').dragTo(win.locator('li[data-todo="' + first.id + '"]'), { targetPosition: { x: 30, y: 3 } });
    await win.waitForTimeout(700);
    tomorrow = await call(win, 'listTodos', day(1));
    await shot(win, '64-todo-drag-to-day');

    await view.getByRole('button', { name: '1 ngày' }).click();
    await win.waitForTimeout(400);
    today = await call(win, 'listTodos', day(0));
    const m2 = today.find((t) => !t.doneAt);
    const gb = await win.locator('[data-grip="' + m2.id + '"]').boundingBox();
    await win.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
    await win.mouse.down();
    await win.mouse.move(gb.x + 40, gb.y + 40, { steps: 6 });
    const chip = win.locator('[data-drop-day="' + day(2) + '"]');
    const chipShown = await chip.waitFor({ timeout: 3000 }).then(() => true, () => false);
    if (chipShown) {
      await shot(win, '65-todo-drop-days');
      const cb = await chip.boundingBox();
      await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 10 });
    }
    await win.mouse.up();
    await win.waitForTimeout(700);
    const d2 = await call(win, 'listTodos', day(2));
    check(
      'To-do: kéo việc từ Vô thời hạn vào đầu danh sách ngày mai (3 ngày); xem 1 ngày thì thả lên ô ngày khác',
      tomorrow[0]?.id === mover.id && tomorrow[0].todoDate === day(1) && chipShown && d2.some((t) => t.id === m2.id),
      'ngày mai: ' + tomorrow.map((t) => t.title).join(' > ') + ' · ' + dmy(day(2)) + ': ' + d2.map((t) => t.title).join(', '),
    );
  }

  // --- v1.14: Password — Ghi chú chèn được link ---
  {
    await win.locator('.sidebar a[href="#/passwords"]').click();
    await win.waitForSelector('code.secret');
    await win.getByRole('button', { name: 'Sửa Cổng hãng Axis' }).click();
    await win.locator('#pw-note').fill('Đăng nhập bằng mã đối tác. ');
    await win.locator('.modal').getByRole('button', { name: 'Chèn link' }).click();
    await win.locator('input[aria-label="Tên hiển thị của link"]').fill('Hướng dẫn');
    await win.locator('.link-note-form input[aria-label="Link website"]').fill('https://www.axis.com/partner');
    await win.locator('.link-note-form').getByRole('button', { name: 'Chèn', exact: true }).click();
    const preview = await win.locator('.link-note-preview .note-link').innerText();
    await shot(win, '66-password-note-form');
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
    await win.waitForTimeout(400);
    await app.evaluate(({ shell }) => {
      globalThis.__opened = [];
      shell.openExternal = async (u) => {
        globalThis.__opened.push(u);
      };
    });
    await win.locator('.note-cell .note-link', { hasText: 'Hướng dẫn' }).click();
    await win.waitForTimeout(300);
    const opened = await app.evaluate(() => globalThis.__opened);
    const saved = (await call(win, 'listPasswords')).find((x) => x.siteName === 'Cổng hãng Axis');
    await shot(win, '67-password-note');
    check(
      'Password: trường Ghi chú, Chèn link → hiện thành link bấm mở trình duyệt',
      saved.note === 'Đăng nhập bằng mã đối tác. [Hướng dẫn](https://www.axis.com/partner)' && preview === 'Hướng dẫn' && opened?.[0]?.startsWith('https://www.axis.com/partner'),
      saved.note + ' → ' + (opened?.[0] ?? '(không mở)'),
    );
  }

  // --- v1.14: Kiến thức — xóa trên dòng, xóa Hãng, mục Website - App - Địa điểm ---
  {
    const tmpBrand = await call(win, 'createMaster', 'brands', 'Hãng tạm thử');
    await call(win, 'createKnowledge', { brandId: tmpBrand.id, knowledgeDate: day(0), title: 'Ghi chú tạm', deviceModel: '', content: 'abc', webUrl: '', images: [] });
    await win.reload();
    await win.waitForSelector('.sidebar');
    await go(win, '#/knowledge');
    await win.waitForSelector('.brand-card');
    const placesCard = await win.locator('.brand-card', { hasText: 'Website - App - Địa điểm' }).isVisible();
    await win.locator('.brand-card-wrap', { hasText: 'Hãng tạm thử' }).hover();
    await win.getByRole('button', { name: 'Xóa Hãng Hãng tạm thử khỏi Kiến thức' }).click();
    await win.waitForSelector('.modal .radio-list');
    const dlg = await win.locator('.modal').innerText();
    await shot(win, '68-knowledge-remove-brand');
    await win.locator('.modal-foot').getByRole('button', { name: 'Xóa Hãng' }).click();
    await win.waitForTimeout(600);
    const brandsNow = await call(win, 'listMaster', 'brands');
    const general = await call(win, 'listKnowledge', { brandId: null });
    const cardGone = (await win.locator('.brand-card-wrap', { hasText: 'Hãng tạm thử' }).count()) === 0;
    check(
      'Kiến thức: xóa Hãng (chưa dùng ở đâu khác → xóa hẳn khỏi danh mục), bài chuyển sang Kiến thức chung',
      placesCard && /chưa được dùng ở đâu khác/.test(dlg) && !brandsNow.some((b) => b.id === tmpBrand.id) && general.some((k) => k.title === 'Ghi chú tạm') && cardGone,
      general.map((k) => k.title).join(' | '),
    );
    await go(win, '#/knowledge/general');
    await win.waitForTimeout(400);
    await win.getByRole('button', { name: 'Xóa Ghi chú tạm' }).click();
    await win.locator('.modal').getByRole('button', { name: 'Xóa', exact: true }).click();
    await win.waitForTimeout(500);
    check('Kiến thức: nút xóa ngay trên từng dòng', !(await call(win, 'listKnowledge', { brandId: null })).some((k) => k.title === 'Ghi chú tạm'));

    await go(win, '#/knowledge');
    await win.locator('.brand-card', { hasText: 'Website - App - Địa điểm' }).click();
    await win.waitForSelector('text=Chưa có mục nào trong Website - App - Địa điểm');
    await win.locator('.page-head').getByRole('button', { name: 'Thêm' }).click();
    await win.locator('#pl-cat').selectOption('PLACE');
    await win.locator('#pl-name').fill('Kho thiết bị Bắc Ninh');
    await win.locator('#pl-note').fill('Cổng sau, gọi bảo vệ. ');
    await win.locator('.modal').getByRole('button', { name: 'Chèn link' }).click();
    await win.locator('input[aria-label="Tên hiển thị của link"]').fill('Bản đồ');
    await win.locator('.link-note-form input[aria-label="Link website"]').fill('https://maps.google.com/?q=Bac+Ninh');
    await win.locator('.link-note-form').getByRole('button', { name: 'Chèn', exact: true }).click();
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu' }).click();
    await win.waitForTimeout(400);
    await call(win, 'createPlace', { category: 'WEBSITE', name: 'Tra cứu bảo hành Axis', note: 'https://www.axis.com/support/warranty' });
    await call(win, 'createPlace', { category: 'APP', name: 'Axis Site Designer', note: '' });
    await call(win, 'createPlace', { category: null, name: 'Danh bạ đối tác', note: '' });
    await win.reload();
    await win.waitForSelector('.places-table');
    const all = await win.locator('.places-table tbody tr').count();
    await win.locator('[aria-label="Lọc theo Phân loại"]').getByRole('button', { name: /^App/ }).click();
    const apps = await win.locator('.places-table tbody tr').allInnerTexts();
    await win.locator('[aria-label="Lọc theo Phân loại"]').getByRole('button', { name: /^Chưa phân loại/ }).click();
    const none = await win.locator('.places-table tbody tr').allInnerTexts();
    await win.locator('[aria-label="Lọc theo Phân loại"]').getByRole('button', { name: /^Tất cả/ }).click();
    await win.getByPlaceholder('Tìm theo Tên…').fill('bao hanh');
    await win.waitForTimeout(200);
    const found = await win.locator('.places-table tbody tr').allInnerTexts();
    await win.getByPlaceholder('Tìm theo Tên…').fill('');
    await win.waitForTimeout(200);
    const linkTxt = await win.locator('.places-table .note-link', { hasText: 'Bản đồ' }).count();
    await shot(win, '69-knowledge-places');
    check(
      'Kiến thức › Website - App - Địa điểm: bảng STT / Phân loại / Tên / Note (link), lọc theo Phân loại, tìm theo Tên',
      all === 4 && apps.length === 1 && /Axis Site Designer/.test(apps[0]) && none.length === 1 && /Danh bạ/.test(none[0]) && found.length === 1 && /Tra cứu bảo hành/.test(found[0]) && /^1\b/.test(found[0].trim()) === false && linkTxt === 1,
      all + ' mục · App: ' + apps.length + ' · tìm "bao hanh": ' + found.map((t) => t.replace(/\s+/g, ' ')).join(''),
    );
  }

  // --- v1.14: Pre/Post-sales — Link ERP ---
  {
    const pErp = created[1];
    await go(win, '#/project/' + pErp.id);
    await win.waitForTimeout(400);
    await win.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
    await win.waitForSelector('#pf-erp');
    await win.locator('#pf-erp').fill('khong phai link');
    await win.locator('#pf-erp').blur();
    const erpErr = await win.locator('.modal .field-error', { hasText: 'Link ERP' }).count();
    await win.locator('#pf-erp').fill('https://erp.congty.vn/du-an/' + pErp.stt);
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu', exact: true }).click();
    await win.waitForTimeout(600);
    const chip = await win.locator('.info-grid .link-chip').innerText().catch(() => '');
    const pSaved = (await call(win, 'listProjects')).find((x) => x.id === pErp.id);
    await shot(win, '70-project-erp-link');
    check('Pre/Post-sales: Link ERP (không bắt buộc, phải là link), hiện ở thông tin dự án', erpErr === 1 && pSaved.erpLink === 'https://erp.congty.vn/du-an/' + pErp.stt && chip.includes('erp.congty.vn'), pSaved.erpLink);
  }

  // --- v1.14: Warranty — Dự án (dự án Pre/Post-sales hoặc nhập mới vào danh mục), Tên SI + Dự án cùng dòng, MAC + Serial cùng dòng ---
  {
    const mainYear = (await call(win, 'listYears')).find((y) => y.jobType === 'MAIN');
    await go(win, '#/job/MAIN/' + mainYear.id + '/warranty');
    await win.waitForTimeout(500);
    await win.locator('.page-head').getByRole('button', { name: 'Add Record' }).click();
    await win.waitForSelector('.modal');
    const fieldY = async (label) => (await win.locator('.modal .field', { has: win.locator('label', { hasText: new RegExp('^' + label) }) }).first().boundingBox()).y;
    const [ySi, yProject, yMac, ySerial, yModel] = [await fieldY('Tên SI'), await fieldY('Dự án'), await fieldY('MAC'), await fieldY('Serial number'), await fieldY('Model')];
    await win.locator('.modal .form-section', { hasText: 'Thiết bị' }).locator('input.input').first().fill('AXIS M3086-V');
    const projCombo = win.locator('.modal .field', { has: win.locator('label', { hasText: /^Dự án/ }) }).locator('input[role="combobox"]');
    await projCombo.click();
    await projCombo.fill('Showroom Ô tô Hòa Bình');
    await win.getByRole('button', { name: /Thêm dự án mới “Showroom Ô tô Hòa Bình”/ }).click();
    await win.waitForTimeout(400);
    await shot(win, '71-warranty-project');
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu', exact: true }).click();
    await win.waitForTimeout(600);
    const recs = await call(win, 'listWarranty', mainYear.id);
    const rec = recs.find((r) => r.model === 'AXIS M3086-V');
    const entries = await call(win, 'listMaster', 'warrantyProjects');
    const proj = (await call(win, 'listProjects')).find((x) => x.workCategory === 'PRE_SALES');
    const r2 = await call(win, 'updateWarranty', rec.id, { ...rec, projectId: proj.id, projectEntryId: null });
    check(
      'Warranty: trường Dự án — nhập mới tự lưu vào danh mục Dự án (Warranty), chọn được dự án Pre/Post-sales; Tên SI + Dự án cùng dòng, MAC + Serial cùng dòng',
      Math.abs(ySi - yProject) < 2 && Math.abs(yMac - ySerial) < 2 && yMac > ySi && ySi > yModel &&
        rec?.projectName === 'Showroom Ô tô Hòa Bình' && entries.some((m) => m.name === 'Showroom Ô tô Hòa Bình' && m.usageCount === 1) && r2.projectName === proj.stt + '. ' + proj.projectName,
      (rec?.projectName ?? '—') + ' · ' + r2.projectName,
    );
  }

  // --- v1.14: Job Freelance — Người đồng hành (nhiều người) và các lần thanh toán ---
  {
    const job = (await call(win, 'listFreelance'))[0];
    await go(win, '#/freelance');
    await win.waitForTimeout(400);
    await win.getByRole('button', { name: 'Sửa ' + job.projectName, exact: true }).click();
    await win.waitForSelector('.modal');
    const comp = win.locator('.modal .field', { has: win.locator('label', { hasText: /^Người đồng hành/ }) }).locator('input[role="combobox"]');
    for (const name of ['Anh Tuấn', 'Chị Lan']) {
      await comp.click();
      await comp.fill(name);
      await win.getByRole('button', { name: new RegExp('Thêm người đồng hành “' + name + '”') }).click();
      await win.waitForTimeout(300);
    }
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu', exact: true }).click();
    await win.waitForTimeout(600);
    await go(win, '#/freelance/' + job.id);
    await win.waitForTimeout(400);
    await win.getByRole('button', { name: 'Xem thanh toán cho Anh Tuấn' }).click();
    await win.waitForSelector('#cp-amount');
    for (const [amount, note] of [['1500000', 'Đợt 1 — vẽ shopdrawing'], ['500000', 'Đợt 2']]) {
      await win.locator('#cp-amount').fill(amount);
      await win.locator('#cp-note').fill(note);
      if (note === 'Đợt 2') {
        await fakeClipboardImage(app, png);
        await win.locator('.modal .payment-form .form-section h3, .modal .payment-form h3').first().click();
        await pasteImageEvent(win);
        await win.waitForTimeout(800);
      }
      await win.locator('.modal').getByRole('button', { name: 'Ghi thanh toán' }).click();
      await win.waitForTimeout(600);
    }
    const shown = await win.locator('.modal .payment-entry').count();
    const amountTxt = await win.locator('.modal .payment-entry .payment-amount').first().innerText();
    await shot(win, '72-freelance-companion-payments');
    await win.locator('.modal-foot').getByRole('button', { name: 'Đóng' }).click();
    const pays = await call(win, 'listCompanionPayments', job.id);
    const rowTxt = await win.locator('.companion-row', { hasText: 'Anh Tuấn' }).innerText();
    await go(win, '#/freelance');
    await win.waitForTimeout(500);
    const tableRow = await win.locator('.freelance-table tbody tr', { hasText: job.projectName }).innerText();
    await shot(win, '73-freelance-companions-table');
    check(
      'Job Freelance: nhiều Người đồng hành (danh mục), ghi các lần thanh toán (số tiền / note / ảnh, tự log ngày), bảng tổng hợp hiện số lần đã thanh toán',
      shown === 2 && pays.length === 2 && pays.every((x) => x.paidDate === day(0)) && pays.some((x) => x.images.length === 1) && /500\.000/.test(amountTxt) &&
        /2 lần/.test(rowTxt) && /Anh Tuấn, Chị Lan/.test(tableRow) && /2 lần/.test(tableRow),
      tableRow.replace(/\s+/g, ' ').slice(0, 160),
    );
  }

  // --- v1.14: Sự kiện tạm thời (dưới Kho thiết bị) ---
  {
    await win.locator('.sidebar').getByRole('link', { name: 'Sự kiện tạm thời' }).click();
    await win.waitForSelector('text=Chưa có sự kiện nào');
    const sideOrder = await win.evaluate(() => [...document.querySelectorAll('.sidebar .nav-row .nav-label')].map((e) => e.textContent.trim()));
    await win.locator('.page-head').getByRole('button', { name: 'Thêm sự kiện' }).click();
    await win.waitForSelector('#ev-name');
    await win.waitForFunction(() => document.querySelector('#ev-stt')?.value !== '', null, { timeout: 3000 }).catch(() => undefined);
    const sttSuggest = await win.locator('#ev-stt').inputValue();
    await win.locator('#ev-name').fill('Triển lãm Secutech 2026');
    const brandCombo = win.locator('.modal .field', { has: win.locator('label', { hasText: /^Hãng/ }) }).locator('input[role="combobox"]');
    await brandCombo.click();
    await brandCombo.fill('Axis');
    await win.locator('.popover .opt', { hasText: /^Axis$/ }).first().click();
    await win.locator('.modal .note-editor').click();
    await win.keyboard.type('Mang 3 camera demo, 1 NVR');
    await win.locator('.modal-foot').getByRole('button', { name: 'Thêm sự kiện' }).click();
    await win.waitForFunction(() => location.hash.startsWith('#/events/'), null, { timeout: 8000 });
    await win.waitForSelector('text=Chưa có dữ liệu Excel');
    await win.waitForTimeout(400);
    const evId = (await win.evaluate(() => location.hash)).split('/').pop();
    const evDir = path.join(root, 'su-kien-secutech');
    fs.mkdirSync(evDir, { recursive: true });
    const evDoc = path.join(evDir, 'Ke hoach trien lam.docx');
    const evPdf = path.join(evDir, 'Layout gian hang.pdf');
    fs.writeFileSync(evDoc, 'docx');
    fs.writeFileSync(evPdf, 'pdf');
    await stubOpen(app, [evDir]);
    await win.getByRole('button', { name: 'Liên kết thư mục…' }).click();
    await win.waitForTimeout(400);
    await stubOpen(app, [evDoc, evPdf]);
    await win.locator('section', { hasText: 'File & Attachments' }).getByRole('button', { name: 'Chọn file' }).click();
    await win.waitForTimeout(500);
    await stubOpen(app, [xlsxFile]);
    await win.getByRole('button', { name: 'Import .xlsx' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.waitForTimeout(700);
    await stubOpen(app, [path.join(fixtures, 'Tu rack.xlsx')]);
    await win.getByRole('button', { name: 'Thêm bảng mới (import xlsx)' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.waitForTimeout(700);
    const tabs = (await win.locator('.xl-tabs [role="tab"]').allInnerTexts()).map((t) => t.trim());
    await win.locator('.xl-book').scrollIntoViewIfNeeded();
    const sheetBox = await win.locator('.xl-sheet').boundingBox();
    const barBox = await win.locator('.xl-tabbar').boundingBox();
    await win.locator('.page-head').scrollIntoViewIfNeeded();
    await shot(win, '74-event-detail');
    await win.locator('.xl-book').scrollIntoViewIfNeeded();
    await shot(win, '75-event-imports');
    const ev = (await call(win, 'listEvents')).find((e) => e.id === evId);
    const evNotes = await call(win, 'listEventNotes', evId);
    const evImports = await call(win, 'listEventImports', evId);
    check(
      'Sự kiện tạm thời: thêm sự kiện (STT tự gợi ý, Hãng dùng chung), ghi chú hôm nay, liên kết thư mục + file, import nhiều xlsx dạng tab sheet (thanh tab ở trên)',
      sideOrder.indexOf('Sự kiện tạm thời') === sideOrder.indexOf('Kho thiết bị') + 1 && sttSuggest === '1' && ev?.brandName === 'Axis' && ev.folderPath === evDir &&
        ev.files.map((f) => f.extension).join(',') === 'docx,pdf' && evNotes.length === 1 && /Mang 3 camera demo/.test(evNotes[0].text) &&
        evImports.length === 2 && tabs.join('|') === 'Bao gia XYZ|Tu rack' && barBox.y + barBox.height <= sheetBox.y + 2,
      JSON.stringify({ side: sideOrder.slice(sideOrder.indexOf('Kho thiết bị'), sideOrder.indexOf('Kho thiết bị') + 2), stt: sttSuggest, brand: ev?.brandName, folder: ev?.folderPath === evDir, files: ev?.files.length, notes: evNotes.map((n) => n.text), tabs, bar: [barBox.y + barBox.height, sheetBox.y] }),
    );
    await win.locator('.sidebar').getByRole('link', { name: 'Sự kiện tạm thời' }).click();
    await win.waitForSelector('.events-table');
    const row = await win.locator('.events-table tbody tr').first().innerText();
    await shot(win, '76-events-list');
    check('Bảng Sự kiện tạm thời: STT / Tên event / Ngày / Hãng / Note', /^1\s/.test(row.trim()) && row.includes('Triển lãm Secutech 2026') && row.includes(dmy(day(0))) && row.includes('Axis') && row.includes('Mang 3 camera demo'), row.replace(/\s+/g, ' '));
  }

  // --- v1.14: Priority Point có màu, 5 là cao nhất / 1 thấp nhất ---
  {
    const pr = created[3];
    await go(win, '#/project/' + pr.id);
    await win.waitForTimeout(400);
    await win.getByRole('button', { name: 'Chỉnh sửa', exact: true }).click();
    await win.waitForSelector('.prio-picker');
    await win.locator('.prio-picker button', { hasText: '5' }).click();
    const hint = await win.locator('.prio-picker + .field-hint').innerText();
    const pickColors = await win.locator('.prio-picker button').evaluateAll((bs) => bs.map((b) => getComputedStyle(b).color));
    await shot(win, '77-priority-picker');
    await win.locator('.modal-foot').getByRole('button', { name: 'Lưu', exact: true }).click();
    await win.waitForTimeout(500);
    const badge = win.locator('.page-head .badge.prio').first();
    const badgeTxt = await badge.innerText().catch(() => '');
    const c5 = await badge.evaluate((el) => getComputedStyle(el).color).catch(() => '');
    const detailHint = await win.locator('.info-grid', { hasText: 'Priority Point' }).innerText();
    await call(win, 'updateProject', pr.id, { ...(await call(win, 'listProjects')).find((x) => x.id === pr.id), priorityPoint: 1, brandIds: [] });
    await win.reload();
    await win.waitForSelector('.page-head .badge.prio');
    const c1 = await win.locator('.page-head .badge.prio').first().evaluate((el) => getComputedStyle(el).color);
    check(
      'Priority Point: mỗi mức một màu; 5 là cao nhất, 1 thấp nhất',
      /5: Cao nhất — 5 là ưu tiên cao nhất, 1 thấp nhất/.test(hint) && new Set(pickColors).size === 5 && badgeTxt === 'P5' && c5 !== c1 && /5 cao nhất – 1 thấp nhất/.test(detailHint),
      hint + ' · P5 ' + c5 + ' / P1 ' + c1,
    );
  }

  // --- v1.14: Import cùng một file xlsx nhiều lần — lần sau tự chọn sheet chưa import ---
  {
    const target = created[4];
    const twoSheets = path.join(fixtures, 'BOQ 2 sheet.xlsx');
    {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Model', 'Brand', 'Description'], ['P3265-LVE', 'Axis', 'Camera dome'], ['Q6135-LE', 'Axis', 'PTZ']]), 'Camera');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Danh sách switch'], [], ['Model', 'Hãng', 'Mô tả'], ['GS950/28PS', 'Allied Telesis', '24 port PoE']]), 'Switch');
      fs.writeFileSync(twoSheets, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    }
    await go(win, '#/project/' + target.id);
    await win.waitForTimeout(400);
    await stubOpen(app, [twoSheets]);
    await win.getByRole('button', { name: 'Import .xlsx' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    const firstSheet = await win.locator('.sheet-chip.on').innerText();
    await win.waitForTimeout(100);
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.waitForTimeout(700);
    await stubOpen(app, [twoSheets]);
    await win.getByRole('button', { name: 'Thêm bảng mới (import xlsx)' }).click();
    await win.waitForSelector('.wizard', { timeout: 10000 });
    const secondSheet = await win.locator('.sheet-chip.on').innerText();
    const infoTxt = await win.locator('.wizard .alert.info').first().innerText().catch(() => '');
    const doneBadge = await win.locator('.sheet-chip', { hasText: 'Camera' }).locator('.badge').innerText().catch(() => '');
    const preview = await win.locator('.wizard-right').innerText();
    await shot(win, '78-import-second-sheet');
    await win.getByRole('button', { name: 'Xác nhận Import' }).click();
    await win.waitForTimeout(700);
    const imps = await call(win, 'listProjectImports', target.id);
    const tabs = (await win.locator('.xl-tabs [role="tab"]').allInnerTexts()).map((t) => t.trim());
    check(
      'Import cùng một file nhiều lần: lần sau tự chọn sheet chưa import (đánh dấu sheet đã import), tên tab "file - sheet"',
      /Camera/.test(firstSheet) && /Switch/.test(secondSheet) && /đã import sheet "Camera"/.test(infoTxt) && /đã import/.test(doneBadge) && /GS950\/28PS/.test(preview) &&
        imps.map((i) => i.sheetNames[0]).join('|') === 'Camera|Switch' && tabs.join('|') === 'BOQ 2 sheet - Camera|BOQ 2 sheet - Switch' && imps[1].items[0]?.model === 'GS950/28PS',
      tabs.join(' | ') + ' · ' + infoTxt.replace(/\s+/g, ' ').slice(0, 90),
    );
  }

  // --- NFR-001: 1.100 dự án — board/dashboard <= 2s, search <= 300ms ---
  const ys = await call(win, 'listYears');
  const cls = await call(win, 'listMaster', 'clients');
  await win.evaluate(
    async ([yearId, clientId]) => {
      const d = new Date();
      for (let i = 0; i < 1100; i++) {
        const due = new Date(d.getTime() + ((i % 40) - 5) * 86400000);
        const isoDue = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
        await window.ppm.call('createProject', [
          { jobYearId: yearId, workCategory: i % 2 ? 'PRE_SALES' : 'POST_SALES', receivedDate: '2026-01-01', dueDate: isoDue, projectName: `Dự án hiệu năng số ${i} – thiết kế`, clientId, note: 'ghi chú '.repeat(10), filePath: null, fileName: null, fileExtension: null, priorityPoint: (i % 5) + 1 },
        ]);
      }
    },
    [ys[0].id, cls[0].id],
  );
  await win.reload();
  await win.waitForSelector('.sidebar');
  let t0 = Date.now();
  await go(win, '#/all');
  await win.waitForSelector('.board-col .pcard');
  const boardMs = Date.now() - t0;
  check('Board 1.108 dự án tải ≤ 2 giây', boardMs <= 2000, `${boardMs} ms`);
  t0 = Date.now();
  await go(win, '#/');
  await win.waitForSelector('.kpi');
  const dashMs = Date.now() - t0;
  check('Dashboard 1.108 dự án tải ≤ 2 giây', dashMs <= 2000, `${dashMs} ms`);
  await go(win, '#/all');
  await win.waitForSelector('.board-col .pcard');
  const searchMs = await win.evaluate(async () => {
    const input = document.querySelector('.toolbar .search-box input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const t = performance.now();
    setter.call(input, 'du an hieu nang so 1099');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t);
  });
  // "1099" khớp cả tên "số 1099" lẫn dự án có STT 1099 (tìm theo STT là tính năng mới).
  const hitTitles = await win.locator('.pcard-title').allInnerTexts();
  check('Tìm kiếm trên 1.108 dự án ≤ 300ms', searchMs <= 300 && hitTitles.some((t) => t.includes('số 1099')) && hitTitles.length <= 2, `${searchMs} ms, ${hitTitles.length} kết quả`);
} catch (err) {
  check('Không có lỗi ngoại lệ trong kịch bản', false, String(err?.stack ?? err));
  await shot(win, 'zz-error').catch(() => {});
} finally {
  check('Không có lỗi console/pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  await app.close().catch(() => {});
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kiểm tra đạt. Ảnh chụp: ${shots}`);
  process.exit(failed.length ? 1 : 0);
}
