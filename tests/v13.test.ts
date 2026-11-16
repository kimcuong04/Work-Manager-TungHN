import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { Db } from '../src/main/db/database';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/main/db/migrations';
import { createHandlers, type Desktop } from '../src/main/handlers';
import { importImageBuffer } from '../src/main/integration/images';
import { writeBackup, inspectBackup } from '../src/main/services/backup';
import * as calendar from '../src/main/services/calendar';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import type { ProjectInput } from '../src/shared/types';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

let ctx: Ctx;
let year: string;
let client: string;

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    jobYearId: year,
    workCategory: 'PRE_SALES',
    receivedDate: '2026-11-10',
    dueDate: '2026-11-30',
    projectName: 'Trung tâm thương mại A',
    clientId: client,
    designUnitId: null,
    stageId: null,
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
  client = master.createMaster(ctx, 'clients', 'CĐT Một').id;
});

const OLD_NOTE = 'Gọi lại cho CĐT <sau> 3 ngày\nDòng 2';

describe('Nâng cấp dữ liệu v1.2 → v1.3', () => {
  it('giữ nguyên dự án cũ, thêm Salesperson rỗng và đưa ngày tiếp nhận lên Calendar', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'ppm.sqlite');
    const old = await Db.open(file, MIGRATIONS.slice(0, 1));
    const y = old.scalar<string>("SELECT id FROM job_years WHERE job_type = 'MAIN'");
    const now = new Date().toISOString();
    old.tx(() => {
      old.run('INSERT INTO clients VALUES (?,?,0,1,?,?)', ['c1', 'CĐT cũ', now, now]);
      old.run(
        `INSERT INTO projects (id, job_year_id, work_category, received_date, due_date, project_name, client_id, priority_point, note, created_at, updated_at)
         VALUES ('p1', ?, 'POST_SALES', '2026-10-05', '2026-12-01', 'Dự án từ bản cũ', 'c1', 2, ?, ?, ?)`,
        [y, OLD_NOTE, now, '2026-11-02T03:00:00.000Z'],
      );
    });
    old.close();

    const db = await Db.open(file);
    const c2 = { ...ctx, db };
    expect(db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    const [p] = projects.listProjects(c2);
    expect(p).toMatchObject({ projectName: 'Dự án từ bản cũ', salespersonId: null, salespersonName: null, priorityPoint: 2 });
    const evs = calendar.listCalendarEvents(c2, { projectId: 'p1' });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: 'PROJECT_START', eventDate: '2026-10-05', title: 'Dự án từ bản cũ', projectExists: true });
    expect(records.listKnowledge(c2)).toEqual([]);
    const [n] = notes.listProjectNotes(c2, 'p1');
    expect(n).toMatchObject({ noteDate: '2026-11-02', text: OLD_NOTE });
    expect(n.html).toBe('<div>Gọi lại cho CĐT &lt;sau&gt; 3 ngày</div><div>Dòng 2</div>');
    expect(p.note).toBe(OLD_NOTE);
    expect(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith(`pre-migrate-v1-to-v${SCHEMA_VERSION}-`))).toBe(true);
  });
});

describe('Salesperson', () => {
  it('gán cho dự án, đếm số lần dùng, xóa có gỡ liên kết', () => {
    const sp = master.createMaster(ctx, 'salespersons', 'Nguyễn Văn Sale');
    expect(() => master.createMaster(ctx, 'salespersons', 'NGUYỄN VĂN SALE')).toThrow(/đã tồn tại/);
    const p = projects.createProject(ctx, input({ salespersonId: sp.id }));
    expect(p.salespersonName).toBe('Nguyễn Văn Sale');
    expect(master.listMaster(ctx, 'salespersons')[0].usageCount).toBe(1);
    expect(() => master.deleteMaster(ctx, 'salespersons', sp.id, null)).toThrow(/đang được 1 dự án/);
    master.deleteMaster(ctx, 'salespersons', sp.id, { unlink: true });
    expect(projects.getProject(ctx, p.id).salespersonId).toBeNull();
  });
  it('từ chối Salesperson không tồn tại; bỏ trống thì vẫn tạo được (gọi từ dữ liệu cũ không có trường này)', () => {
    expect(() => projects.createProject(ctx, input({ salespersonId: 'khong-co' }))).toThrow(/Salesperson không tồn tại/);
    const { salespersonId: _omit, ...legacy } = input();
    expect(projects.createProject(ctx, legacy as ProjectInput).salespersonId).toBeNull();
  });
});

