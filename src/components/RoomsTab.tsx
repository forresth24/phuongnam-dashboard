import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

function getCurrentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function isPaymentInCurrentMonth(dateStr: string) {
  if (!dateStr) return false;
  const { month, year } = getCurrentMonthYear();
  // dateStr format: DD/MM/YYYY
  const parts = String(dateStr).split('/');
  if (parts.length === 3) {
    return Number(parts[1]) === month && Number(parts[2]) === year;
  }
  // Try ISO format
  const d = new Date(dateStr);
  return d.getMonth() + 1 === month && d.getFullYear() === year;
}

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

const emptyRoom = { id: '', name: '', type: 'Phòng đơn', price: 0, note: '' };

export function RoomsTab({ config, data, loading, role, onRefresh }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<any>(null);
  const [form, setForm] = useState(emptyRoom);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const rooms = data.rooms;
  const isAdmin = role === 'admin';

  const getRoomBadges = (room: any) => {
    const activeContract = data.contracts.find((c: any) => String(c.room_id).trim() === String(room.id).trim());
    const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(room.id).trim());

    // Contract status
    const hasContract = !!activeContract;

    // Deposit status - check if any payment has "cọc" in payment_type for this contract
    let hasDeposit = false;
    let hasPaidCurrentMonth = false;

    if (activeContract) {
      const contractPayments = data.payments.filter((p: any) => String(p.contract_id).trim() === String(activeContract.id).trim());
      hasDeposit = contractPayments.some((p: any) => String(p.payment_type || '').toLowerCase().includes('cọc'));
      hasPaidCurrentMonth = contractPayments.some((p: any) =>
        p.payment_type === 'Tiền phòng' && isPaymentInCurrentMonth(p.date)
      );
    }

    const contractNote = activeContract?.note;

    return { hasContract, hasDeposit, hasPaidCurrentMonth, memberCount: roomTenants.length, contractNote };
  };

  const openCreate = () => {
    setEditRoom(null);
    setForm(emptyRoom);
    setModalOpen(true);
  };

  const openEdit = (room: any) => {
    setEditRoom(room);
    setForm({ id: room.id, name: room.name, type: room.type || '', price: room.price || 0, note: room.note || '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editRoom) {
        await API.updateRoom(config, editRoom.id, form);
      } else {
        await API.createRoom(config, form);
      }
      setModalOpen(false);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await API.deleteRoom(config, deleteId);
      setDeleteId(null);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setDeleting(false);
  };

  const { month, year } = getCurrentMonthYear();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Danh sách phòng</h2>
        {isAdmin && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus size={18} /> Thêm phòng
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map((r: any, i: number) => {
          const badges = getRoomBadges(r);
          return (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              key={r.id}
              className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow"
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{r.name}</h3>
                  {r.type && <span className="text-xs font-medium text-slate-500 block mt-0.5">{r.type}</span>}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${r.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                  {r.status === 'available' ? 'Trống' : 'Đang thuê'}
                </span>
              </div>

              {/* Badges */}
              {r.status === 'occupied' && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <Badge variant={badges.hasContract ? 'success' : 'neutral'}>
                    📋 {badges.hasContract ? 'Có HĐ' : 'Chưa có HĐ'}
                  </Badge>
                  <Badge variant={badges.hasDeposit ? 'info' : 'warning'}>
                    💵 {badges.hasDeposit ? 'Đã cọc' : 'Chưa cọc'}
                  </Badge>
                  <Badge variant={badges.hasPaidCurrentMonth ? 'success' : 'danger'}>
                    {badges.hasPaidCurrentMonth ? '✅' : '❌'} TT T{month}/{year}
                  </Badge>
                  <Badge variant="purple">
                    👥 {badges.memberCount} người
                  </Badge>
                </div>
              )}

              {/* Price */}
              <p className="text-slate-500 mb-3">{formatVND(r.price)} / tháng</p>

              {/* Notes */}
              {r.note && (
                <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg mb-2">
                  📝 {r.note}
                </div>
              )}
              {badges.contractNote && (
                <div className="text-xs text-indigo-600 bg-indigo-50 p-2 rounded-lg mb-2">
                  📝 HĐ: {badges.contractNote}
                </div>
              )}

              {/* Actions */}
              {isAdmin && (
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-50">
                  <button onClick={() => openEdit(r)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-colors">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setDeleteId(r.id)} className="p-2 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </motion.div>
          );
        })}
        {rooms.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-400">Chưa có phòng nào</div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editRoom ? 'Sửa phòng' : 'Thêm phòng mới'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mã phòng (ID)</label>
            <input
              value={form.id} onChange={e => setForm({ ...form, id: e.target.value })}
              disabled={!!editRoom}
              placeholder="101"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tên phòng</label>
            <input
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Phòng 101"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Loại phòng</label>
            <select
              value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="Phòng đơn">Phòng đơn</option>
              <option value="Phòng đôi">Phòng đôi</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Giá thuê/tháng (VNĐ)</label>
            <input
              type="number" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
            <textarea
              value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
              rows={2}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <button
            onClick={handleSave} disabled={saving || !form.name}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {editRoom ? 'Cập nhật' : 'Tạo phòng'}
          </button>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        message={`Bạn có chắc muốn xóa phòng "${deleteId}"? Dữ liệu sẽ được lưu vào history trước khi xóa.`}
      />
    </div>
  );
}
