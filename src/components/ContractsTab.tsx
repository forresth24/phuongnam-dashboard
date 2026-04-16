import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Archive, Loader2 } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';

const formatVND = (n: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n);

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

const emptyForm = {
  room_id: '', tenant: '', phone: '', people_count: 1, start_date: '', end_date: '',
  rent: 0, deposit: 0, start_electric: 0, discount: 0, note: '',
};

export function ContractsTab({ config, data, loading, role, onRefresh }: Props) {
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const contracts = filter === 'active' ? data.contracts : data.contracts_all;

  const openCreate = () => {
    setEditItem(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (c: any) => {
    setEditItem(c);
    setForm({
      room_id: c.room_id || '', tenant: c.tenant || '', phone: c.phone || '',
      people_count: c.people_count || 1, start_date: c.start_date || '', end_date: c.end_date || '',
      rent: c.rent || 0, deposit: c.deposit || 0, start_electric: c.start_electric || 0,
      discount: c.discount || 0, note: c.note || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editItem) {
        await API.updateContract(config, editItem.id, form);
      } else {
        await API.createContract(config, form);
      }
      setModalOpen(false);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
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

  const F = (k: string, v: any) => setForm({ ...form, [k]: v });

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
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{c.start_date} → {c.end_date}</td>
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
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Mã phòng</label>
            <select value={form.room_id} onChange={e => F('room_id', e.target.value)} disabled={!!editItem} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50">
              <option value="">Chọn phòng</option>
              {data.rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Khách đại diện</label>
            <input value={form.tenant} onChange={e => F('tenant', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">SĐT</label>
            <input value={form.phone} onChange={e => F('phone', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số người ở</label>
            <input type="number" value={form.people_count} onChange={e => F('people_count', Number(e.target.value))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày bắt đầu (DD/MM/YYYY)</label>
            <input value={form.start_date} onChange={e => F('start_date', e.target.value)} placeholder="01/04/2026" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày kết thúc</label>
            <input value={form.end_date} onChange={e => F('end_date', e.target.value)} placeholder="01/04/2027" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Giá thuê/tháng</label>
            <input type="number" value={form.rent} onChange={e => F('rent', Number(e.target.value))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tiền cọc</label>
            <input type="number" value={form.deposit} onChange={e => F('deposit', Number(e.target.value))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số điện ban đầu</label>
            <input type="number" value={form.start_electric} onChange={e => F('start_electric', Number(e.target.value))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chiết khấu/tháng</label>
            <input type="number" value={form.discount} onChange={e => F('discount', Number(e.target.value))} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea value={form.note} onChange={e => F('note', e.target.value)} rows={2} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div className="col-span-2">
            <button onClick={handleSave} disabled={saving || !form.room_id || !form.tenant} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
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