describe('Calendar gắn với dự án', () => {
  it('dự án mới tự có sự kiện "Bắt đầu dự án" ở ngày tiếp nhận', () => {
    const p = projects.createProject(ctx, input());
    const evs = calendar.listCalendarEvents(ctx, { projectId: p.id });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: 'PROJECT_START', eventDate: '2026-11-10', title: p.projectName });
  });

  it('đổi ngày tiếp nhận / tên thì sự kiện bắt đầu đi theo; Lưu thường không thêm mục mới', () => {
    const p = projects.createProject(ctx, input());
    projects.updateProject(ctx, p.id, input({ receivedDate: '2026-11-12', projectName: 'TTTM A – giai đoạn 2' }));
    const evs = calendar.listCalendarEvents(ctx, { projectId: p.id });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ eventDate: '2026-11-12', title: 'TTTM A – giai đoạn 2' });
  });

  it('tiêu đề đã tự sửa trên Calendar thì không bị ghi đè khi đổi tên dự án', () => {
    const p = projects.createProject(ctx, input());
    const [start] = calendar.listCalendarEvents(ctx, { projectId: p.id });
    calendar.updateCalendarEvent(ctx, start.id, { ...start, title: 'Khảo sát lần đầu' });
    projects.updateProject(ctx, p.id, input({ projectName: 'Tên mới' }));
    expect(calendar.listCalendarEvents(ctx, { projectId: p.id })[0].title).toBe('Khảo sát lần đầu');
  });

  it('"Lưu và thêm vào Calendar" ghi một mục cập nhật hôm nay kèm tóm tắt thay đổi', () => {
    const stage = master.listMaster(ctx, 'stages')[2];
    const sp = master.createMaster(ctx, 'salespersons', 'Chị Lan');
    const p = projects.createProject(ctx, input());
    projects.updateProject(ctx, p.id, input({ dueDate: '2026-12-05', stageId: stage.id, salespersonId: sp.id, note: 'Đã gửi báo giá lần 2' }), { addToCalendar: true });
    const upd = calendar.listCalendarEvents(ctx, { projectId: p.id }).find((e) => e.kind === 'PROJECT_UPDATE')!;
    expect(upd.eventDate).toBe(TEST_TODAY);
    expect(upd.note).toContain('Ngày tới hạn: 30/11/2026 → 05/12/2026');
    expect(upd.note).toContain(`Giai đoạn: — → ${stage.name}`);
    expect(upd.note).toContain('Salesperson: — → Chị Lan');
    expect(upd.note).not.toContain('Ghi chú');
  });

  it('không đổi gì mà vẫn bấm "Lưu và thêm vào Calendar" thì ghi nhận tiến độ', () => {
    const p = projects.createProject(ctx, input());
    projects.updateProject(ctx, p.id, input(), { addToCalendar: true });
    const upd = calendar.listCalendarEvents(ctx, { projectId: p.id }).filter((e) => e.kind === 'PROJECT_UPDATE');
    expect(upd).toHaveLength(1);
    expect(upd[0].note).toMatch(/không đổi thông tin/);
  });

  it('dự án chưa có sự kiện bắt đầu (đã bị xóa khỏi lịch) thì "Lưu và thêm" bổ sung lại', () => {
    const p = projects.createProject(ctx, input());
    const [start] = calendar.listCalendarEvents(ctx, { projectId: p.id });
    calendar.deleteCalendarEvent(ctx, start.id);
    projects.updateProject(ctx, p.id, input(), { addToCalendar: true });
    const kinds = calendar.listCalendarEvents(ctx, { projectId: p.id }).map((e) => e.kind).sort();
    expect(kinds).toEqual(['PROJECT_START', 'PROJECT_UPDATE']);
  });

  it('xóa dự án: bỏ sự kiện bắt đầu, giữ lịch sử cập nhật với tên dự án', () => {
    const p = projects.createProject(ctx, input());
    projects.updateProject(ctx, p.id, input({ priorityPoint: 1 }), { addToCalendar: true });
    projects.deleteProject(ctx, p.id);
    const left = calendar.listCalendarEvents(ctx);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: 'PROJECT_UPDATE', projectId: null, projectExists: false, projectName: 'Trung tâm thương mại A' });
    expect(left[0].note).toContain('Priority: 3 → 1');
  });
});

