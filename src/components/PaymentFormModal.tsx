// Shared Payment Form Modal — used by both RoomsTab and PaymentsTab
import { useState, useEffect } from 'react';
import { Loader2, Banknote } from 'lucide-react';
import type { AppConfig, DashboardData } from '../lib/api';
import { API } from '../lib/api';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DatePickerInput } from './ui/DatePickerInput';
import { getReceivers, autoPaymentStatus, getContractMonthRange } from '../lib/settings-helpers';
import {
  formatVND, todayStr,
  calculateExpectedAmount, validatePaymentForm, sumBreakdown,
  makeEmptyPaymentForm,
  type PaymentFormData, type PaymentFieldError,
} from '../lib/payment-utils';

// ─── Props ────────────────────────────────────────────────

interface PaymentFormModalProps {
  config: AppConfig;
  data: DashboardData;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pre-filled form values (e.g. from room click or edit) */
  initialForm?: PaymentFormData;
  /** If editing an existing payment */
  editItem?: any;
  /** Modal title override */
  title?: string;
  /** Whether to show room selector (PaymentsTab) vs pre-selected room (RoomsTab) */
  showRoomSelector?: boolean;
  /** Whether to show extended tenant fields (issue_date, issue_place, dob, address) */
  showExtendedTenantFields?: boolean;
}

