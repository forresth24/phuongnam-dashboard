import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';

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
  // For auto-create contract
  tenant: string;
  phone: string;
  cccd: string;
  duration: number;
}

const makeEmptyForm = (): PaymentForm => ({
  room_id: '', contract_id: '', payment_type: 'Tiền phòng', amount: 0,
  date: todayStr(), receiver: '', method: 'Tiền mặt',
  status: 'Chưa tới chủ nhà', is_partial: false, note: '',
  tenant: '', phone: '', cccd: '', duration: 12,
});

interface FieldError {
  room_id?: string;
  amount?: string;
  receiver?: string;
  tenant?: string;
  phone_cccd?: string;
}

export function PaymentsTab({ config, data, loading, role, onRefresh }: Props) {
  const [acting, setActing] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(makeEmptyForm());
  const [errors, setErrors] = useState<FieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const payments = [...data.payments].reverse(); // newest first

  // Determine if room has active contract
  const getActiveContract = (roomId: string) => {
    return data.contracts.find((c: any) => String(c.room_id).trim() === String(roomId).trim());
  };

  const needsNewContract = form.room_id && !getActiveContract(form.room_id);

  const onRoomChange = (roomId: string) => {
    const contract = getActiveContract(roomId);
    const room = data.rooms.find((r: any) => r.id === roomId);
    const price = room ? Number(room.price) || 0 : 0;

    setForm({
      ...form,
      room_id: roomId,
      contract_id: contract ? contract.id : '',
      amount: price,
      tenant: contract ? contract.tenant : '',
      phone: contract ? contract.phone : '',
    });
    if (errors.room_id) setErrors({ ...errors, room_id: undefined });
  };

  const validate = (): boolean => {
    const e: FieldError = {};
    if (!form.room_id) e.room_id = 'Vui lòng chọn phòng';
    if (!form.amount || form.amount <= 0) e.amount = 'Vui lòng nhập số tiền';
    if (!form.receiver.trim()) e.receiver = 'Vui lòng nhập tên người nhận';
    if (needsNewContract) {
      if (!form.tenant.trim()) e.tenant = 'Vui lòng nhập tên khách thuê';
      if (!form.phone.trim() && !form.cccd.trim()) e.phone_cccd = 'Cần ít nhất SĐT hoặc CCCD';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError('');
    try {
      let contractId = form.contract_id;

      // Auto-create contract if room is empty
      if (!contractId && needsNewContract) {
        const contractResult = await API.createContract(config, {
          room_id: form.room_id,
          tenant: form.tenant,
          phone: form.phone,
          cccd: form.cccd,
          duration: form.duration,
        });
        contractId = contractResult.id;
      }

      if (!contractId) {
        setSaveError('Không tìm thấy hợp đồng cho phòng này');
        setSaving(false);
        return;
      }

      // Determine is_partial
      const room = data.rooms.find((r: any) => r.id === form.room_id);
      const roomPrice = room ? Number(room.price) || 0 : 0;
      const isPartial = form.payment_type === 'Tiền phòng' && form.amount < roomPrice;

      await API.createPayment(config, {
        contract_id: contractId,
        payment_type: form.payment_type,
        amount: form.amount,
        date: form.date || todayStr(),
        note: form.note,
        receiver: form.receiver,
        method: form.method,
        status: form.status,
        is_partial: isPartial,
        total_amount_calculated: roomPrice,
      });

      setModalOpen(false);
      onRefresh();
    } catch (e: any) {
      setSaveError(e.message || 'Lỗi không xác định');
    }
    setSaving(false);
  };

  const handleComplete = async (id: string) => {
    setActing(id);
    try {
      await API.completePayment(config, id);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await API.deletePayment(config, deleteId);
      setDeleteId(null);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  const openCreate = () => {
    setForm(makeEmptyForm());
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  // Find room name for a contract
  const getRoom = (contractId: string) => {
    const c = data.contracts_all.find((c: any) => c.id === contractId);
    if (!c) return contractId;
    const r = data.rooms.find((r: any) => r.id === c.room_id);
    return r ? r.name : c.room_id;
  };

  const F = (k: string, v: any) => {
    setForm({ ...form, [k]: v });
    const errKey = k === 'phone' || k === 'cccd' ? 'phone_cccd' : k;
    if ((errors as any)[errKey]) setErrors({ ...errors, [errKey]: undefined });
  };

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

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
                    {String(p.is_partial).toUpperCase() === 'TRUE' && (
                      <Badge variant="danger" className="mt-1">Trả thiếu</Badge>
                    )}
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
                    {p.method ? (
                      <Badge variant={p.method === 'Chuyển khoản' ? 'info' : 'neutral'}>{p.method}</Badge>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={(!p.status || p.status === 'Hoàn thành') ? 'success' : 'warning'}>
                      {p.status || 'Hoàn thành'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[150px] truncate">{p.note || '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {p.status === 'Chưa tới chủ nhà' && (
                          <button
                            onClick={() => handleComplete(p.id)}
                            disabled={acting === p.id}
                            className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                          >
                            {acting === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Đã nhận
                          </button>
                        )}
                        <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Chưa có giao dịch nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Payment Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Thu tiền nhanh" maxWidth="max-w-xl">
        <div className="space-y-4">
          {/* Room selection */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chọn phòng<RequiredStar /></label>
            <select value={form.room_id} onChange={e => onRoomChange(e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.room_id ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
              <option value="">Chọn phòng</option>
              {data.rooms.map((r: any) => {
                const hasHD = !!getActiveContract(r.id);
                return <option key={r.id} value={r.id}>{r.name} ({r.id}) {hasHD ? '📋' : '🆕'}</option>;
              })}
            </select>
            <FieldErr msg={errors.room_id} />
          </div>

          {/* Auto-create contract banner */}
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
                  <label className="block text-xs font-medium text-slate-600 mb-1">SĐT<RequiredStar /></label>
                  <input value={form.phone} onChange={e => F('phone', e.target.value)} placeholder="0901..."
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone_cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">CCCD <span className="text-slate-400 font-normal">(hoặc SĐT)</span></label>
                  <input value={form.cccd} onChange={e => F('cccd', e.target.value)} placeholder="079..."
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone_cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.phone_cccd} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn HĐ</label>
                  <select value={form.duration} onChange={e => F('duration', Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                    {[3, 6, 9, 12].map(n => <option key={n} value={n}>{n} tháng</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Payment details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Loại giao dịch</label>
              <select value={form.payment_type} onChange={e => F('payment_type', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                <option value="Tiền phòng">Tiền phòng</option>
                <option value="Tiền cọc giữ phòng">Tiền cọc giữ phòng</option>
                <option value="Tiền cọc phòng">Tiền cọc phòng</option>
                <option value="Phí sinh hoạt">Phí sinh hoạt</option>
                <option value="Khác">Khác</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền<RequiredStar /></label>
              <input type="number" value={form.amount} onChange={e => F('amount', Number(e.target.value))}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.amount ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
              {form.amount > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.amount)}</p>}
              <FieldErr msg={errors.amount} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu</label>
              <input value={form.date} onChange={e => F('date', e.target.value)} placeholder="DD/MM/YYYY"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
              <input value={form.receiver} onChange={e => F('receiver', e.target.value)} placeholder="Chủ nhà / Người uỷ quyền"
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.receiver ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
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
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Trạng thái</label>
              <select value={form.status} onChange={e => F('status', e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                <option value="Chưa tới chủ nhà">Chưa tới chủ nhà</option>
                <option value="Hoàn thành">Hoàn thành (đã tới chủ nhà)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea value={form.note} onChange={e => F('note', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>

          {saveError && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
              ⚠️ {saveError}
            </div>
          )}

          <button onClick={handleCreate} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />}
            {needsNewContract ? 'Tạo HĐ + Thu tiền' : 'Thu tiền'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={deleting} message="Xóa giao dịch thanh toán này? Dữ liệu sẽ được lưu vào history." />
    </div>
  );
}
