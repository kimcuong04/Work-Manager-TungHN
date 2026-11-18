import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../src/main/context';
import { importImages } from '../src/main/integration/images';
import { inspectBackup, restoreBackup, writeBackup } from '../src/main/services/backup';
import * as calendar from '../src/main/services/calendar';
import * as master from '../src/main/services/master';
import * as projects from '../src/main/services/projects';
import * as records from '../src/main/services/records';
import { getSettings, updateSettings } from '../src/main/services/settings';
import type { MasterKind, ProjectInput } from '../src/shared/types';
import { Db } from '../src/main/db/database';
import { makeCtx, tmpDir } from './helpers';

let ctx: Ctx;
let mainYear: string;
let clientId: string;

function input(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    jobYearId: mainYear,
    workCategory: 'PRE_SALES',
    receivedDate: '2026-11-16',
    dueDate: '2026-11-20',
    projectName: 'Dự án ABC',
    clientId,
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
  mainYear = master.listYears(ctx).find((y) => y.jobType === 'MAIN')!.id;
  clientId = master.createMaster(ctx, 'clients', 'CĐT Một').id;
});

describe('Khởi tạo & persistence', () => {
  it('seed: Job Chính có năm hiện tại (Job Freelance là bảng riêng, không chia năm), settings mặc định 2/5', () => {
    const years = master.listYears(ctx);
    expect(years.filter((y) => y.jobType === 'MAIN')).toHaveLength(1);
    expect(years.filter((y) => y.jobType === 'FREELANCE')).toHaveLength(0);
    expect(getSettings(ctx)).toMatchObject({ urgentThresholdDays: 2, attentionThresholdDays: 5, theme: 'light' });
  });
  it('TC-014/AC-001/AC-011: dữ liệu và settings còn sau khi đóng/mở lại', async () => {
    projects.createProject(ctx, input());
    updateSettings(ctx, { theme: 'dark', urgentThresholdDays: 3 });
    ctx.db.close();
    const reopened = await Db.open(ctx.paths.dbFile);
    const c2 = { ...ctx, db: reopened };
    expect(projects.listProjects(c2)).toHaveLength(1);
    expect(getSettings(c2)).toMatchObject({ theme: 'dark', urgentThresholdDays: 3 });
  });
  it('validate ngưỡng khi lưu settings', () => {
    expect(() => updateSettings(ctx, { urgentThresholdDays: 6 })).toThrow();
  });
});

