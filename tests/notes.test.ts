import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { importImageBuffer } from '../src/main/integration/images';
import * as calendar from '../src/main/services/calendar';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as projects from '../src/main/services/projects';
import { cleanupOrphanImages } from '../src/main/integration/images';
import { referencedImageKeys } from '../src/main/services/records';
import { isNoteEmpty, noteHtmlToText, noteImageKeys, sanitizeNoteHtml } from '../src/shared/noteHtml';
import type { ProjectInput } from '../src/shared/types';
import { TEST_TODAY, makeCtx } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const KEY = '0f8fad5b-d9cb-469f-a165-70867728950e.png';

describe('Lọc HTML ghi chú', () => {
  it('giữ định dạng cơ bản, bỏ script/sự kiện/link nguy hiểm', () => {
    const dirty =
      '<p style="color: red; position: fixed" onclick="x()">Chữ <b>đậm</b> <i>nghiêng</i></p><script>alert(1)</script>' +
      '<a href="javascript:alert(1)">xấu</a> <a href="https://vd.com/a?b=1&amp;c=2">tốt</a><iframe src="x"></iframe><style>p{}</style>';
    expect(sanitizeNoteHtml(dirty)).toBe(
      '<p style="color: red">Chữ <b>đậm</b> <i>nghiêng</i></p><a>xấu</a> <a href="https://vd.com/a?b=1&amp;c=2">tốt</a>',
    );
  });

  it('chỉ giữ ảnh trong kho ảnh của app', () => {
    const html = `<img src="https://evil/x.png"><img src="ppm-img://full/${encodeURIComponent(KEY)}" onerror="x"><img src="data:image/png;base64,AAAA"><img src=x onerror=alert(1)>`;
    expect(sanitizeNoteHtml(html)).toBe(`<img src="ppm-img://full/${KEY}" data-key="${KEY}" alt="">`);
    expect(noteImageKeys(sanitizeNoteHtml(html))).toEqual([KEY]);
  });

  it('dán từ Word/Excel: bỏ thẻ lạ, giữ bảng; đóng thẻ còn thiếu', () => {
    const word = '<!--[if gte mso 9]><xml><o:Office/></xml><![endif]--><p class=MsoNormal><o:p>Báo giá</o:p></p><table><tr><td colspan="2">A</td></tr></table><ul><li>một<li>hai';
    expect(sanitizeNoteHtml(word)).toBe('<p>Báo giá</p><table><tr><td colspan="2">A</td></tr></table><ul><li>một<li>hai</li></li></ul>');
  });

  it('chữ thuần cho tìm kiếm; ghi chú chỉ có khoảng trắng là rỗng', () => {
    expect(noteHtmlToText('<div>Dòng 1</div><div>A &amp; B&nbsp;C</div><ul><li>x</li></ul><img data-key="k">')).toBe('Dòng 1\nA & B C\n\n• x\n[ảnh]');
    expect(isNoteEmpty('<div><br></div><p>&nbsp;</p>')).toBe(true);
    expect(isNoteEmpty(`<img src="ppm-img://full/${KEY}">`)).toBe(false);
  });
});

let ctx: Ctx;
let year: string;
let client: string;

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    jobYearId: year,
    workCategory: 'POST_SALES',
    receivedDate: '2026-11-01',
    dueDate: '2026-11-30',
    projectName: 'Tòa nhà B',
    clientId: client,
    salespersonId: null,
    note: '',
    filePath: null,
    fileName: null,
    fileExtension: null,
    priorityPoint: 3,
    ...over,
  };
}

beforeEach(async () => {
  ctx = await makeCtx();
  year = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
  client = master.createMaster(ctx, 'clients', 'CĐT B').id;
});

describe('Dự án mới có ngày tới hạn trong quá khứ', () => {
  it('lưu thẳng ở trạng thái Đã hoàn thành', () => {
    const p = projects.createProject(ctx, input({ receivedDate: '2026-10-01', dueDate: '2026-11-15' }));
    expect(p.isCompleted).toBe(true);
    expect(p.completedAt).toBeTruthy();
  });
  it('hạn hôm nay hoặc tương lai vẫn đang hoạt động', () => {
    expect(projects.createProject(ctx, input({ dueDate: TEST_TODAY })).isCompleted).toBe(false);
    expect(projects.createProject(ctx, input({ dueDate: '2026-11-17' })).isCompleted).toBe(false);
  });
  it('sửa dự án đang hoạt động sang hạn đã qua thì vẫn hoạt động (Khẩn cấp/quá hạn), không tự hoàn thành', () => {
    const p = projects.createProject(ctx, input());
    expect(projects.updateProject(ctx, p.id, input({ dueDate: '2026-11-10' })).isCompleted).toBe(false);
  });
});

