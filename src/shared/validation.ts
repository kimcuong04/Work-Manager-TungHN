import { isValidISODate } from './dates';
import {
  CALENDAR_COLORS,
  type CalendarEventInput,
  type ExperienceInput,
  type FreelanceInput,
  type KnowledgeInput,
  type OnlineToolInput,
  type PasswordInput,
  type ProjectInput,
  type WarrantyInput,
} from './types';
import { cleanName } from './text';
import { isWebLink } from './webLink';

export type FieldErrors = Partial<Record<string, string>>;

export const LIMITS = {
  projectName: 200,
  note: 5000,
  masterName: 120,
  yearLabel: 30,
  shortText: 255,
  longText: 10000,
  url: 2000,
};

export function hasErrors(e: FieldErrors): boolean {
  return Object.values(e).some(Boolean);
}

/** Chỉ STT và Tên dự án là bắt buộc; các ngày nếu có thì phải hợp lệ. */
export function validateProjectInput(input: ProjectInput): FieldErrors {
  const e: FieldErrors = {};
  if (!input.jobYearId) e.jobYearId = 'Chọn năm.';
  if (input.workCategory !== 'PRE_SALES' && input.workCategory !== 'POST_SALES') e.workCategory = 'Chọn nhóm công việc.';
  if (input.stt === null) e.stt = 'Bắt buộc nhập STT.';
  else if (input.stt !== undefined && !(Number.isInteger(input.stt) && input.stt >= 1 && input.stt <= 999999)) e.stt = 'STT phải là số nguyên dương.';
  if (input.receivedDate && !isValidISODate(input.receivedDate)) e.receivedDate = 'Ngày không hợp lệ (dd/mm/yyyy).';
  if (input.dueDate && !isValidISODate(input.dueDate)) e.dueDate = 'Ngày không hợp lệ (dd/mm/yyyy).';
  else if (input.dueDate && isValidISODate(input.receivedDate) && input.dueDate < input.receivedDate)
    e.dueDate = 'Ngày tới hạn phải lớn hơn hoặc bằng Ngày bắt đầu.';
  const name = cleanName(input.projectName ?? '');
  if (!name) e.projectName = 'Bắt buộc nhập Tên dự án.';
  else if (name.length > LIMITS.projectName) e.projectName = `Tối đa ${LIMITS.projectName} ký tự.`;
  if (!Number.isInteger(input.priorityPoint) || input.priorityPoint < 1 || input.priorityPoint > 5)
    e.priorityPoint = 'Priority Point phải từ 1 đến 5.';
  if (input.fileExtension && !['dwg', 'txt'].includes(input.fileExtension.toLowerCase()))
    e.file = 'Chỉ hỗ trợ file .dwg hoặc .txt.';
  return e;
}

/** Job Freelance: STT và Tên dự án là bắt buộc. */
export function validateFreelanceInput(input: FreelanceInput): FieldErrors {
  const e: FieldErrors = {};
  if (input.stt === null) e.stt = 'Bắt buộc nhập STT.';
  else if (input.stt !== undefined && !(Number.isInteger(input.stt) && input.stt >= 1 && input.stt <= 999999)) e.stt = 'STT phải là số nguyên dương.';
  const name = cleanName(input.projectName ?? '');
  if (!name) e.projectName = 'Bắt buộc nhập Tên dự án.';
  else if (name.length > LIMITS.projectName) e.projectName = `Tối đa ${LIMITS.projectName} ký tự.`;
  if (input.startDate && !isValidISODate(input.startDate)) e.startDate = 'Ngày không hợp lệ (dd/mm/yyyy).';
  return e;
}

export function validatePasswordInput(input: PasswordInput, creating: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (!(input.siteName ?? '').trim()) e.siteName = 'Bắt buộc nhập Tên website.';
  if (!(input.username ?? '').trim()) e.username = 'Bắt buộc nhập Username.';
  if (creating && !input.password) e.password = 'Bắt buộc nhập Password.';
  if (input.password !== undefined && !creating && input.password === '') e.password = 'Password không được để trống.';
  checkLen(e, 'siteName', input.siteName ?? '', LIMITS.projectName);
  checkLen(e, 'username', input.username ?? '', LIMITS.shortText);
  if (input.password !== undefined) checkLen(e, 'password', input.password, 1000);
  checkLen(e, 'url', input.url ?? '', LIMITS.url);
  return e;
}

export function validateOnlineToolInput(input: OnlineToolInput): FieldErrors {
  const e: FieldErrors = {};
  if (!(input.name ?? '').trim()) e.name = 'Bắt buộc nhập Tên tool.';
  const url = (input.url ?? '').trim();
  if (!url) e.url = 'Bắt buộc nhập Link.';
  else if (!isWebLink(url)) e.url = 'Link không hợp lệ. Ví dụ: https://example.com hoặc example.com/tool';
  checkLen(e, 'name', input.name ?? '', LIMITS.projectName);
  checkLen(e, 'purpose', input.purpose ?? '', LIMITS.longText);
  checkLen(e, 'url', url, LIMITS.url);
  return e;
}

export function validateMasterName(name: string): string | null {
  const n = cleanName(name);
  if (!n) return 'Tên không được để trống.';
  if (n.length > LIMITS.masterName) return `Tối đa ${LIMITS.masterName} ký tự.`;
  return null;
}