describe('Sự kiện Calendar tự tạo', () => {
  const ev = { eventDate: '2026-11-20', startTime: '09:00', endTime: '10:30', title: 'Họp khảo sát', note: '', color: 'teal' as const, projectId: null };

  it('validate giờ, màu, dự án liên kết', () => {
    expect(() => calendar.createCalendarEvent(ctx, { ...ev, endTime: '08:00' })).toThrow(/sau giờ bắt đầu/);
    expect(() => calendar.createCalendarEvent(ctx, { ...ev, startTime: '25:00' })).toThrow(/Giờ không hợp lệ/);
    expect(() => calendar.createCalendarEvent(ctx, { ...ev, title: '  ' })).toThrow(/tiêu đề/);
    expect(() => calendar.createCalendarEvent(ctx, { ...ev, color: 'pink' as never })).toThrow(/Màu/);
    expect(() => calendar.createCalendarEvent(ctx, { ...ev, projectId: 'x' })).toThrow(/không tồn tại/);
  });

  it('tạo, lọc theo khoảng ngày, kéo sang ngày khác, xóa', () => {
    const e = calendar.createCalendarEvent(ctx, ev);
    expect(e).toMatchObject({ kind: 'CUSTOM', color: 'teal', startTime: '09:00', endTime: '10:30' });
    calendar.createCalendarEvent(ctx, { ...ev, eventDate: '2026-12-02', startTime: null, endTime: null });
    expect(calendar.listCalendarEvents(ctx, { from: '2026-11-01', to: '2026-11-30' }).map((x) => x.id)).toEqual([e.id]);
    const moved = calendar.moveCalendarEvent(ctx, e.id, '2026-11-25');
    expect(moved).toMatchObject({ eventDate: '2026-11-25', startTime: '09:00', title: 'Họp khảo sát' });
    calendar.deleteCalendarEvent(ctx, e.id);
    expect(() => calendar.deleteCalendarEvent(ctx, e.id)).toThrow(/Không tìm thấy/);
  });

  it('bỏ giờ bắt đầu thì không lưu giờ kết thúc mồ côi; sắp xếp cả ngày trước giờ', () => {
    const allDay = calendar.createCalendarEvent(ctx, { ...ev, startTime: null, endTime: null, title: 'Cả ngày' });
    calendar.createCalendarEvent(ctx, { ...ev, startTime: '07:00', endTime: null, title: 'Sớm' });
    const list = calendar.listCalendarEvents(ctx, { from: '2026-11-20', to: '2026-11-20' });
    expect(list.map((x) => x.title)).toEqual(['Cả ngày', 'Sớm']);
    expect(allDay.endTime).toBeNull();
  });
});

describe('Kiến thức', () => {
  it('Kiến thức chung và theo Hãng; đổi Hãng; Hãng đang dùng chỉ Deactivate', () => {
    const brand = master.createMaster(ctx, 'brands', 'Hikvision');
    const k1 = records.createKnowledge(ctx, { brandId: null, knowledgeDate: '2026-11-01', title: 'Chuẩn PoE 802.3at', deviceModel: '', content: 'Tối đa 25.5W', webUrl: '', images: [] });
    const k2 = records.createKnowledge(ctx, { brandId: brand.id, knowledgeDate: '2026-11-02', title: 'Reset mật khẩu NVR', deviceModel: 'DS-7608', content: 'Dùng SADP', webUrl: 'https://hikvision.com', images: [] });
    expect(records.listKnowledge(ctx).map((k) => k.id)).toEqual([k2.id, k1.id]);
    expect(records.listKnowledge(ctx, null).map((k) => k.id)).toEqual([k1.id]);
    expect(records.listKnowledge(ctx, brand.id)[0]).toMatchObject({ brandName: 'Hikvision', deviceModel: 'DS-7608' });
    expect(master.listMaster(ctx, 'brands')[0].usageCount).toBe(1);
    expect(() => master.deleteMaster(ctx, 'brands', brand.id, null)).toThrow(/Deactivate/);
    records.updateKnowledge(ctx, k2.id, { ...k2, brandId: null });
    expect(records.listKnowledge(ctx, null)).toHaveLength(2);
    records.deleteKnowledge(ctx, k1.id);
    expect(records.listKnowledge(ctx)).toHaveLength(1);
  });

  it('validate: bắt buộc tiêu đề, chặn link javascript:', () => {
    const base = { brandId: null, knowledgeDate: '2026-11-01', title: 'A', deviceModel: '', content: '', webUrl: '', images: [] };
    expect(() => records.createKnowledge(ctx, { ...base, title: ' ' })).toThrow(/Tiêu đề/);
    expect(() => records.createKnowledge(ctx, { ...base, webUrl: 'javascript:alert(1)' })).toThrow(/http/);
  });

  it('ảnh dán vào Kiến thức được giữ lại khi dọn ảnh mồ côi', async () => {
    const img = importImageBuffer(ctx, PNG, 'Ảnh dán.png');
    expect(img).toMatchObject({ mimeType: 'image/png', fileName: 'Ảnh dán.png' });
    records.createKnowledge(ctx, { brandId: null, knowledgeDate: '2026-11-01', title: 'Sơ đồ', deviceModel: '', content: '', webUrl: '', images: [img] });
    expect(records.referencedImageKeys(ctx).has(img.storageKey)).toBe(true);
    expect(records.listKnowledge(ctx)[0].images[0].storageKey).toBe(img.storageKey);
  });
});

