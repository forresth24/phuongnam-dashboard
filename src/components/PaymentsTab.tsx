import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, CheckCircle2, Loader2, FileText, Pencil } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API, downloadBase64Pdf } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DatePickerInput } from './ui/DatePickerInput';
import { getReceivers, autoPaymentStatus, getContractMonthRange } from '../lib/settings-helpers';

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);
const todayStr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

interface PaymentForm {
  room_id: string;
  contract_id: string;
  payment_type: string;
  amount: number;
  date: string;
  receiver: string;
  method: string;
  status: string;
  is_partial: boolean;
  note: string;
  tenant: string;
  phone: string;
  cccd: string;
  issue_date: string;
  issue_place: string;
  address: string;
  dob: string;
  duration: number;
  start_date?: string;
}

const makeEmptyForm = (): PaymentForm => ({
  room_id: '', contract_id: '', payment_type: 'Tiền phòng', amount: 0,
  date: todayStr(), receiver: 'Chưa nhận', method: 'Tiền mặt',
  status: 'Chưa tới chủ nhà', is_partial: false, note: '',
  tenant: '', phone: '', cccd: '', issue_date: '', issue_place: '', address: '', dob: '', duration: 12, start_date: todayStr(),
});

interface FieldError {
  room_id?: string;
  amount?: string;
  receiver?: string;
  tenant?: string;
  phone?: string;
  cccd?: string;
  note?: string;
  start_date?: string;
}

