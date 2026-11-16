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
  const comboClient = win.locator('.form-section').nth(1).locator('input[role="combobox"]').first();
  await comboClient.click();
  await comboClient.fill('Công ty Hòa Bình');
  await win.getByRole('button', { name: /Thêm mới “Công ty Hòa Bình”/ }).click();
  await win.waitForTimeout(300);
  const dueInput = win.locator('.form-section').nth(2).locator('input.input').nth(1);
  await dueInput.fill(day(1).split('-').reverse().join('/'));
  await dueInput.press('Tab');
  await stubOpen(app, [dwg]);
  await win.getByRole('button', { name: /Chọn file \.dwg/ }).click();
  await win.waitForTimeout(300);
  await shot(win, '02-project-form');
  await win.getByRole('button', { name: 'Tạo dự án' }).click();
  await win.waitForTimeout(500);
  check('Tạo dự án qua form', (await toastText(win)).includes('Đã tạo dự án'), await toastText(win));

  // --- Seed thêm dữ liệu qua IPC ---
  const years = await call(win, 'listYears');
  const main = years.find((y) => y.jobType === 'MAIN');
  const free = years.find((y) => y.jobType === 'FREELANCE');
  const cl2 = await call(win, 'createMaster', 'clients', 'Tập đoàn Vingroup');
  const cl3 = await call(win, 'createMaster', 'clients', 'Sở Xây dựng HN');
  const du1 = await call(win, 'createMaster', 'designUnits', 'Thiết kế Kiến Việt');
  const du2 = await call(win, 'createMaster', 'designUnits', 'Tư vấn ACC');
  const stages = await call(win, 'listMaster', 'stages');
  const base = { jobYearId: main.id, workCategory: 'PRE_SALES', receivedDate: day(-10), note: '', filePath: null, fileName: null, fileExtension: null };
  const specs = [
    ['Trường THCS Ngô Quyền – camera', cl2, du1, -2, 1, 'PRE_SALES'],
    ['Bệnh viện Đa khoa tỉnh – hệ thống mạng', cl3, du2, 0, 2, 'POST_SALES'],
    ['Khu đô thị Ocean Park – thiết kế cơ sở', cl2, du1, 3, 1, 'PRE_SALES'],
    ['Văn phòng ABC – nâng cấp wifi', cl3, null, 5, 4, 'POST_SALES'],
    ['Nhà xưởng KCN Bắc Ninh', cl2, du2, 9, 3, 'PRE_SALES'],
    ['Showroom Ô tô Thành Công', cl3, du1, 20, 5, 'POST_SALES'],
  ];
  const created = [];
  for (const [name, c, d, due, prio, cat] of specs)
    created.push(
      await call(win, 'createProject', { ...base, projectName: name, clientId: c.id, designUnitId: d?.id ?? null, stageId: stages[1].id, dueDate: day(due), priorityPoint: prio, workCategory: cat }),
    );
  const fl = await call(win, 'createProject', { ...base, jobYearId: free.id, projectName: 'Freelance – bản vẽ shopdrawing', clientId: cl2.id, designUnitId: null, stageId: null, dueDate: day(12), priorityPoint: 2 });
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
  await win.getByPlaceholder(/Tìm tên dự án/).fill('thiet ke ky thuat');
  await win.waitForTimeout(300);
  const found = await win.locator('.pcard-title').allInnerTexts();
  check("Tìm không dấu 'thiet ke ky thuat' ra 'Thiết kế kỹ thuật'", found.length === 1 && found[0].includes('Thiết kế kỹ thuật'), found.join(' | '));
  await win.getByPlaceholder(/Tìm tên dự án/).fill('thiet ke');
  await win.waitForTimeout(300);
  const foundStage = await win.locator('.pcard').count();
  check("Tìm 'thiet ke' khớp cả Giai đoạn 'Thiết kế cơ sở'", foundStage === 7, `${foundStage} thẻ`);
  await win.getByPlaceholder(/Tìm tên dự án/).fill('');
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
  const firstDue = await win.locator('.project-table tbody tr').first().locator('td').nth(7).innerText();
  check('Bấm tiêu đề cột để sắp xếp', firstDue.includes('/'), firstDue.split('\n')[0]);
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
  const salesCombo = win.locator('.form-section').nth(1).locator('input[role="combobox"]').nth(1);
  await salesCombo.click();
  await salesCombo.fill('Anh Tuấn Sale');
  await win.getByRole('button', { name: /Thêm Salesperson “Anh Tuấn Sale”/ }).click();
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
  check('Chi tiết dự án: Salesperson + lịch sử Calendar có mục Cập nhật', (await win.getByText('Anh Tuấn Sale').first().isVisible()) && timelineUpd === 1 && timelineNote.includes('Salesperson'), timelineNote.replace(/\n/g, ' / '));
  await shot(win, '07d-detail-calendar-card');

  // --- Ghi chú theo ngày: định dạng tự do + dán ảnh Ctrl+V ---
  await win.getByRole('button', { name: 'Ghi chú hôm nay', exact: true }).click();
  await win.locator('.note-editing .note-editor').click();
  await win.keyboard.type('Khảo sát hiện trường: ');
  await win.keyboard.press('Control+B');
  await win.keyboard.type('cần thêm 2 camera');
  await win.keyboard.press('Control+B');
  await win.keyboard.press('Enter');
  await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }, file) => {
    const data = nativeImage.createFromPath(file).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(data)], { type: 'image/png' }) })]);
  }, png);
  await win.keyboard.press('Control+V');
  await win.waitForSelector('.note-editing .note-editor img', { timeout: 5000 }).catch(() => {});
  await shot(win, '07e-note-editing');
  await win.locator('.note-editing').getByRole('button', { name: 'Lưu', exact: true }).click();
  await win.waitForTimeout(600);
  const boldCount = await win.locator('.note-entry .note-content b').count();
  const noteImgs = await win.locator('.note-entry .note-content img').count();
  check('Ghi chú hôm nay: chữ đậm + ảnh dán Ctrl+V được lưu', boldCount >= 1 && noteImgs === 1, `${boldCount} đoạn đậm, ${noteImgs} ảnh`);
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
  await win.getByRole('button', { name: 'Dữ liệu sheet' }).click();
  await win.waitForTimeout(200);
  await shot(win, '06b-import-sheet-grid');
  await win.getByRole('button', { name: 'Xác nhận Import' }).click();
  await win.waitForTimeout(600);
  check('Import XLSX thành công', (await win.locator('.req-round').count()) === 2 && (await win.getByText('COLDSTORE 2U').isVisible()));
  await shot(win, '07-project-detail-imported');

  // --- Mở file DWG: không có ứng dụng .dwg thì báo lỗi có hướng xử lý (AC-010) ---
  await go(win, `#/project/${(await call(win, 'listProjects')).find((p) => p.filePath).id}`);
  await win.waitForTimeout(500);
  await shot(win, '08-project-detail-file');

  // --- Warranty ---
  const brand = await call(win, 'createMaster', 'brands', 'Axis');
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
  await app.evaluate(async ({ clipboard, nativeImage, ClipboardItem }, file) => {
    const png = nativeImage.createFromPath(file).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
  }, png);
  await win.locator('.modal').last().locator('.form-section h3', { hasText: 'Ảnh' }).click();
  await win.keyboard.press('Control+V');
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

  // --- v1.3: Dashboard › Dự án trong tháng ---
  await go(win, '#/');
  await win.waitForTimeout(400);
  const monthRows = await win.locator('.card', { hasText: 'Dự án trong tháng' }).locator('tbody tr').count();
  check('Dashboard có panel "Dự án trong tháng" dưới Dự án khẩn cấp', monthRows > 0, `${monthRows} dự án`);
  await shot(win, '03b-dashboard-month');

  // --- v1.3: Calendar ---
  await go(win, '#/calendar');
  await win.waitForSelector('.cal-month');
  await win.waitForTimeout(300);
  const startChips = await win.locator('.ev-chip', { hasText: 'Nhà máy Đông Á' }).count();
  check('Calendar: dự án mới tự có ở ngày tiếp nhận', startChips >= 1, `${startChips} chip`);
  check('Calendar: hiển thị mục "Cập nhật dự án" hôm nay', (await win.locator('.cal-cell.today .ev-chip', { hasText: 'Trường THCS' }).count()) === 1);
  await shot(win, '19-calendar-month');
  await win.locator('.ev-chip', { hasText: 'Nhà máy Đông Á' }).first().click();
  await win.waitForSelector('.cal-pop');
  check('Bấm sự kiện mở thẻ chi tiết', await win.locator('.cal-pop').getByRole('button', { name: 'Mở dự án' }).isVisible());
  await shot(win, '19b-calendar-popover');
  await win.keyboard.press('Escape');
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
  await win.waitForSelector('.modal');
  check('Tự mở hộp thoại "Có phiên bản mới" kèm ghi chú', await win.getByText('Thêm cột Ghi chú vào board').isVisible());
  await shot(win, '17-update-dialog');
  await win.getByRole('button', { name: 'Để sau' }).click();
  check('Sau "Để sau" vẫn còn nút Cập nhật trên topbar', await win.getByRole('button', { name: /Cập nhật 1\.2\.1/ }).isVisible());
  await shot(win, '18-update-topbar');

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

  await app.close();

  // --- Mở lại: dữ liệu + settings còn (AC-001, AC-011, TC-014) ---
  ({ app, win } = await launch());
  const theme = await win.evaluate(() => document.documentElement.dataset.theme);
  const n = (await call(win, 'listProjects')).length;
  check('Mở lại app: dữ liệu và theme được giữ', theme === 'dark' && n === 8, `theme=${theme}, projects=${n}`);

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
          { jobYearId: yearId, workCategory: i % 2 ? 'PRE_SALES' : 'POST_SALES', receivedDate: '2026-01-01', dueDate: isoDue, projectName: `Dự án hiệu năng số ${i} – thiết kế`, clientId, designUnitId: null, stageId: null, note: 'ghi chú '.repeat(10), filePath: null, fileName: null, fileExtension: null, priorityPoint: (i % 5) + 1 },
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
  const hits = await win.locator('.pcard').count();
  check('Tìm kiếm trên 1.108 dự án ≤ 300ms', searchMs <= 300 && hits === 1, `${searchMs} ms, ${hits} kết quả`);
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
