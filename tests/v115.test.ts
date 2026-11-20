import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { createHandlers, type Desktop } from '../src/main/handlers';
import * as events from '../src/main/services/events';
import * as freelance from '../src/main/services/freelance';
import * as master from '../src/main/services/master';
import * as notes from '../src/main/services/notes';
import * as passwords from '../src/main/services/passwords';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import { globalSearch } from '../src/main/services/search';
import { readSettingValue, LAST_IMPORT_DIR } from '../src/main/services/settings';
import { matchExcerpt } from '../src/shared/text';
import type { ProjectInput } from '../src/shared/types';
import { TEST_TODAY, makeCtx, tmpDir } from './helpers';

let ctx: Ctx;
let year: string;
beforeEach(async () => {
  ctx = await makeCtx();
  year = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
});

const input = (over: Partial<ProjectInput> = {}): ProjectInput => ({
  jobYearId: year,
  workCategory: 'PRE_SALES',
  receivedDate: null,
  dueDate: null,
  projectName: 'Dự án',
  clientId: null,
  salespersonId: null,
  note: '',
  priorityPoint: 3,
  ...over,
});

describe('Tìm kiếm theo Ghi chú', () => {
  it('tìm trong ghi chú theo ngày (dự án, Job Freelance, Sự kiện) và Ghi chú Password / Website - App - Địa điểm', () => {
    const p = projects.createProject(ctx, input({ projectName: 'Nhà máy A' }));
    notes.saveProjectNote(ctx, p.id, { noteDate: '2026-11-10', html: '<div>Khách yêu cầu thêm camera hành lang</div>' });
    notes.saveProjectNote(ctx, p.id, { noteDate: TEST_TODAY, html: '<div>Đã gửi báo giá <b>Camera</b> AI đợt 2</div>' });
    const job = freelance.createFreelance(ctx, { projectName: 'Logo', hirerId: null, startDate: null, statusId: null });
    notes.saveFreelanceNote(ctx, job.id, { noteDate: '2026-11-12', html: '<div>Gửi file camera thiết kế</div>' });
    const ev = events.createEvent(ctx, { name: 'Triển lãm', eventDate: null, brandIds: [] }, { noteHtml: '<div>Mang 3 CAMERA demo</div>' });
    passwords.createPassword(ctx, { siteName: 'NVR kho', username: 'admin', password: 'x', url: '', note: 'Đổi mật khẩu camera sau khi bàn giao' });
    records.createPlace(ctx, { category: 'PLACE', name: 'Kho Bắc Ninh', note: 'Có 12 cấm ra vào' });
    records.createPlace(ctx, { category: 'WEBSITE', name: 'Cổng camera', note: 'Tra cứu cấu hình camera' });

    const hits = globalSearch(ctx, { mode: 'note', text: 'cám' });
    const byKind = (k: string) => hits.filter((h) => h.kind === k);
    // "cám" bỏ dấu = "cam": khớp "camera" và "cấm".
    expect(byKind('project')).toHaveLength(1);
    expect(byKind('project')[0]).toMatchObject({ id: p.id, title: `${p.stt}. Nhà máy A`, date: TEST_TODAY });
    expect(byKind('project')[0].matched).toMatch(/^16\/11\/2026: Đã gửi báo giá Camera AI đợt 2$/);
    expect(byKind('freelance')[0]).toMatchObject({ id: job.id, date: '2026-11-12' });
    expect(byKind('event')[0]).toMatchObject({ id: ev.id, title: '1. Triển lãm', subtitle: 'Sự kiện tạm thời' });
    expect(byKind('password')[0]).toMatchObject({ title: 'NVR kho', date: null });
    expect(byKind('place').map((h) => h.title).sort()).toEqual(['Cổng camera', 'Kho Bắc Ninh']);

    // Lọc theo ngày: theo ngày ghi chú; Password / Website - App - Địa điểm không có ngày nên bị ẩn.
    const ranged = globalSearch(ctx, { mode: 'note', text: 'camera', from: '2026-11-01', to: '2026-11-11' });
    expect(ranged.map((h) => [h.kind, h.date])).toEqual([['project', '2026-11-10']]);
    expect(ranged[0].matched).toMatch(/hành lang/);
    expect(globalSearch(ctx, { mode: 'note', text: 'không có chữ này' })).toEqual([]);
  });

  it('đoạn trích quanh chỗ khớp, không phân biệt dấu / hoa thường', () => {
    const long = `${'a '.repeat(80)}Gặp anh Đức ở công trường ${'b '.repeat(80)}`;
    const ex = matchExcerpt(long, 'duc o cong', 20);
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
    expect(ex).toContain('Gặp anh Đức ở công trường');
    expect(matchExcerpt('Dòng 1\n\nDòng   2', 'zzz')).toBe('Dòng 1 Dòng 2');
  });
});