describe('Ghi chú dự án theo ngày', () => {
  it('ghi chú ban đầu khi tạo dự án thành mục của hôm nay; client cũ gửi note dạng chữ vẫn được', () => {
    const a = projects.createProject(ctx, input(), { noteHtml: '<div>Khảo sát <b>tầng 3</b></div>' });
    expect(notes.listProjectNotes(ctx, a.id)).toMatchObject([{ noteDate: TEST_TODAY, text: 'Khảo sát tầng 3' }]);
    expect(projects.getProject(ctx, a.id).note).toBe('16/11/2026: Khảo sát tầng 3');
    const b = projects.createProject(ctx, input({ note: 'Dòng 1\nDòng 2' }));
    expect(notes.listProjectNotes(ctx, b.id)[0].html).toBe('<div>Dòng 1</div><div>Dòng 2</div>');
  });

  it('mỗi ngày một mục: lưu lại cùng ngày thì sửa mục đó; sửa được mục ngày cũ; mới nhất lên trước', () => {
    const p = projects.createProject(ctx, input());
    notes.saveProjectNote(ctx, p.id, { noteDate: '2026-11-10', html: '<div>Gửi báo giá</div>' });
    notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: '<div>Chờ phản hồi</div>' });
    notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: '<div>Đã chốt</div>' });
    notes.saveProjectNote(ctx, p.id, { noteDate: '2026-11-10', html: '<div>Gửi báo giá (bản sửa)</div>' });
    const list = notes.listProjectNotes(ctx, p.id);
    expect(list.map((n) => [n.noteDate, n.text])).toEqual([
      [TEST_TODAY, 'Đã chốt'],
      ['2026-11-10', 'Gửi báo giá (bản sửa)'],
    ]);
    expect(projects.getProject(ctx, p.id).note).toBe('16/11/2026: Đã chốt\n\n10/11/2026: Gửi báo giá (bản sửa)');
  });

  it('lưu rỗng thì xóa mục của ngày đó; không cho ghi ngày tương lai', () => {
    const p = projects.createProject(ctx, input());
    notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: '<div>Tạm</div>' });
    expect(notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: '<div><br></div>' })).toBeNull();
    expect(notes.listProjectNotes(ctx, p.id)).toHaveLength(0);
    expect(() => notes.saveProjectNote(ctx, p.id, { noteDate: '2026-11-17', html: 'x' })).toThrow(/tương lai/);
  });

  it('ảnh dán vào ghi chú được bảo vệ khi dọn ảnh, gỡ khỏi ghi chú thì xóa file (nếu không nơi nào khác dùng)', () => {
    const p = projects.createProject(ctx, input());
    const a = importImageBuffer(ctx, PNG, 'a.png');
    const b = importImageBuffer(ctx, PNG, 'b.png');
    const img = (k: string) => `<img src="ppm-img://full/${k}">`;
    notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: `<div>Sơ đồ</div>${img(a.storageKey)}${img(b.storageKey)}` });
    notes.saveProjectNote(ctx, p.id, { noteDate: '2026-11-12', html: img(b.storageKey) });
    expect(cleanupOrphanImages(ctx, referencedImageKeys(ctx))).toBe(0);
    notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: '<div>Sơ đồ</div>' });
    const file = (k: string) => fs.existsSync(path.join(ctx.paths.imagesDir, k));
    expect(file(a.storageKey)).toBe(false);
    expect(file(b.storageKey)).toBe(true);
    projects.deleteProject(ctx, p.id);
    expect(file(b.storageKey)).toBe(false);
  });

  it('ảnh không còn trong kho thì báo lỗi, không lưu', () => {
    const p = projects.createProject(ctx, input());
    expect(() => notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: `<img src="ppm-img://full/${KEY}">` })).toThrow(/không còn trong kho ảnh/);
  });

  it('Lưu và thêm vào Calendar: kèm tóm tắt ghi chú', () => {
    const p = projects.createProject(ctx, input());
    notes.saveProjectNote(ctx, p.id, { noteDate: '2026-11-12', html: '<div>Họp với CĐT, thống nhất phương án 2</div>' }, { addToCalendar: true });
    projects.updateProject(ctx, p.id, input({ priorityPoint: 1 }), { addToCalendar: true, noteHtml: '<div>Chốt hợp đồng</div>' });
    const upd = calendar.listCalendarEvents(ctx, { projectId: p.id }).filter((e) => e.kind === 'PROJECT_UPDATE');
    expect(upd.map((e) => e.note)).toEqual([
      'Ghi chú ngày 12/11/2026: Họp với CĐT, thống nhất phương án 2',
      'Priority: 3 → 1\nGhi chú hôm nay: Chốt hợp đồng',
    ]);
  });

  it('sửa dự án không truyền ghi chú thì giữ nguyên các ngày; note gửi kèm input bị bỏ qua', () => {
    const p = projects.createProject(ctx, input(), { noteHtml: '<div>Giữ nguyên</div>' });
    const updated = projects.updateProject(ctx, p.id, { ...input({ priorityPoint: 2 }), note: 'ghi đè?' });
    expect(updated.note).toBe('16/11/2026: Giữ nguyên');
    expect(notes.listProjectNotes(ctx, p.id)).toHaveLength(1);
  });

  it('xóa một mục ghi chú', () => {
    const p = projects.createProject(ctx, input(), { noteHtml: 'A' });
    const [n] = notes.listProjectNotes(ctx, p.id);
    notes.deleteProjectNote(ctx, n.id);
    expect(notes.listProjectNotes(ctx, p.id)).toHaveLength(0);
    expect(projects.getProject(ctx, p.id).note).toBe('');
  });
});