export function validateYearLabel(label: string): string | null {
  const n = cleanName(label);
  if (!n) return 'Nhãn năm không được để trống.';
  if (n.length > LIMITS.yearLabel) return `Tối đa ${LIMITS.yearLabel} ký tự.`;
  return null;
}

/** Chỉ chấp nhận http/https; chặn javascript:, file:, data:... */
export function validateWebUrl(url: string): string | null {
  const s = url.trim();
  if (!s) return null;
  if (s.length > LIMITS.url) return 'Link quá dài.';
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return 'Link không hợp lệ. Ví dụ: https://example.com';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Chỉ chấp nhận link http:// hoặc https://';
  return null;
}

function checkLen(e: FieldErrors, key: string, value: string, max: number) {
  if ((value ?? '').length > max) e[key] = `Tối đa ${max} ký tự.`;
}

export function validateWarrantyInput(input: WarrantyInput): FieldErrors {
  const e: FieldErrors = {};
  if (input.stt === null) e.stt = 'Bắt buộc nhập STT.';
  else if (input.stt !== undefined && !(Number.isInteger(input.stt) && input.stt >= 1 && input.stt <= 999999)) e.stt = 'STT phải là số nguyên dương.';
  if (!input.jobYearId) e.jobYearId = 'Thiếu năm.';
  if (!input.model.trim() && !input.caseNumber.trim()) e.model = 'Nhập ít nhất Model hoặc Case no.';
  if (input.receivedDate && !isValidISODate(input.receivedDate)) e.receivedDate = 'Ngày không hợp lệ.';
  if (input.testedDate && !isValidISODate(input.testedDate)) e.testedDate = 'Ngày không hợp lệ.';
  for (const k of ['model', 'ipAddress', 'username', 'macAddress', 'serialNumber', 'caseNumber'] as const)
    checkLen(e, k, input[k], LIMITS.shortText);
  if (input.password !== undefined) checkLen(e, 'password', input.password, LIMITS.shortText);
  for (const k of ['customerReport', 'inspection', 'result', 'resolution'] as const)
    checkLen(e, k, input[k], LIMITS.longText);
  return e;
}

export function validateExperienceInput(input: ExperienceInput): FieldErrors {
  const e: FieldErrors = {};
  if (!input.brandId) e.brandId = 'Thiếu Hãng.';
  if (!input.experienceDate) e.experienceDate = 'Bắt buộc nhập Date.';
  else if (!isValidISODate(input.experienceDate)) e.experienceDate = 'Ngày không hợp lệ.';
  if (!input.event.trim()) e.event = 'Bắt buộc nhập Event.';
  checkLen(e, 'event', input.event, LIMITS.longText);
  checkLen(e, 'deviceModel', input.deviceModel, LIMITS.shortText);
  checkLen(e, 'projectText', input.projectText ?? '', LIMITS.projectName);
  checkLen(e, 'webUrl', input.webUrl, LIMITS.url);
  checkLen(e, 'localPath', input.localPath ?? '', LIMITS.url);
  return e;
}

export function validateKnowledgeInput(input: KnowledgeInput): FieldErrors {
  const e: FieldErrors = {};
  if (!input.knowledgeDate) e.knowledgeDate = 'Bắt buộc nhập Ngày.';
  else if (!isValidISODate(input.knowledgeDate)) e.knowledgeDate = 'Ngày không hợp lệ.';
  if (!input.title.trim()) e.title = 'Bắt buộc nhập Tiêu đề.';
  checkLen(e, 'title', input.title, LIMITS.projectName);
  checkLen(e, 'deviceModel', input.deviceModel, LIMITS.shortText);
  checkLen(e, 'content', input.content, LIMITS.longText);
  checkLen(e, 'webUrl', input.webUrl, LIMITS.url);
  checkLen(e, 'localPath', input.localPath ?? '', LIMITS.url);
  return e;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(t: string | null | undefined): t is string {
  return !!t && TIME_RE.test(t);
}

export function validateCalendarEventInput(input: CalendarEventInput): FieldErrors {
  const e: FieldErrors = {};
  if (!input.eventDate) e.eventDate = 'Bắt buộc chọn ngày.';
  else if (!isValidISODate(input.eventDate)) e.eventDate = 'Ngày không hợp lệ.';
  if (!input.title.trim()) e.title = 'Bắt buộc nhập tiêu đề.';
  checkLen(e, 'title', input.title, LIMITS.projectName);
  checkLen(e, 'note', input.note, LIMITS.note);
  if (input.startTime && !isValidTime(input.startTime)) e.startTime = 'Giờ không hợp lệ.';
  if (input.endTime && !isValidTime(input.endTime)) e.endTime = 'Giờ không hợp lệ.';
  if (input.endTime && !input.startTime) e.startTime = 'Nhập giờ bắt đầu.';
  if (isValidTime(input.startTime) && isValidTime(input.endTime) && input.endTime <= input.startTime)
    e.endTime = 'Giờ kết thúc phải sau giờ bắt đầu.';
  if (input.color && !(CALENDAR_COLORS as readonly string[]).includes(input.color)) e.color = 'Màu không hợp lệ.';
  return e;
}

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}
