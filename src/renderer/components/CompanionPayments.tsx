import { useCallback, useEffect, useMemo, useState } from 'react';
import { HandCoins, Pencil, Trash2, UserRound, Users } from 'lucide-react';
import { formatDate, formatDateTime } from '../../shared/dates';
import type { CompanionPayment, CompanionPaymentInput, FreelanceJob } from '../../shared/types';
import { hasErrors, validateCompanionPayment } from '../../shared/validation';
import { api } from '../api';
import { useAppData } from '../state/AppData';
import { useUi } from '../state/ui';
import { Field } from './common';
import { ImageGallery } from './ImageGallery';
import { Modal } from './Modal';

const VND = new Intl.NumberFormat('vi-VN');
export const formatMoney = (n: number) => `${VND.format(n)} ₫`;
const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 13);

type Companion = FreelanceJob['companions'][number];

/** Chi tiết một người đồng hành trong job: ghi lần thanh toán mới (ngày tự ghi là hôm nay) và lịch sử các lần đã trả. */
function CompanionModal({ job, companion, payments, onClose, onChanged }: { job: FreelanceJob; companion: Companion; payments: CompanionPayment[]; onClose: () => void; onChanged: () => void }) {
  const { today } = useAppData();
  const { confirm, toast, toastError } = useUi();
  const [editId, setEditId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [images, setImages] = useState<CompanionPaymentInput['images']>([]);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const input: CompanionPaymentInput = { amount: Number(amount) || 0, note, images };
  const errors = validateCompanionPayment(input);
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const editing = payments.find((p) => p.id === editId) ?? null;

  const reset = () => {
    setEditId(null);
    setAmount('');
    setNote('');
    setImages([]);
    setSubmitted(false);
  };
  const startEdit = (p: CompanionPayment) => {
    setEditId(p.id);
    setAmount(String(p.amount));
    setNote(p.note);
    setImages(p.images);
    setSubmitted(false);
  };
  const save = async () => {
    setSubmitted(true);
    if (hasErrors(errors)) return;
    setSaving(true);
    try {
      if (editing) await api.updateCompanionPayment(editing.id, input);
      else await api.addCompanionPayment(job.id, companion.id, input);
      toast('success', editing ? 'Đã cập nhật lần thanh toán.' : `Đã ghi thanh toán ${formatMoney(input.amount)} cho ${companion.name}.`);
      reset();
      onChanged();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (p: CompanionPayment) => {
    if (!(await confirm({ title: 'Xóa lần thanh toán', message: `Xóa lần thanh toán ${formatMoney(p.amount)} ngày ${formatDate(p.paidDate)} cho ${companion.name}? Ảnh đính kèm cũng bị xóa.`, confirmText: 'Xóa', danger: true })))
      return;
    try {
      await api.deleteCompanionPayment(p.id);
      if (editId === p.id) reset();
      toast('success', 'Đã xóa lần thanh toán.');
      onChanged();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Modal
      size="lg"
      title={
        <span className="row" style={{ gap: 8 }}>
          <UserRound size={18} style={{ color: 'var(--accent)' }} /> {companion.name} · {job.stt}. {job.projectName}
        </span>
      }
      onClose={onClose}
      footer={(close) => (
        <>
          <span className="left small muted">
            {payments.length} lần thanh toán · tổng {formatMoney(total)}
          </span>
          <button className="btn" onClick={close}>
            Đóng
          </button>
        </>
      )}
    >
      <div className="stack">
        <section className="form-section payment-form">
          <h3>{editing ? `Sửa lần thanh toán ngày ${formatDate(editing.paidDate)}` : `Ghi lần thanh toán mới · hôm nay ${formatDate(today)}`}</h3>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="grid-2">
              <Field label="Số tiền thanh toán (VNĐ)" required error={submitted ? errors.amount : undefined} htmlFor="cp-amount">
                <input
                  id="cp-amount"
                  className={`input ${submitted && errors.amount ? 'invalid' : ''}`}
                  inputMode="numeric"
                  placeholder="Vd 1.500.000"
                  value={amount ? VND.format(Number(amount)) : ''}
                  onChange={(e) => setAmount(digits(e.target.value))}
                />
              </Field>
              <Field label="Note" error={submitted ? errors.note : undefined} htmlFor="cp-note">
                <textarea id="cp-note" className="textarea" rows={2} maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <Field label="Ảnh (biên lai, chuyển khoản…)" error={submitted ? errors.images : undefined}>
              <ImageGallery images={images} editable onChange={setImages} />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              {editing && (
                <button type="button" className="btn" onClick={reset}>
                  Hủy sửa
                </button>
              )}
              <button type="submit" className="btn primary" disabled={saving}>
                <HandCoins size={15} /> {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Ghi thanh toán'}
              </button>
            </div>
          </form>
        </section>
        <section>
          <h3 className="card-title" style={{ fontSize: 14 }}>
            Lịch sử thanh toán ({payments.length})
          </h3>
          {payments.length === 0 ? (
            <div className="faint small">Chưa có lần thanh toán nào cho {companion.name} trong job này.</div>
          ) : (
            <ol className="payment-log" aria-label={`Các lần thanh toán cho ${companion.name}`}>
              {payments.map((p, i) => (
                <li key={p.id} className={`payment-entry ${p.id === editId ? 'editing' : ''}`}>
                  <div className="payment-head">
                    <span className="badge">Lần {payments.length - i}</span>
                    <b>{formatDate(p.paidDate)}</b>
                    <span className="payment-amount">{formatMoney(p.amount)}</span>
                    <span className="grow" />
                    <span className="small faint" title={`Ghi lúc ${formatDateTime(p.createdAt)}`}>
                      {p.updatedAt !== p.createdAt ? `sửa ${formatDateTime(p.updatedAt)}` : formatDateTime(p.createdAt)}
                    </span>
                    <button className="btn sm icon ghost" aria-label={`Sửa lần thanh toán ngày ${formatDate(p.paidDate)}`} title="Sửa" onClick={() => startEdit(p)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn sm icon ghost" style={{ color: 'var(--danger)' }} aria-label={`Xóa lần thanh toán ngày ${formatDate(p.paidDate)}`} title="Xóa" onClick={() => void remove(p)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {p.note && <div className="pre small">{p.note}</div>}
                  {p.images.length > 0 && <ImageGallery images={p.images} />}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}

/** Thẻ "Người đồng hành" ở trang chi tiết job Freelance: mỗi người một dòng tóm tắt, bấm vào để xem / ghi thanh toán. */
export function CompanionSection({ job, onChanged }: { job: FreelanceJob; onChanged: () => void }) {
  const { toastError } = useUi();
  const [payments, setPayments] = useState<CompanionPayment[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listCompanionPayments(job.id).then(setPayments).catch(toastError);
  }, [job.id, toastError]);
  useEffect(load, [load, job.updatedAt]);

  const byCompanion = useMemo(() => {
    const m = new Map<string, CompanionPayment[]>();
    for (const p of payments ?? []) m.set(p.companionId, [...(m.get(p.companionId) ?? []), p]);
    return m;
  }, [payments]);
  const open = job.companions.find((c) => c.id === openId) ?? null;

  return (
    <section className="card card-pad" style={{ marginTop: 16 }}>
      <h2 className="card-title">
        <Users size={18} /> Người đồng hành
        <span className="badge" style={{ marginLeft: 8 }}>
          {job.companions.length} người · {job.companionPaymentCount} lần thanh toán
        </span>
      </h2>
      {job.companions.length === 0 ? (
        <div className="faint small">Chưa có người đồng hành — thêm ở Chỉnh sửa (danh sách quản lý ở Settings › Master Data › Job Freelance).</div>
      ) : (
        <div className="companion-list">
          {job.companions.map((c) => {
            const list = byCompanion.get(c.id) ?? [];
            const total = list.reduce((s, p) => s + p.amount, 0);
            return (
              <button key={c.id} className="companion-row" onClick={() => setOpenId(c.id)} aria-label={`Xem thanh toán cho ${c.name}`}>
                <UserRound size={16} className="faint" />
                <b className="grow ellipsis" style={{ textAlign: 'left' }}>
                  {c.name}
                </b>
                <span className="small muted nowrap">
                  {payments === null ? '…' : list.length ? `${list.length} lần · ${formatMoney(total)} · gần nhất ${formatDate(list[0].paidDate)}` : 'Chưa thanh toán'}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {open && payments && (
        <CompanionModal
          job={job}
          companion={open}
          payments={byCompanion.get(open.id) ?? []}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            load();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