describe('Danh mục (FR-FORM-003, FR-SET-004..006, TC-012)', () => {
  it('chặn trùng không phân biệt hoa/thường và khoảng trắng', () => {
    expect(() => master.createMaster(ctx, 'clients', '  cđt   một ')).toThrow(/đã tồn tại/);
  });
  it('TC-012: không xóa EU đang dùng khi chưa chọn cách xử lý; gán lại hoặc gỡ liên kết (EU không bắt buộc)', () => {
    const p = projects.createProject(ctx, input());
    const other = master.createMaster(ctx, 'clients', 'CĐT Hai');
    expect(() => master.deleteMaster(ctx, 'clients', clientId, null)).toThrow(/đang được 1 mục/);
    master.deleteMaster(ctx, 'clients', clientId, { replaceWithId: other.id });
    expect(projects.getProject(ctx, p.id).clientName).toBe('CĐT Hai');
    master.deleteMaster(ctx, 'clients', other.id, { unlink: true });
    expect(projects.getProject(ctx, p.id).clientId).toBeNull();
  });
  it('Đơn vị thiết kế / Giai đoạn đã bỏ: không còn là danh mục, sửa dự án không xóa giá trị cũ trong DB', () => {
    const p = projects.createProject(ctx, input());
    const stage = ctx.db.scalar<string>('SELECT id FROM project_stages ORDER BY sort_order LIMIT 1');
    ctx.db.run('INSERT INTO design_units (id, name, sort_order, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['du-old', 'TK cũ', 0, 1, 'x', 'x']);
    ctx.db.run('UPDATE projects SET design_unit_id = ?, stage_id = ? WHERE id = ?', ['du-old', stage, p.id]);
    expect(() => master.listMaster(ctx, 'stages' as MasterKind)).toThrow(/không hợp lệ/);
    expect(() => master.createMaster(ctx, 'designUnits' as MasterKind, 'TK X')).toThrow(/không hợp lệ/);
    const saved = projects.updateProject(ctx, p.id, input({ projectName: 'Dự án đổi tên' }), { addToCalendar: true });
    expect(saved).not.toHaveProperty('stageName');
    expect(ctx.db.get('SELECT design_unit_id, stage_id FROM projects WHERE id = ?', [p.id])).toEqual({ design_unit_id: 'du-old', stage_id: stage });
    const upd = calendar.listCalendarEvents(ctx, { projectId: p.id }).find((e) => e.kind === 'PROJECT_UPDATE')!;
    expect(upd.note).not.toMatch(/Giai đoạn|Đơn vị thiết kế/);
  });
  it('TC-WAR-007/FR-BRAND-004: Hãng đang dùng không xóa cứng, chỉ deactivate', () => {
    const b = master.createMaster(ctx, 'brands', 'Axis');
    records.createExperience(ctx, { brandId: b.id, experienceDate: '2026-11-16', projectId: null, projectText: 'X', deviceModel: '', event: 'E', webUrl: '', images: [] });
    expect(() => master.deleteMaster(ctx, 'brands', b.id, null)).toThrow(/Deactivate/);
    master.setMasterActive(ctx, 'brands', b.id, false);
    expect(master.listMaster(ctx, 'brands')[0].isActive).toBe(false);
    master.renameMaster(ctx, 'brands', b.id, 'AXIS Communications');
    expect(records.listExperience(ctx, b.id)[0].brandName).toBe('AXIS Communications');
  });
});

describe('Năm (FR-YEAR-001..005, TC-NAV-003, TC-YEAR-006/007)', () => {
  it('không trùng nhãn năm; Job Freelance không tạo năm', () => {
    master.createYear(ctx, 'MAIN', '2025');
    expect(() => master.createYear(ctx, 'MAIN', '2025')).toThrow();
    expect(() => master.createYear(ctx, 'FREELANCE', '2025')).toThrow(/không chia theo năm/);
  });
  it('đổi nhãn năm giữ liên kết Project', () => {
    const p = projects.createProject(ctx, input());
    master.renameYear(ctx, mainYear, '2026 (chính)');
    expect(projects.getProject(ctx, p.id).yearLabel).toBe('2026 (chính)');
  });
  it('không xóa năm còn dữ liệu', () => {
    projects.createProject(ctx, input());
    expect(() => master.deleteYear(ctx, mainYear)).toThrow(/còn 1 Project/);
  });
});

describe('Project (FR-PROJ, FR-NAV-007, FR-XLSX-006/007/009)', () => {
  it('hoàn thành / bỏ hoàn thành, completed_at', () => {
    const p = projects.createProject(ctx, input());
    const done = projects.setProjectCompleted(ctx, p.id, true);
    expect(done.isCompleted).toBe(true);
    expect(done.completedAt).toBeTruthy();
    const back = projects.setProjectCompleted(ctx, p.id, false);
    expect(back.isCompleted).toBe(false);
    expect(back.completedAt).toBeNull();
  });
  it('từ chối ngày tới hạn < ngày tiếp nhận và file không phải dwg/txt/docx/pdf', () => {
    expect(() => projects.createProject(ctx, input({ dueDate: '2026-11-01' }))).toThrow();
    expect(() => projects.createProject(ctx, input({ filePath: 'C:\\x\\a.xlsx', fileName: 'a.xlsx', fileExtension: 'xlsx' }))).toThrow(/dwg/);
    const pdf = projects.createProject(ctx, input({ projectName: 'Có PDF', filePath: 'C:\\x\\Báo giá.pdf', fileName: 'Báo giá.pdf', fileExtension: 'pdf' }));
    expect(pdf.fileExtension).toBe('pdf');
    const docx = projects.createProject(ctx, input({ projectName: 'Có DOCX', filePath: 'C:\\x\\Thuyết minh.DOCX', fileName: 'Thuyết minh.DOCX', fileExtension: 'docx' }));
    expect(docx.fileExtension).toBe('docx');
  });
  const payload = (name: string) => ({
    sourceFileName: name,
    sourcePath: `C:\\data\\${name}`,
    sheetNames: ['Equipment'],
    workbookSignature: 'sig',
    info: [{ fieldKey: 'imported_project_name', fieldLabel: 'Tên Dự án', fieldValue: 'X' }],
    requirements: [{ roundNumber: 1, content: 'R1', createdDate: null }],
    items: [{ model: 'M1', brand: 'B', description: 'D' }],
    mappings: [{ sheetName: 'Equipment', sourceColumn: 'A', targetField: 'item.col.model' }],
  });
  it('TC-NAV-005: di chuyển Project giữ nguyên dữ liệu import', () => {
    const p = projects.createProject(ctx, input());
    projects.commitImport(ctx, p.id, payload('a.xlsx'));
    const y2025 = master.createYear(ctx, 'MAIN', '2025');
    const moved = projects.moveProject(ctx, p.id, y2025.id, 'POST_SALES');
    expect(moved).toMatchObject({ jobType: 'MAIN', yearLabel: '2025', workCategory: 'POST_SALES', id: p.id });
    expect(projects.getProjectImport(ctx, p.id)?.items).toHaveLength(1);
  });
  it('TC-XLSX-006/007: import mới thay thế; import lỗi giữ nguyên dữ liệu cũ', () => {
    const p = projects.createProject(ctx, input());
    projects.commitImport(ctx, p.id, payload('a.xlsx'));
    projects.commitImport(ctx, p.id, { ...payload('b.xlsx'), items: [{ model: 'M2', brand: '', description: '' }, { model: 'M3', brand: '', description: '' }] });
    expect(projects.getProjectImport(ctx, p.id)).toMatchObject({ sourceFileName: 'b.xlsx' });
    expect(() => projects.commitImport(ctx, p.id, { ...payload('c.xlsx'), info: [], requirements: [], items: [] })).toThrow();
    const bad = { ...payload('d.xlsx'), items: [{ model: 'ok', brand: '', description: '' }, null as never] };
    expect(() => projects.commitImport(ctx, p.id, bad)).toThrow();
    const imp = projects.getProjectImport(ctx, p.id)!;
    expect(imp.sourceFileName).toBe('b.xlsx');
    expect(imp.items.map((i) => i.model)).toEqual(['M2', 'M3']);
    expect(projects.savedMappings(ctx, 'sig')).toHaveLength(1);
  });
  it('TC-XLSX-009: gỡ dữ liệu import không xóa Project', () => {
    const p = projects.createProject(ctx, input());
    projects.commitImport(ctx, p.id, payload('a.xlsx'));
    projects.removeImport(ctx, p.id);
    expect(projects.getProjectImport(ctx, p.id)).toBeNull();
    expect(projects.getProject(ctx, p.id).hasImport).toBe(false);
  });
  it('xóa Project: Experience giữ project_text snapshot', () => {
    const b = master.createMaster(ctx, 'brands', 'VCA');
    const p = projects.createProject(ctx, input({ projectName: 'Kho lạnh' }));
    const e = records.createExperience(ctx, { brandId: b.id, experienceDate: '2026-11-16', projectId: p.id, projectText: null, deviceModel: '', event: 'E', webUrl: '', images: [] });
    expect(e).toMatchObject({ projectExists: true, projectText: 'Kho lạnh' });
    projects.deleteProject(ctx, p.id);
    expect(records.listExperience(ctx, b.id)[0]).toMatchObject({ projectExists: false, projectText: 'Kho lạnh' });
  });
});

describe('Warranty (TC-WAR-001/006, NFR-011)', () => {
  it('mật khẩu được mã hóa khi lưu, chỉ hiện khi reveal, giữ nguyên khi không đổi', () => {
    const w = records.createWarranty(ctx, {
      jobYearId: mainYear,
      model: 'P3265',
      brandId: null,
      ipAddress: '192.168.1.10',
      username: 'root',
      password: 'S3cret!',
      macAddress: '',
      serialNumber: 'SN1',
      receivedDate: '2026-11-01',
      testedDate: null,
      customerReport: 'Mất hình',
      inspection: '',
      result: '',
      resolution: '',
      caseNumber: 'C-01',
      images: [],
    });
    expect(w.hasPassword).toBe(true);
    expect(JSON.stringify(w)).not.toContain('S3cret!');
    const raw = ctx.db.scalar<string>('SELECT password_encrypted FROM warranty_records WHERE id = ?', [w.id]);
    expect(raw).not.toContain('S3cret!');
    expect(records.revealWarrantyPassword(ctx, w.id)).toBe('S3cret!');
    const { id: _id, hasPassword: _h, brandName: _b, jobType: _j, yearLabel: _y, createdAt: _c, updatedAt: _u, ...rest } = w;
    records.updateWarranty(ctx, w.id, { ...rest, password: undefined, model: 'P3265-LVE' });
    expect(records.revealWarrantyPassword(ctx, w.id)).toBe('S3cret!');
    records.updateWarranty(ctx, w.id, { ...rest, password: '' });
    expect(records.listWarranty(ctx, mainYear)[0].hasPassword).toBe(false);
  });
  it('yêu cầu ít nhất Model hoặc Case no', () => {
    expect(() =>
      records.createWarranty(ctx, {
        jobYearId: mainYear, model: '', brandId: null, ipAddress: '', username: '', macAddress: '', serialNumber: '', receivedDate: null,
        testedDate: null, customerReport: '', inspection: '', result: '', resolution: '', caseNumber: '', images: [],
      }),
    ).toThrow();
  });
});

describe('Ảnh & Backup/Restore (NFR-015, AC-012)', () => {
  it('ảnh lưu local, backup gồm DB + ảnh, restore khôi phục đúng và tạo bản sao an toàn', async () => {
    const src = path.join(tmpDir(), 'photo.png');
    fs.writeFileSync(src, Buffer.from('89504e470d0a1a0a', 'hex'));
    const [img] = importImages(ctx, [src]);
    const b = master.createMaster(ctx, 'brands', 'Ruckus');
    records.createExperience(ctx, { brandId: b.id, experienceDate: '2026-11-16', projectId: null, projectText: null, deviceModel: 'R750', event: 'Lỗi mesh', webUrl: 'https://ruckus.com', images: [img] });
    projects.createProject(ctx, input());

    const backupFile = path.join(tmpDir(), 'bk.zip');
    writeBackup(ctx, backupFile);
    expect(inspectBackup(backupFile).counts).toMatchObject({ projects: 1, experience: 1, images: 1 });

    projects.deleteProject(ctx, projects.listProjects(ctx)[0].id);
    records.deleteExperience(ctx, records.listExperience(ctx, null)[0].id);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(false);

    await restoreBackup(ctx, backupFile);
    expect(projects.listProjects(ctx)).toHaveLength(1);
    expect(records.listExperience(ctx, null)[0].images[0].storageKey).toBe(img.storageKey);
    expect(fs.existsSync(path.join(ctx.paths.imagesDir, img.storageKey))).toBe(true);
    expect(fs.readdirSync(ctx.paths.backupsDir).some((f) => f.startsWith('auto-before-restore-'))).toBe(true);
  });
  it('từ chối file không phải backup', async () => {
    const bad = path.join(tmpDir(), 'x.zip');
    fs.writeFileSync(bad, 'nope');
    await expect(restoreBackup(ctx, bad)).rejects.toThrow();
  });
});