export function PaymentsTab({ config, data, loading, role, onRefresh }: Props) {
  const [acting, setActing] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(makeEmptyForm());
  const [editItem, setEditItem] = useState<any>(null);
  const [errors, setErrors] = useState<FieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Partial payment confirm
  const [partialConfirm, setPartialConfirm] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [completeItem, setCompleteItem] = useState<any>(null);
  const [completeReceiver, setCompleteReceiver] = useState('');
  const [completeMethod, setCompleteMethod] = useState('Tiền mặt');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const payments = [...data.payments].reverse();
  const receivers = getReceivers(data.settings);
  const { min: minMonths, max: maxMonths } = getContractMonthRange(data.settings);

  const getActiveContract = (roomId: string) =>
    data.contracts.find((c: any) => String(c.room_id).trim() === String(roomId).trim());

  const needsNewContract = !!(form.room_id && !getActiveContract(form.room_id));

  const calculateExpectedAmount = (type: string, roomId: string, isNewContract?: boolean, startDate?: string): number => {
    const room = data.rooms.find((r: any) => String(r.id) === String(roomId));
    const price = room ? Number(room.price) || 0 : 0;
    const contract = getActiveContract(roomId);
    
    const basePrice = contract ? (Number(contract.rent) || price) : price;
    const peopleCount = contract ? Number(contract.people_count) || 1 : 1;
    const waterPrice = Number(data.settings.WATER_PRICE_PER_PERSON) || 0;
    const surcharge = Number(data.settings.SURCHARGE_PER_PERSON) || 0;
    const livingFee = (waterPrice + surcharge) * peopleCount;
    const deposit = contract ? Number(contract.deposit) || basePrice : basePrice;

    let currentPrice = basePrice;
    let currentLivingFee = livingFee;

    if (isNewContract && startDate) {
      const parts = startDate.split('/');
      if (parts.length === 3) {
        const d = Number(parts[0]);
        const m = Number(parts[1]);
        const y = Number(parts[2]);
        const daysInMonth = new Date(y, m, 0).getDate();
        const days = daysInMonth - d + 1;
        currentPrice = Math.round((basePrice / 30) * days);
        currentLivingFee = Math.round((livingFee / 30) * days);
      }
    }

    let total = 0;
    if (type === 'Tiền phòng') total = currentPrice;
    if (type === 'Phí sinh hoạt') total = currentLivingFee;
    if (type === 'Tiền phòng + Phí sinh hoạt') total = currentPrice + currentLivingFee;
    if (type === 'Tiền phòng + Phí sinh hoạt + Tiền cọc') total = currentPrice + currentLivingFee + deposit;
    if (type === 'Tiền cọc') total = deposit;

    if (total > 0) {
      return Math.ceil(total / 10000) * 10000;
    }
    return 0;
  };

  const getExpectedAmount = (): number => {
    return calculateExpectedAmount(form.payment_type, form.room_id, needsNewContract, form.start_date);
  };

  const onRoomChange = (roomId: string) => {
    const contract = getActiveContract(roomId);
    const startDate = todayStr();
    const amount = calculateExpectedAmount(form.payment_type, roomId, !contract, startDate);
    setForm({
      ...form, room_id: roomId, contract_id: contract ? contract.id : '',
      amount: amount, tenant: contract ? contract.tenant : '',
      phone: contract ? contract.phone : '', cccd: '', issue_date: '', issue_place: '', address: '', dob: '', start_date: startDate,
    });
    if (errors.room_id) setErrors({ ...errors, room_id: undefined });
  };

  const onReceiverChange = (receiver: string) => {
    const newStatus = autoPaymentStatus(receiver, data.settings);
    setForm({ ...form, receiver, status: newStatus });
    if (errors.receiver) setErrors({ ...errors, receiver: undefined });
  };

  const validate = (): boolean => {
    const e: FieldError = {};
    if (!form.room_id) e.room_id = 'Vui lòng chọn phòng';
    if (!form.amount || form.amount <= 0) e.amount = 'Vui lòng nhập số tiền';
    if (form.payment_type === 'Khác' && !form.note.trim()) {
      e.note = 'Bắt buộc nhập Ghi chú';
    }
    if (!form.receiver.trim()) e.receiver = 'Vui lòng chọn người nhận';
    if (needsNewContract) {
      if (!form.tenant.trim()) e.tenant = 'Vui lòng nhập tên khách thuê';
      if (form.phone && !/^(0|84)(3|5|7|8|9)[0-9]{8}$/.test(form.phone)) {
        e.phone = 'SĐT không hợp lệ';
      }
      if (form.cccd && !/^0[0-9]{11}$/.test(form.cccd)) {
        e.cccd = 'CCCD gồm 12 số bắt đầu bằng 0';
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const doSubmit = async () => {
    setSaving(true);
    setSaveError('');
    try {
      let contractId = form.contract_id;
      if (!contractId && needsNewContract) {
        const res = await API.createContract(config, {
          room_id: form.room_id, tenant: form.tenant,
          phone: form.phone, cccd: form.cccd, issue_date: form.issue_date,
          issue_place: form.issue_place, address: form.address, dob: form.dob,
          duration: form.duration, start_date: form.start_date,
        });
        contractId = res.id;
      }
      if (!contractId) { setSaveError('Không tìm thấy hợp đồng'); setSaving(false); return; }

      const expected = getExpectedAmount();
      const isPartial = form.payment_type === 'Tiền phòng' && form.amount < expected;

      if (editItem) {
        let finalNote = form.note;
        if (form.amount !== editItem.amount || form.payment_type !== editItem.payment_type) {
          finalNote += ` [Sửa ${todayStr()}]`;
        }
        await API.updatePayment(config, editItem.id, {
          payment_type: form.payment_type,
          amount: form.amount,
          date: form.date,
          receiver: form.receiver,
          method: form.method,
          status: form.status,
          is_partial: isPartial,
          note: finalNote.trim(),
          total_amount_calculated: expected,
        });
      } else {
        await API.createPayment(config, {
          contract_id: contractId, payment_type: form.payment_type,
          amount: form.amount, date: form.date || todayStr(),
          note: form.note, receiver: form.receiver, method: form.method,
          status: form.status, is_partial: isPartial,
          total_amount_calculated: expected,
        });
      }
      setModalOpen(false);
      onRefresh();
    } catch (e: any) { setSaveError(e.message || 'Lỗi không xác định'); }
    setSaving(false);
    setPendingSubmit(false);
  };

  const handleCreate = async () => {
    if (!validate()) return;
    // Check partial payment
    const expected = getExpectedAmount();
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

  const handleComplete = (p: any) => {
    setCompleteItem(p);
    setCompleteReceiver(receivers[0] || '');
    setCompleteMethod(p.method || 'Tiền mặt');
  };

  const handleDoComplete = async () => {
    if (!completeItem) return;
    setActing(completeItem.id);
    try {
      await API.updatePayment(config, completeItem.id, {
        ...completeItem,
        receiver: completeReceiver,
        method: completeMethod,
        status: autoPaymentStatus(completeReceiver, data.settings),
      });
      setCompleteItem(null);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setActing(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { await API.deletePayment(config, deleteId); setDeleteId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  const handleExportPdf = async (id: string) => {
    setExportingId(id);
    try {
      const res = await API.getReceiptPdf(config, id);
      downloadBase64Pdf(res.base64, res.filename);
    } catch (e: any) {
      alert('Lỗi xuất PDF: ' + e.message);
    }
    setExportingId(null);
  };

  const openCreate = () => {
    setEditItem(null);
    setForm({ ...makeEmptyForm(), duration: minMonths });
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  const openEdit = (p: any) => {
    const contract = data.contracts_all.find((c: any) => c.id === p.contract_id);
    setEditItem(p);
    setForm({
      room_id: contract ? contract.room_id : '',
      contract_id: p.contract_id,
      payment_type: p.payment_type || 'Tiền phòng',
      amount: p.amount,
      date: p.date,
      receiver: p.receiver || 'Chưa nhận',
      method: p.method || 'Tiền mặt',
      status: p.status || 'Chưa tới chủ nhà',
      is_partial: String(p.is_partial).toUpperCase() === 'TRUE',
      note: p.note || '',
      tenant: contract ? contract.tenant : '',
      phone: contract ? contract.phone : '',
      cccd: '',
      issue_date: '',
      issue_place: '',
      address: '',
      dob: '',
      duration: 12,
      start_date: todayStr(),
    });
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  const getRoom = (contractId: string) => {
    const c = data.contracts_all.find((c: any) => c.id === contractId);
    if (!c) return contractId;
    const r = data.rooms.find((r: any) => r.id === c.room_id);
    return r ? r.name : c.room_id;
  };

  const F = (k: string, v: any) => {
    setForm({ ...form, [k]: v });
    if ((errors as any)[k]) setErrors({ ...errors, [k]: undefined });
  };

  const handleTypeChange = (type: string) => {
    const isNew = form.room_id ? !form.contract_id : false;
    const newAmount = calculateExpectedAmount(type, form.room_id, isNew, form.start_date);
    setForm({ ...form, payment_type: type, amount: newAmount > 0 || type !== 'Khác' ? newAmount : form.amount });
    if (errors.amount) setErrors({ ...errors, amount: undefined });
  };

  const handleAmountChange = (val: number) => {
    const isNew = form.room_id ? !form.contract_id : false;
    const expected = calculateExpectedAmount(form.payment_type, form.room_id, isNew, form.start_date);
    if (val !== expected && form.payment_type !== 'Khác') {
      setForm({ ...form, amount: val, payment_type: 'Khác' });
      if (errors.amount) setErrors({ ...errors, amount: undefined });
    } else {
      F('amount', val);
    }
  };

  const handleStartDateChange = (val: string) => {
    const isNew = form.room_id ? !form.contract_id : false;
    const newAmount = calculateExpectedAmount(form.payment_type, form.room_id, isNew, val);
    setForm({ ...form, start_date: val, amount: newAmount > 0 || form.payment_type !== 'Khác' ? newAmount : form.amount });
  };

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg && msg.trim() ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Lịch sử thanh toán</h2>
        {isAdmin && (
          <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
            <Plus size={18} /> Thu tiền
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">HĐ / Phòng</th>
                <th className="px-4 py-3 font-medium">Loại GD</th>
                <th className="px-4 py-3 font-medium">Số tiền</th>
                <th className="px-4 py-3 font-medium">Ngày</th>
                <th className="px-4 py-3 font-medium">Người nhận</th>
                <th className="px-4 py-3 font-medium">Hình thức</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Ghi chú</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p: any) => (
                <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 text-xs">{getRoom(p.contract_id)}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{p.contract_id}</div>
                  </td>
                  <td className="px-4 py-3 min-w-[130px]">
                    <span className="block text-sm">{p.payment_type || 'Tiền phòng'}</span>
                    {String(p.is_partial).toUpperCase() === 'TRUE' && <Badge variant="danger" className="mt-1">Trả thiếu</Badge>}
                  </td>
                  <td className="px-4 py-3 min-w-[130px]">
                    <div className="font-bold text-indigo-600">{formatVND(p.amount)}</div>
                    {p.total_amount_calculated > 0 && p.total_amount_calculated !== p.amount && (
                      <div className="text-[10px] text-slate-400 mt-0.5">Định mức: {formatVND(p.total_amount_calculated)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{p.date}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{p.receiver || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {(p.receiver && p.receiver !== 'Chưa nhận' && p.method) ? (
                      <Badge variant={p.method === 'Chuyển khoản' ? 'info' : 'neutral'}>{p.method}</Badge>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={(!p.status || p.status === 'Hoàn thành') ? 'success' : 'warning'}>{p.status || 'Hoàn thành'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[150px] truncate">{p.note || '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {p.status === 'Chưa tới chủ nhà' && (
                          <button onClick={() => handleComplete(p)} disabled={acting === p.id} title="Xác nhận đã nhận"
                            className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                            {acting === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Đã nhận
                          </button>
                        )}
                        <button onClick={() => openEdit(p)} title="Sửa thanh toán" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleExportPdf(p.id)} disabled={exportingId === p.id} 
                          title={(!p.receiver || p.receiver === 'Chưa nhận') ? "Xuất PDF Thông báo thanh toán" : "Xuất PDF Biên lai"}
                          className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 disabled:opacity-50">
                          {exportingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                        </button>
                        <button onClick={() => setDeleteId(p.id)} title="Xóa thanh toán" className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              ))}
              {payments.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Chưa có giao dịch nào</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Payment Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'Sửa khoản thu' : 'Thu tiền nhanh'} maxWidth="max-w-xl">
        <div className="space-y-4">
          {/* Room Selection */}
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

          {/* Auto-create contract */}
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
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ngày vào ở (tính tiền HĐ mới)</label>
                  <DatePickerInput value={form.start_date || ''} onChange={handleStartDateChange} />
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

          {/* Payment details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Loại giao dịch</label>
              <select value={form.payment_type} onChange={e => handleTypeChange(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                <option value="Tiền phòng">Tiền phòng</option>
                <option value="Tiền phòng + Phí sinh hoạt">Tiền phòng + Phí sinh hoạt</option>
                <option value="Tiền phòng + Phí sinh hoạt + Tiền cọc">Tiền phòng + Phí sinh hoạt + Tiền cọc</option>
                <option value="Tiền cọc">Tiền cọc</option>
                <option value="Phí sinh hoạt">Phí sinh hoạt</option>
                <option value="Khác">Khác</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền<RequiredStar /></label>
              <input type="number" value={form.amount} onChange={e => handleAmountChange(Number(e.target.value))}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.amount ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
              {form.amount > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.amount)}</p>}
              <FieldErr msg={errors.amount} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu</label>
              <DatePickerInput value={form.date} onChange={v => F('date', v)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
              <select value={form.receiver} onChange={e => onReceiverChange(e.target.value)}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.receiver ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
                <option value="Chưa nhận">Chưa nhận</option>
                {receivers.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <FieldErr msg={errors.receiver} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Hình thức</label>
              <select value={form.method} onChange={e => F('method', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                <option value="Tiền mặt">Tiền mặt</option>
                <option value="Chuyển khoản">Chuyển khoản</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú{form.payment_type === 'Khác' && <RequiredStar />}</label>
            <textarea value={form.note} onChange={e => F('note', e.target.value)} rows={2}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.note ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.note} />
          </div>

          {saveError && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">⚠️ {saveError}</div>}

          <button onClick={handleCreate} disabled={saving || pendingSubmit}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {(saving || pendingSubmit) && <Loader2 size={16} className="animate-spin" />}
            {needsNewContract ? 'Tạo HĐ + Thu tiền' : 'Thu tiền'}
          </button>
        </div>
      </Modal>

      {/* Partial Payment Confirmation */}
      <ConfirmDialog
        open={partialConfirm}
        onClose={() => setPartialConfirm(false)}
        onConfirm={handlePartialConfirm}
        loading={pendingSubmit}
        title="Xác nhận thanh toán thiếu"
        confirmLabel="Xác nhận ghi nhận"
        message={`Số tiền ${formatVND(form.amount)} thấp hơn mức định mức ${formatVND(getExpectedAmount())}. Giao dịch sẽ được ghi nhận là "Trả thiếu". Bạn có chắc muốn tiếp tục?`}
      />

      {/* Receipt Confirmation Modal */}
      <Modal open={!!completeItem} onClose={() => setCompleteItem(null)} title="Xác nhận nhận tiền" maxWidth="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Bạn đang xác nhận đã nhận số tiền <span className="font-bold text-indigo-600">{completeItem ? formatVND(completeItem.amount) : ''}</span> cho <span className="font-medium text-slate-900">{completeItem?.payment_type}</span>.
          </p>
          
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
            <select value={completeReceiver} onChange={e => setCompleteReceiver(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              {receivers.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phương thức<RequiredStar /></label>
            <select value={completeMethod} onChange={e => setCompleteMethod(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              <option value="Tiền mặt">Tiền mặt</option>
              <option value="Chuyển khoản">Chuyển khoản</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setCompleteItem(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Hủy</button>
            <button onClick={handleDoComplete} disabled={acting === completeItem?.id}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl text-sm font-medium transition-all shadow-md shadow-indigo-100 disabled:opacity-50 flex items-center gap-2">
              {acting === completeItem?.id && <Loader2 size={16} className="animate-spin" />}
              Xác nhận
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Xóa thanh toán" message="Bạn có chắc chắn muốn xóa khoản thanh toán này? Hành động này không thể hoàn tác."
        confirmLabel="Xóa" onConfirm={handleDelete} onClose={() => setDeleteId(null)} loading={deleting} />
    </div>
  );
}