export function PaymentFormModal({
  config, data, open, onClose, onSuccess,
  initialForm, editItem, title,
  showRoomSelector = false,
  showExtendedTenantFields = false,
}: PaymentFormModalProps) {
  const [form, setForm] = useState<PaymentFormData>(initialForm || makeEmptyPaymentForm());
  const [errors, setErrors] = useState<PaymentFieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [partialConfirm, setPartialConfirm] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);

  const receivers = getReceivers(data.settings);
  const { min: minMonths, max: maxMonths } = getContractMonthRange(data.settings);

  // Sync form when modal opens with new initialForm
  useEffect(() => {
    if (open && initialForm) {
      setForm(initialForm);
      setErrors({});
      setSaveError('');
    }
  }, [open, initialForm]);

  const getActiveContract = (roomId: string) =>
    data.contracts.find((c: any) => String(c.room_id).trim() === String(roomId).trim());

  const needsNewContract = !!(form.room_id && !getActiveContract(form.room_id));

  const calcExpected = (type?: string, roomId?: string, startDate?: string, peopleCount?: number) => {
    const t = type || form.payment_type;
    const r = roomId || form.room_id;
    const isNew = r ? !getActiveContract(r) : false;
    const sd = startDate || form.start_date;
    const pc = peopleCount ?? form.people_count;
    return calculateExpectedAmount(t, r, data, getActiveContract, isNew, sd, pc);
  };

  const getExpected = () => calcExpected().total;

  // ─── Field Helpers ────────────────────────────────────────

  const F = (k: string, v: any) => {
    setForm(prev => ({ ...prev, [k]: v }));
    if ((errors as any)[k]) setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  const onReceiverChange = (receiver: string) => {
    setForm(prev => ({ ...prev, receiver, status: autoPaymentStatus(receiver, data.settings) }));
    if (errors.receiver) setErrors(prev => ({ ...prev, receiver: undefined }));
  };

  const onRoomChange = (roomId: string) => {
    const contract = getActiveContract(roomId);
    const startDate = todayStr();
    const exp = calculateExpectedAmount(form.payment_type, roomId, data, getActiveContract, !contract, startDate);
    setForm(prev => ({
      ...prev,
      room_id: roomId, contract_id: contract ? contract.id : '',
      tenant: contract ? contract.tenant : '', phone: contract ? contract.phone : '',
      cccd: '', issue_date: '', issue_place: '', address: '', dob: '',
      start_date: startDate,
      people_count: contract ? Number(contract.people_count) || 1 : 1,
      discount: 0,
      ...applyExpectedFields(exp),
    }));
    if (errors.room_id) setErrors(prev => ({ ...prev, room_id: undefined }));
  };

  const applyExpectedFields = (exp: ReturnType<typeof calculateExpectedAmount>) => ({
    amount: exp.total,
    base_rent: exp.basePrice,
    extra_person_fee: exp.extraPersonFee,
    living_fee: exp.internetSurcharge,
    water_fee: exp.livingFee,
    deposit_fee: exp.deposit,
  });

  const handleTypeChange = (type: string) => {
    const exp = calcExpected(type);
    setForm(prev => ({ ...prev, payment_type: type, ...applyExpectedFields(exp) }));
  };

  const handleAmountChange = (val: number) => {
    const expected = getExpected();
    if (val !== expected && form.payment_type !== 'Khác') {
      setForm(prev => ({ ...prev, amount: val, payment_type: 'Khác' }));
    } else {
      F('amount', val);
    }
  };

  const handleStartDateChange = (val: string) => {
    const exp = calcExpected(undefined, undefined, val);
    setForm(prev => ({ ...prev, start_date: val, ...applyExpectedFields(exp) }));
  };

  const handlePeopleCountChange = (val: number) => {
    const exp = calcExpected(undefined, undefined, undefined, val);
    setForm(prev => ({ ...prev, people_count: val, ...applyExpectedFields(exp) }));
  };

  const handleBreakdownChange = (field: string, val: number) => {
    setForm(prev => {
      const updated = { ...prev, [field]: val };
      updated.amount = sumBreakdown(updated);
      return updated;
    });
  };

  // ─── Submit ─────────────────────────────────────────────

  const doSubmit = async () => {
    setSaving(true);
    setSaveError('');
    try {
      let contractId = form.contract_id;
      if (!contractId && needsNewContract) {
        const res = await API.createContract(config, {
          room_id: form.room_id, tenant: form.tenant,
          phone: form.phone, cccd: form.cccd,
          issue_date: form.issue_date, issue_place: form.issue_place,
          address: form.address, dob: form.dob,
          duration: form.duration, move_in_date: form.start_date,
          people_count: form.people_count,
        });
        contractId = res.id;
      }
      if (!contractId) { setSaveError('Không tìm thấy hợp đồng'); setSaving(false); return; }

      const expected = getExpected();
      const isPartial = form.payment_type === 'Tiền phòng' && form.amount < expected;
      const expResult = calcExpected();

      if (editItem) {
        let finalNote = form.note;
        if (form.amount !== editItem.amount || form.payment_type !== editItem.payment_type) {
          finalNote += ` [Sửa ${todayStr()}]`;
        }
        await API.updatePayment(config, editItem.id, {
          payment_type: form.payment_type, amount: form.amount,
          date: form.date, receiver: form.receiver, method: form.method,
          status: form.status, is_partial: isPartial, note: finalNote.trim(),
          total_amount_calculated: form.amount,
          discount_applied: form.discount,
          electric_total: 0, water_total: form.water_fee,
          surcharge_total: form.living_fee, extra_fee_total: form.extra_person_fee,
          days_in_month: expResult.daysStayed,
        });
      } else {
        await API.createPayment(config, {
          contract_id: contractId, payment_type: form.payment_type,
          amount: form.amount, date: form.date || todayStr(),
          note: form.note, receiver: form.receiver, method: form.method,
          status: form.status, is_partial: isPartial,
          total_amount_calculated: form.amount,
          discount_applied: form.discount,
          electric_total: 0, water_total: form.water_fee,
          surcharge_total: form.living_fee, extra_fee_total: form.extra_person_fee,
          days_in_month: expResult.daysStayed,
        });
      }
      onClose();
      onSuccess();
    } catch (e: any) { setSaveError(e.message || 'Lỗi không xác định'); }
    setSaving(false);
    setPendingSubmit(false);
  };

  const handleSubmit = async () => {
    const e = validatePaymentForm(form, needsNewContract);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const expected = getExpected();
    if ((form.payment_type === 'Tiền phòng' || form.payment_type.includes('cọc')) && form.amount < expected && expected > 0) {
      setPartialConfirm(true);
      return;
    }
    await doSubmit();
  };

  const handlePartialConfirm = async () => {
    setPartialConfirm(false);
    setPendingSubmit(true);
    await doSubmit();
  };

  // ─── Sub-components ─────────────────────────────────────

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg && msg.trim() ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

  const payRoomObj = form.room_id ? data.rooms.find((r: any) => r.id === form.room_id) : null;
  const expResult = form.room_id ? calcExpected() : null;

  const modalTitle = title || (editItem ? 'Sửa khoản thu' : (payRoomObj ? `Thu tiền — ${payRoomObj.name}` : 'Thu tiền nhanh'));

  return (
    <>
      <Modal open={open} onClose={onClose} title={modalTitle} maxWidth="max-w-xl">
        <div className="space-y-4">
          {/* Room selector (PaymentsTab mode) */}
          {showRoomSelector && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mã phòng<RequiredStar /></label>
              <select value={form.room_id} onChange={e => onRoomChange(e.target.value)} disabled={!!editItem}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50 ${errors.room_id ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
                <option value="">Chọn phòng...</option>
                {data.rooms.map((r: any) => {
                  const hasHD = !!getActiveContract(r.id);
                  return <option key={r.id} value={r.id}>{r.name} ({r.id}) {hasHD ? '📋' : '🆕'}</option>;
                })}
              </select>
              <FieldErr msg={errors.room_id} />
            </div>
          )}

          {/* Room info header (RoomsTab mode — room pre-selected) */}
          {!showRoomSelector && payRoomObj && (
            <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
              <div><span className="font-bold text-slate-900">{payRoomObj.name}</span><span className="text-xs text-slate-500 ml-2">{payRoomObj.type}</span></div>
              <span className="text-sm font-medium text-indigo-600">{formatVND(payRoomObj.price || 0)}/tháng</span>
            </div>
          )}

          {/* New contract section */}
          {needsNewContract && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
              <p className="font-medium text-amber-800 mb-2">🆕 Phòng trống — sẽ tự động tạo hợp đồng mới</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tên khách<RequiredStar /></label>
                  <input value={form.tenant} onChange={e => F('tenant', e.target.value)}
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.tenant ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.tenant} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Số điện thoại</label>
                  <input value={form.phone} onChange={e => F('phone', e.target.value)} placeholder="0901234567"
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.phone} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Số CCCD</label>
                  <input value={form.cccd} onChange={e => F('cccd', e.target.value)} placeholder="079123456789"
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.cccd} />
                </div>
                {showExtendedTenantFields && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Ngày cấp CCCD</label>
                      <DatePickerInput value={form.issue_date} onChange={v => F('issue_date', v)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nơi cấp CCCD</label>
                      <input value={form.issue_place} onChange={e => F('issue_place', e.target.value)} placeholder="CA TP.HCM"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Năm sinh</label>
                      <input value={form.dob} onChange={e => F('dob', e.target.value)} placeholder="1995"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Địa chỉ thường trú</label>
                      <input value={form.address} onChange={e => F('address', e.target.value)} placeholder="Số 123, Đường ABC, Quận 1, TP.HCM"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ngày vào ở</label>
                  <DatePickerInput value={form.start_date || ''} onChange={handleStartDateChange} />
                  {(form.payment_type.includes('Tiền phòng') || form.payment_type.includes('Tiền nước')) && expResult && (
                    <p className="text-[11px] text-slate-500 mt-1">
                      Số ngày ở: <b>{expResult.daysStayed}</b> / {expResult.daysInMonth} ngày
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn HĐ (tháng)</label>
                  <input type="number" min={minMonths} max={maxMonths} value={form.duration}
                    onChange={e => F('duration', Math.max(minMonths, Math.min(maxMonths, Number(e.target.value) || minMonths)))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  <p className="text-[11px] text-slate-400 mt-0.5">{minMonths}–{maxMonths} tháng</p>
                </div>
              </div>
            </div>
          )}

          {/* Existing contract info */}
          {!needsNewContract && form.contract_id && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800 flex items-center gap-2">
              📋 HĐ: <span className="font-mono text-xs">{form.contract_id}</span> — {form.tenant}
            </div>
          )}

          {/* Payment details grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Số người ở</label>
              <input type="number" min={1} value={form.people_count}
                onChange={e => handlePeopleCountChange(Number(e.target.value) || 1)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Loại giao dịch</label>
              <select value={form.payment_type} onChange={e => handleTypeChange(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                <option value="Tiền phòng">Tiền phòng</option>
                <option value="Tiền phòng + Tiền nước">Tiền phòng + Tiền nước</option>
                <option value="Tiền phòng + Tiền nước + Tiền cọc">Tiền phòng + Tiền nước + Tiền cọc</option>
                <option value="Tiền cọc">Tiền cọc</option>
                <option value="Tiền nước">Tiền nước</option>
                <option value="Khác">Khác</option>
              </select>
            </div>

            {/* Breakdown section */}
            <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="font-bold text-slate-700 text-sm border-b border-slate-200 pb-2 mb-2">Phân bổ số tiền (Admin kiểm tra)</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'base_rent', label: 'Tiền phòng' },
                  { key: 'extra_person_fee', label: 'Phụ thu quá người' },
                  { key: 'living_fee', label: 'Phí sinh hoạt (Rác, Internet...)' },
                  { key: 'water_fee', label: 'Tiền nước' },
                  { key: 'deposit_fee', label: 'Tiền cọc' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">{label}</label>
                    <input type="number" value={(form as any)[key]} onChange={e => handleBreakdownChange(key, Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm" />
                  </div>
                ))}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1 text-rose-500">Chiết khấu / Giảm giá</label>
                  <input type="number" value={form.discount} onChange={e => handleBreakdownChange('discount', Number(e.target.value))}
                    className="w-full bg-white border border-rose-200 rounded-lg px-2 py-1.5 text-sm text-rose-600" />
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
                <span className="text-sm font-bold text-slate-900">Tổng cộng (Định mức):</span>
                <span className="text-sm font-bold text-indigo-600">{formatVND(sumBreakdown(form))}</span>
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền thực thu<RequiredStar /></label>
              <input type="number" value={form.amount} onChange={e => handleAmountChange(Number(e.target.value))}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.amount ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
              {form.amount > 0 && <p className="text-[11px] font-medium text-indigo-600 mt-1">{formatVND(form.amount)}</p>}
              <FieldErr msg={errors.amount} />
            </div>

            {/* Date */}
            {form.receiver !== 'Chưa nhận' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu</label>
                <div className="flex items-center gap-2">
                  {form.date === todayStr() ? (
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600">Hôm nay</div>
                  ) : (
                    <div className="flex-1"><DatePickerInput value={form.date} onChange={v => F('date', v)} /></div>
                  )}
                  {form.date === todayStr() && (
                    <button onClick={() => F('date', '')} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Chọn ngày khác</button>
                  )}
                  {form.date !== todayStr() && (
                    <button onClick={() => F('date', todayStr())} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Hôm nay</button>
                  )}
                </div>
              </div>
            )}

            {/* Receiver */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
              <select value={form.receiver} onChange={e => onReceiverChange(e.target.value)}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.receiver ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
                <option value="Chưa nhận">Chưa nhận</option>
                {receivers.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <FieldErr msg={errors.receiver} />
            </div>

            {/* Method */}
            {form.receiver !== 'Chưa nhận' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Hình thức</label>
                <select value={form.method} onChange={e => F('method', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                  <option value="Tiền mặt">Tiền mặt</option>
                  <option value="Chuyển khoản">Chuyển khoản</option>
                </select>
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú{form.payment_type === 'Khác' && <RequiredStar />}</label>
            <textarea value={form.note} onChange={e => F('note', e.target.value)} rows={2}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.note ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.note} />
          </div>

          {saveError && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">⚠️ {saveError}</div>}

          <button onClick={handleSubmit} disabled={saving || pendingSubmit}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {(saving || pendingSubmit) && <Loader2 size={16} className="animate-spin" />}
            <Banknote size={18} /> {editItem ? 'Cập nhật' : (needsNewContract ? 'Tạo HĐ + Thu tiền' : 'Thu tiền')}
          </button>
        </div>
      </Modal>

      {/* Partial Payment Confirmation */}
      <ConfirmDialog open={partialConfirm} onClose={() => setPartialConfirm(false)} onConfirm={handlePartialConfirm}
        loading={pendingSubmit} title="Xác nhận thanh toán thiếu" confirmLabel="Xác nhận ghi nhận"
        message={`Số tiền ${formatVND(form.amount)} thấp hơn mức định mức ${formatVND(getExpected())}. Giao dịch sẽ được ghi nhận là "Trả thiếu". Bạn có chắc muốn tiếp tục?`} />
    </>
  );
}