describe('Import xlsx: thư mục mở sẵn khi chọn file', () => {
  function handlers(downloads: string, pick: () => string) {
    const opened: (string | undefined)[] = [];
    const desktop = {
      pickFiles: async (o: { defaultPath?: string }) => {
        opened.push(o.defaultPath);
        return [pick()];
      },
      downloadsDir: () => downloads,
    } as unknown as Desktop;
    return { h: createHandlers(ctx, desktop), opened };
  }

  it('thư mục dự án / sự kiện → thư mục import gần nhất → Downloads; mỗi lần chọn ghi nhớ thư mục của file', async () => {
    const downloads = tmpDir('ppm-dl-');
    const projectDir = tmpDir('ppm-proj-');
    const eventDir = tmpDir('ppm-ev-');
    const otherDir = tmpDir('ppm-other-');
    const withFolder = projects.createProject(ctx, input({ projectName: 'Có thư mục', folderLink: projectDir }));
    const noFolder = projects.createProject(ctx, input({ projectName: 'Chưa có thư mục' }));
    const ev = events.setEventFolder(ctx, events.createEvent(ctx, { name: 'Sự kiện', eventDate: null, brandIds: [] }).id, eventDir);

    let next = path.join(otherDir, 'BOQ.xlsx');
    const { h, opened } = handlers(downloads, () => next);
    expect(readSettingValue(ctx, LAST_IMPORT_DIR)).toBeNull();
    await h.pickWorkbook({ kind: 'project', id: noFolder.id });
    expect(opened.at(-1)).toBe(downloads);
    expect(readSettingValue(ctx, LAST_IMPORT_DIR)).toBe(otherDir);

    await h.pickWorkbook({ kind: 'project', id: noFolder.id });
    expect(opened.at(-1)).toBe(otherDir);
    await h.pickWorkbook({ kind: 'project', id: withFolder.id });
    expect(opened.at(-1)).toBe(projectDir);
    await h.pickWorkbook({ kind: 'event', id: ev.id });
    expect(opened.at(-1)).toBe(eventDir);
    await h.pickWorkbook(null);
    expect(opened.at(-1)).toBe(otherDir);

    // Thư mục gần nhất không còn tồn tại thì quay về Downloads; chọn file không phải .xlsx thì không ghi nhớ.
    fs.rmSync(otherDir, { recursive: true, force: true });
    next = path.join(projectDir, 'ghi-chu.txt');
    await expect(h.pickWorkbook(undefined)).rejects.toThrow(/\.xlsx/);
    expect(opened.at(-1)).toBe(downloads);
    expect(readSettingValue(ctx, LAST_IMPORT_DIR)).toBe(otherDir);
  });
});

describe('Sự kiện tạm thời: nhiều Hãng', () => {
  it('nâng cấp chép Hãng cũ (một Hãng) sang danh sách; chọn nhiều Hãng, bỏ trùng; Hãng đang dùng không xóa được', async () => {
    const f = path.join(tmpDir(), 'ppm.sqlite');
    const { Db } = await import('../src/main/db/database');
    const { MIGRATIONS } = await import('../src/main/db/migrations');
    const old = await Db.open(f, MIGRATIONS.slice(0, 15));
    old.tx(() => {
      old.run("INSERT INTO brands (id, name, sort_order, is_active, created_at, updated_at) VALUES ('b1', 'Axis', 0, 1, 't', 't')");
      old.run("INSERT INTO temp_events (id, stt, name, brand_id, note, created_at, updated_at) VALUES ('e1', 1, 'Demo cũ', 'b1', '', 't', 't')");
      old.run("INSERT INTO temp_events (id, stt, name, note, created_at, updated_at) VALUES ('e2', 2, 'Không Hãng', '', 't', 't')");
    });
    old.close();
    const db = await Db.open(f);
    const c = { ...ctx, db };
    expect(events.listEvents(c).map((e) => [e.id, e.brands])).toEqual([
      ['e1', [{ id: 'b1', name: 'Axis' }]],
      ['e2', []],
    ]);
    expect(db.scalar('SELECT COUNT(*) FROM temp_events WHERE brand_id IS NOT NULL')).toBe(0);

    const hik = master.createMaster(c, 'brands', 'Hikvision');
    const e = events.updateEvent(c, 'e2', { name: 'Không Hãng', eventDate: null, brandIds: [hik.id, 'b1', hik.id] });
    expect(e.brands.map((b) => b.name)).toEqual(['Hikvision', 'Axis']);
    expect(master.listMaster(c, 'brands').find((b) => b.id === 'b1')!.usageCount).toBe(2);
    expect(() => master.deleteMaster(c, 'brands', hik.id, null)).toThrow(/Deactivate/);
    expect(() => events.createEvent(c, { name: 'X', eventDate: null, brandIds: ['khong-co'] })).toThrow(/Hãng không tồn tại/);
    expect(globalSearch(c, { mode: 'note', text: 'zzz' })).toEqual([]);
    notes.saveEventNote(c, 'e2', { noteDate: TEST_TODAY, html: '<div>Gặp đối tác</div>' });
    expect(globalSearch(c, { mode: 'note', text: 'doi tac' })[0].subtitle).toBe('Sự kiện tạm thời · Hikvision, Axis');
  });
});