describe('Dán ảnh từ clipboard', () => {
  function handlersWith(clip: Awaited<ReturnType<Desktop['readClipboardImage']>>) {
    const desktop = {
      readClipboardImage: async () => clip,
      writeClipboardImage: async () => true,
    } as unknown as Desktop;
    return createHandlers(ctx, desktop);
  }

  it('ảnh chụp màn hình (PNG) → lưu vào kho ảnh', async () => {
    const [img] = await handlersWith({ png: new Uint8Array(PNG) }).pasteImages();
    expect(img.storageKey).toMatch(/\.png$/);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(true);
  });

  it('file ảnh copy từ Explorer → copy file vào kho; file không phải ảnh bị bỏ qua', async () => {
    const dir = tmpDir();
    const pic = path.join(dir, 'so-do.png');
    fs.writeFileSync(pic, PNG);
    fs.writeFileSync(path.join(dir, 'ghi-chu.txt'), 'x');
    const imgs = await handlersWith({ files: [pic, path.join(dir, 'ghi-chu.txt')] }).pasteImages();
    expect(imgs.map((i) => i.fileName)).toEqual(['so-do.png']);
  });

  it('clipboard không có ảnh → báo lỗi dễ hiểu', async () => {
    await expect(handlersWith(null).pasteImages()).rejects.toThrow(/Clipboard không có ảnh/);
  });

  it('chặn dữ liệu không phải PNG', () => {
    expect(() => importImageBuffer(ctx, new Uint8Array([1, 2, 3, 4]), 'x.png')).toThrow(/không phải ảnh PNG/);
  });
});

describe('Khôi phục backup tạo từ bản v1.2', () => {
  it('database schema cũ được nâng cấp khi restore, dự án lên Calendar', async () => {
    const oldDir = tmpDir();
    const oldDb = await Db.open(path.join(oldDir, 'ppm.sqlite'), MIGRATIONS.slice(0, 1));
    const y = oldDb.scalar<string>("SELECT id FROM job_years WHERE job_type = 'MAIN'");
    const now = new Date().toISOString();
    oldDb.tx(() => {
      oldDb.run('INSERT INTO clients VALUES (?,?,0,1,?,?)', ['c1', 'CĐT cũ', now, now]);
      oldDb.run(
        `INSERT INTO projects (id, job_year_id, work_category, received_date, due_date, project_name, client_id, priority_point, created_at, updated_at)
         VALUES ('p-old', ?, 'PRE_SALES', '2026-09-01', '2026-09-30', 'Dự án trong backup cũ', 'c1', 3, ?, ?)`,
        [y, now, now],
      );
    });
    const { default: AdmZip } = await import('adm-zip');
    const z = new AdmZip();
    const manifest = { app: 'personal-project-manager', formatVersion: 1, schemaVersion: 1, appVersion: '1.2.1', createdAt: now, counts: { projects: 1 } };
    z.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    z.addFile('ppm.sqlite', Buffer.from(oldDb.exportBytes()));
    const zip = path.join(tmpDir(), 'old.zip');
    z.writeZip(zip);

    const { restoreBackup } = await import('../src/main/services/backup');
    await restoreBackup(ctx, zip);
    expect(ctx.db.scalar<number>('PRAGMA user_version')).toBe(SCHEMA_VERSION);
    expect(projects.listProjects(ctx).map((p) => p.projectName)).toEqual(['Dự án trong backup cũ']);
    expect(calendar.listCalendarEvents(ctx, { projectId: 'p-old' })[0]).toMatchObject({ kind: 'PROJECT_START', eventDate: '2026-09-01' });
  });
});

describe('Backup gồm dữ liệu mới', () => {
  it('manifest đếm Kiến thức và sự kiện Calendar', () => {
    projects.createProject(ctx, input());
    records.createKnowledge(ctx, { brandId: null, knowledgeDate: '2026-11-01', title: 'A', deviceModel: '', content: '', webUrl: '', images: [] });
    const file = writeBackup(ctx, path.join(tmpDir(), 'b.zip'));
    expect(inspectBackup(file).counts).toMatchObject({ projects: 1, knowledge: 1, calendar: 1 });
  });
});
