import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Archive, Loader2 } from 'lucide-react';
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

const makeEmptyForm = () => ({
  room_id: '', tenant: '', phone: '', cccd: '', people_count: 1,
  start_date: todayStr(), duration: 12, rent: 0, deposit: 0,
  start_electric: 0, discount: 0, note: '',
});

interface FieldError {
  room_id?: string;
  tenant?: string;
  phone_cccd?: string;
}

export function ContractsTab({ config, data, loading, role, onRefresh }: Props) {
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState(makeEmptyForm());
  const [errors, setErrors] = useState<FieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const contracts = filter === 'active' ? data.contracts : data.contracts_all;

  const openCreate = () => {
    setEditItem(null);
    setForm(makeEmptyForm());
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  const openEdit = (c: any) => {
    setEditItem(c);
    // Compute duration from dates for display
    setForm({
      room_id: c.room_id || '', tenant: c.tenant || '', phone: c.phone || '', cccd: '',
      people_count: c.people_count || 1, start_date: c.start_date || '', duration: 12,
      rent: c.rent || 0, deposit: c.deposit || 0, start_electric: c.start_electric || 0,
      discount: c.discount || 0, note: c.note || '',
    });
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  const validate = (): boolean => {
    const e: FieldError = {};
    if (!form.room_id) e.room_id = 'Vui lòng chọn phòng';
    if (!form.tenant.trim()) e.tenant = 'Vui lòng nhập tên khách thuê';
    if (!form.phone.trim() && !form.cccd.trim()) e.phone_cccd = 'Cần ít nhất SĐT hoặc CCCD';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // Auto-fill rent/deposit when room changes
  const onRoomChange = (roomId: string) => {
    const room = data.rooms.find((r: any) => r.id === roomId);
    const price = room ? Number(room.price) || 0 : 0;
    setForm({
      ...form,
      room_id: roomId,
      rent: price,
      deposit: price,
    });
    if (errors.room_id) setErrors({ ...errors, room_id: undefined });
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editItem) {
        // For edit, send end_date from duration
        const payload: any = { ...form };
        delete payload.duration;
        delete payload.cccd;
        await API.updateContract(config, editItem.id, payload);
      } else {
        await API.createContract(config, form);
      }
      setModalOpen(false);
      onRefresh();
    } catch (e: any) {
      setSaveError(e.message || 'Lỗi không xác định');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setActing(true);
    try {
      await API.deleteContract(config, deleteId);
      setDeleteId(null);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(false);
  };

  const handleArchive = async () => {
    if (!archiveId) return;
    setActing(true);
    try {
      await API.endContract(config, archiveId);
      setArchiveId(null);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(false);
  };

  const F = (k: string, v: any) => {
    setForm({ ...form, [k]: v });
    // Clear field-level error on change
    if (k === 'tenant' && errors.tenant) setErrors({ ...errors, tenant: undefined });
    if ((k === 'phone' || k === 'cccd') && errors.phone_cccd) setErrors({ ...errors, phone_cccd: undefined });
  };

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-800">Hợp đồng</h2>
        <div className="flex gap-2 items-center">
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button onClick={() => setFilter('active')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'active' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Đang hoạt động</button>
            <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Tất cả</button>
          </div>
          {isAdmin && (
            <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
              <Plus size={18} /> Tạo HĐ
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Mã HĐ</th>
                <th className="px-4 py-3 font-medium">Phòng</th>
                <th className="px-4 py-3 font-medium">Khách</th>
                <th className="px-4 py-3 font-medium">SĐT</th>
                <th className="px-4 py-3 font-medium">Thời hạn</th>
                <th className="px-4 py-3 font-medium">Giá thuê</th>
                <th className="px-4 py-3 font-medium">Cọc</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contracts.map((c: any) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.id}</td>
                  <td className="px-4 py-3 font-medium">{c.room_id}</td>
                  <td className="px-4 py-3">{c.tenant}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{c.start_date} → {c.end_date || '—'}</td>
                  <td className="px-4 py-3 font-medium text-indigo-600">{formatVND(c.rent)}</td>
                  <td className="px-4 py-3">{formatVND(c.deposit || 0)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={c.status === 'active' ? 'success' : 'neutral'}>
                      {c.status === 'active' ? 'Đang hoạt động' : 'Đã kết thúc'}
                    </Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>
                        {c.status === 'active' && (
                          <button onClick={() => setArchiveId(c.id)} title="Kết thúc & Archive" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600"><Archive size={14} /></button>
                        )}
                        <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              ))}
              {contracts.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Không có hợp đồng nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'Sửa hợp đồng' : 'Tạo hợp đồng mới'} maxWidth="max-w-xl">
        <div className="grid grid-cols-2 gap-4">
          {/* Room */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Mã phòng<RequiredStar /></label>
            <select value={form.room_id} onChange={e => onRoomChange(e.target.value)} disabled={!!editItem}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50 ${errors.room_id ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
              <option value="">Chọn phòng</option>
              {data.rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.id}) — {formatVND(r.price)}</option>)}
            </select>
            <FieldErr msg={errors.room_id} />
          </div>
          {/* Tenant */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Khách đại diện<RequiredStar /></label>
            <input value={form.tenant} onChange={e => F('tenant', e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.tenant ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.tenant} />
          </div>
          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">SĐT<RequiredStar /></label>
            <input value={form.phone} onChange={e => F('phone', e.target.value)} placeholder="0901234567"
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone_cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
          </div>
          {/* CCCD */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CCCD <span className="text-slate-400 font-normal">(hoặc SĐT)</span></label>
            <input value={form.cccd} onChange={e => F('cccd', e.target.value)} placeholder="079..."
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone_cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.phone_cccd} />
          </div>
          {/* People count */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số người ở</label>
            <input type="number" value={form.people_count} onChange={e => F('people_count', Number(e.target.value))} min={1}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Start date */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày bắt đầu</label>
            <input value={form.start_date} onChange={e => F('start_date', e.target.value)} placeholder="DD/MM/YYYY"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Duration */}
          {!editItem && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn hợp đồng (tháng)</label>
              <div className="flex gap-2">
                <select value={form.duration} onChange={e => F('duration', Number(e.target.value))}
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                  {[3, 6, 9, 12].map(n => <option key={n} value={n}>{n} tháng</option>)}
                </select>
                <input type="number" min={3} max={24} value={form.duration}
                  onChange={e => F('duration', Math.max(3, Math.min(24, Number(e.target.value))))}
                  className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
              </div>
            </div>
          )}
          {/* Rent */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Giá thuê/tháng</label>
            <input type="number" value={form.rent} onChange={e => F('rent', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            {form.rent > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.rent)}</p>}
          </div>
          {/* Deposit */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tiền cọc (= 1 tháng)</label>
            <input type="number" value={form.deposit} onChange={e => F('deposit', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Electric */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số điện ban đầu</label>
            <input type="number" value={form.start_electric} onChange={e => F('start_electric', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Discount */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chiết khấu/tháng</label>
            <input type="number" value={form.discount} onChange={e => F('discount', Number(e.target.value))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Note */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea value={form.note} onChange={e => F('note', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>

          {/* Backend error */}
          {saveError && (
            <div className="col-span-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">
              ⚠️ {saveError}
            </div>
          )}

          <div className="col-span-2">
            <button onClick={handleSave} disabled={saving}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />}
              {editItem ? 'Cập nhật' : 'Tạo hợp đồng'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={acting} message="Xóa hợp đồng này? Dữ liệu sẽ được lưu vào history." />
      <ConfirmDialog open={!!archiveId} onClose={() => setArchiveId(null)} onConfirm={handleArchive} loading={acting} title="Kết thúc & Archive" confirmLabel="Kết thúc HĐ" message="Kết thúc hợp đồng này? HĐ, thanh toán, và khách thuê liên quan sẽ được archive vào history sheet." />
    </div>
  );
}
