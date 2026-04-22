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
  formatVND, todayStr, firstDayOfMonthStr,
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

  const calcExpected = (roomId?: string, startDate?: string, peopleCount?: number) => {
    const r = roomId || form.room_id;
    const isNew = r ? !getActiveContract(r) : false;
    const sd = startDate || form.start_date;
    const pc = peopleCount ?? form.people_count;
    return calculateExpectedAmount(r, data, getActiveContract, isNew, sd, pc);
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
    const startDate = firstDayOfMonthStr();
    const exp = calculateExpectedAmount(roomId, data, getActiveContract, !contract, startDate);
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

  const applyExpectedFields = (exp: ReturnType<typeof calculateExpectedAmount>) => {
    const included = ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'];
    if (exp.deposit > 0) included.push('deposit_fee');
    
    const partialForm: any = {
      base_rent: exp.basePrice,
      extra_person_fee: exp.extraPersonFee,
      living_fee: exp.internetSurcharge,
      water_fee: exp.livingFee,
      electric_fee: exp.electricFee,
      deposit_fee: exp.deposit,
      included_fields: included,
      days_stayed: exp.daysStayed,
      days_in_month: exp.daysInMonth,
    };
    partialForm.amount = sumBreakdown(partialForm as any);
    return partialForm;
  };

  const handleAmountChange = (val: number) => {
    F('amount', val);
  };

  const handleStartDateChange = (val: string) => {
    const exp = calcExpected(undefined, val);
    setForm(prev => ({ ...prev, start_date: val, ...applyExpectedFields(exp) }));
  };

  const handlePeopleCountChange = (val: number) => {
    const exp = calcExpected(undefined, undefined, val);
    setForm(prev => ({ ...prev, people_count: val, ...applyExpectedFields(exp) }));
  };

  const handleDaysChange = (days: number) => {
    const exp = calcExpected();
    const ratio = days / exp.daysInMonth;
    const newForm = {
      ...form,
      days_stayed: days,
      base_rent: Math.round(exp.fullBasePrice * ratio),
      extra_person_fee: Math.round(exp.fullExtraFee * ratio),
      living_fee: Math.round(exp.fullSurcharge * ratio),
      water_fee: Math.round(exp.fullLivingFee * ratio),
      electric_fee: Math.round(exp.fullElectric * ratio),
    };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
  };

  const handleBreakdownChange = (key: string, val: number) => {
    const newForm = { ...form, [key]: val };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
  };

  const toggleField = (key: string) => {
    const current = form.included_fields || [];
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    const newForm = { ...form, included_fields: next };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
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
      const isPartial = form.amount < expected;
      const expResult = calcExpected();

      const commonPayload = {
        amount: form.amount, date: form.date || todayStr(),
        note: form.note, receiver: form.receiver, method: form.method,
        status: form.status, is_partial: isPartial,
        total_amount_calculated: form.amount,
        discount_applied: form.discount,
        base_rent: form.base_rent,
        extra_fee_total: form.extra_person_fee,
        surcharge_total: form.living_fee,
        water_total: form.water_fee,
        electric_total: form.electric_fee,
        deposit_fee: form.deposit_fee,
        days_in_month: expResult.daysStayed,
        payment_type: 'Thu tiền tháng',
      };

      if (editItem) {
        let finalNote = form.note;
        if (form.amount !== editItem.amount) {
          finalNote += ` [Sửa ${todayStr()}]`;
        }
        await API.updatePayment(config, editItem.id, {
          ...commonPayload,
          note: finalNote.trim(),
        });
      } else {
        await API.createPayment(config, {
          contract_id: contractId,
          ...commonPayload,
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
    if (form.amount < expected && expected > 0) {
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

          {/* Days Proration - Now for everyone */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Số ngày tính phí (Prorate)</label>
                <div className="flex items-center gap-2">
                  {form.days_stayed === form.days_in_month ? (
                    <div className="w-20 bg-white border border-indigo-200 text-indigo-700 font-bold rounded-xl px-3 py-2 text-sm">1 tháng</div>
                  ) : (
                    <input type="number" value={form.days_stayed} onChange={e => handleDaysChange(Number(e.target.value) || 0)}
                      className="w-20 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  )}
                  <span className="text-slate-500 font-medium text-sm">/ {form.days_in_month} ngày</span>
                  {form.days_stayed === form.days_in_month && (
                    <button onClick={() => handleDaysChange(form.days_in_month - 1)} className="text-[10px] text-indigo-600 font-medium hover:underline">Sửa số ngày</button>
                  )}
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Tính từ ngày</label>
                <DatePickerInput value={form.start_date || ''} onChange={handleStartDateChange} />
              </div>
            </div>
            {expResult && expResult.daysStayed < expResult.daysInMonth && (
              <p className="text-[11px] text-indigo-600 bg-white/50 px-2 py-1 rounded-lg border border-indigo-100 italic">
                Hệ thống đang tính tỉ lệ {expResult.daysStayed}/{expResult.daysInMonth} ngày.
              </p>
            )}
          </div>

          {/* Payment details grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Số người ở</label>
              <input type="number" min={1} value={form.people_count}
                onChange={e => handlePeopleCountChange(Number(e.target.value) || 1)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            </div>
            <div className="flex items-end pb-1">
              <p className="text-[11px] text-slate-400 italic">Chọn các khoản thu bên dưới để tự động tính tổng tiền.</p>
            </div>

            {/* Breakdown section */}
            <div className="col-span-2 bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="font-bold text-slate-700 text-sm border-b border-slate-200 pb-2 mb-2">Phân bổ số tiền</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'base_rent', label: 'Tiền phòng' },
                  { key: 'extra_person_fee', label: 'Phụ thu quá người' },
                  { key: 'living_fee', label: 'Phí dịch vụ' },
                  { key: 'water_fee', label: 'Nước sinh hoạt' },
                  { key: 'electric_fee', label: 'Điện sinh hoạt' },
                  { key: 'deposit_fee', label: 'Tiền cọc' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <div className="flex items-center gap-2 mb-1">
                      <input type="checkbox" checked={form.included_fields?.includes(key)} onChange={() => toggleField(key)}
                        className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" />
                      <label className="block text-[10px] uppercase tracking-wider font-bold text-slate-400">{label}</label>
                    </div>
                    <input type="number" value={(form as any)[key]} onChange={e => handleBreakdownChange(key, Number(e.target.value))}
                      className={`w-full bg-white border rounded-lg px-2 py-1.5 text-sm transition-opacity ${form.included_fields?.includes(key) ? 'border-slate-200' : 'border-slate-100 opacity-40'}`} />
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
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea value={form.note} onChange={e => F('note', e.target.value)} rows={2} placeholder="Tháng 4/2026..."
              className={`w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none`} />
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
