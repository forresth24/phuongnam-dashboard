import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Loader2, ScrollText, Users, ExternalLink, Banknote } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { getContractMonthRange } from '../lib/settings-helpers';
import { PaymentFormModal } from './PaymentFormModal';
import {
  formatVND, firstDayOfMonthStr, getCurrentMonthYear, isPaymentInCurrentMonth,
  calculateExpectedAmount, makeEmptyPaymentForm,
  type PaymentFormData,
} from '../lib/payment-utils';

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
  onNavigate?: (tab: string) => void;
}

const emptyRoom = { id: '', name: '', type: 'Phòng đơn', price: 0, original_price: 0, note: '' };

export function RoomsTab({ config, data, loading, role, onRefresh, onNavigate }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<any>(null);
  const [form, setForm] = useState(emptyRoom);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [detailRoom, setDetailRoom] = useState<string | null>(null);
  const [detailType, setDetailType] = useState<'contract' | 'tenants'>('contract');
  // Quick payment
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payInitialForm, setPayInitialForm] = useState<PaymentFormData | null>(null);
  const [isNoticeMode, setIsNoticeMode] = useState(false);

  // Sorting
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'status'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const rooms = data.rooms;
  const isAdmin = role === 'admin';
  const { min: minMonths } = getContractMonthRange(data.settings);

  const getActiveContract = (roomId: string) =>
    data.contracts.find((c: any) => String(c.room_id).trim() === String(roomId).trim());

  const getRoomBadges = (room: any) => {
    const activeContract = getActiveContract(room.id);
    const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(room.id).trim());
    const hasContract = !!activeContract;
    let hasDeposit = false, hasPaidCurrentMonth = false;
    if (activeContract) {
      const cp = data.payments.filter((p: any) => String(p.contract_id).trim() === String(activeContract.id).trim());
      hasDeposit = cp.some((p: any) => String(p.payment_type || '').toLowerCase().includes('cọc'));
      hasPaidCurrentMonth = cp.some((p: any) => 
        String(p.payment_type || '').toLowerCase().includes('tiền phòng') && 
        isPaymentInCurrentMonth(p.received_date || p.date)
      );
    }
    return { hasContract, hasDeposit, hasPaidCurrentMonth, memberCount: roomTenants.length, contractNote: activeContract?.note };
  };

  // Room CRUD
  const openCreate = () => { setEditRoom(null); setForm(emptyRoom); setModalOpen(true); };
  const openEdit = (room: any) => {
    setEditRoom(room);
    setForm({ id: room.id, name: room.name, type: room.type || '', price: room.price || 0, original_price: room.original_price || 0, note: room.note || '' });
    setModalOpen(true);
  };
  const handleSave = async () => {
    setSaving(true);
    try { if (editRoom) await API.updateRoom(config, editRoom.id, form); else await API.createRoom(config, form); setModalOpen(false); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setSaving(false);
  };
  const handleDelete = async () => {
    if (!deleteId) return; setDeleting(true);
    try { await API.deleteRoom(config, deleteId); setDeleteId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  // Quick Payment
  const openPayForRoom = (room: any) => {
    const contract = getActiveContract(room.id);
    const startDate = firstDayOfMonthStr();
    const exp = calculateExpectedAmount(room.id, data, getActiveContract, !contract, startDate);
    const isDepositOnly = room.status === 'available';
    
    const initForm: PaymentFormData = {
      ...makeEmptyPaymentForm(minMonths),
      room_id: room.id,
      contract_id: contract ? contract.id : '',
      start_date: startDate,
      tenant: contract ? contract.tenant : '',
      phone: contract ? contract.phone : '',
      people_count: contract ? Number(contract.people_count) || 1 : 1,
      ...applyFields(exp, isDepositOnly),
    };
    setPayInitialForm(initForm);
    setIsNoticeMode(false);
    setPayModalOpen(true);
  };

  const openNoticeMode = () => {
    setPayInitialForm(makeEmptyPaymentForm(minMonths));
    setIsNoticeMode(true);
    setPayModalOpen(true);
  };

  const applyFields = (exp: ReturnType<typeof calculateExpectedAmount>, isDepositOnly: boolean) => {
    let included = ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'];
    if (isDepositOnly) {
      included = ['deposit_fee'];
    }

    return {
      amount: isDepositOnly ? exp.deposit : exp.total - exp.deposit,
      base_rent: exp.basePrice,
      extra_person_fee: exp.extraPersonFee,
      living_fee: exp.internetSurcharge,
      water_fee: exp.livingFee,
      electric_fee: exp.electricFee,
      deposit_fee: exp.deposit,
      discount: exp.discount,
      included_fields: included,
      days_stayed: exp.daysStayed,
      days_in_month: exp.daysInMonth,
      old_electric: exp.oldElectric,
      new_electric: exp.oldElectric,
      electric_usage: 0,
    };
  };

  const { month, year } = getCurrentMonthYear();
  const detailContract = detailRoom ? getActiveContract(detailRoom) : null;
  const detailTenants = detailRoom ? data.tenants.filter((t: any) => String(t.room_id).trim() === String(detailRoom).trim()) : [];
  const detailRoomObj = detailRoom ? rooms.find((r: any) => String(r.id) === String(detailRoom)) : null;

  const sortedRooms = [...rooms].sort((a, b) => {
    let valA, valB;
    if (sortBy === 'price') {
      valA = a.price || 0;
      valB = b.price || 0;
    } else if (sortBy === 'status') {
      valA = a.status || '';
      valB = b.status || '';
    } else {
      // Sort by name (extract number if possible)
      valA = a.name || '';
      valB = b.name || '';
      const numA = parseInt(valA.replace(/\D/g, ''));
      const numB = parseInt(valB.replace(/\D/g, ''));
      if (!isNaN(numA) && !isNaN(numB)) {
        valA = numA;
        valB = numB;
      }
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (key: 'name' | 'price' | 'status') => {
    if (sortBy === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortOrder(key === 'price' ? 'desc' : 'asc'); // Default price to desc (highest first)
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-slate-800">Danh sách phòng</h2>
          <div className="flex bg-slate-100 rounded-xl p-1 text-[11px] font-medium">
            <button onClick={() => toggleSort('name')} className={`px-3 py-1.5 rounded-lg transition-colors ${sortBy === 'name' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Tên {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}</button>
            <button onClick={() => toggleSort('price')} className={`px-3 py-1.5 rounded-lg transition-colors ${sortBy === 'price' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Giá {sortBy === 'price' && (sortOrder === 'asc' ? '↑' : '↓')}</button>
            <button onClick={() => toggleSort('status')} className={`px-3 py-1.5 rounded-lg transition-colors ${sortBy === 'status' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Trạng thái {sortBy === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={openNoticeMode} className="inline-flex items-center gap-2 bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm">
              <ScrollText size={18} /> Thông báo thu tiền
            </button>
          )}
          {isAdmin && (
            <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm">
              <Plus size={18} /> Thêm phòng
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedRooms.map((r: any, i: number) => {
          const badges = getRoomBadges(r);
          return (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} key={r.id}
              className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{r.name}</h3>
                  {r.type && <span className="text-xs font-medium text-slate-500 block mt-0.5">{r.type}</span>}
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${r.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                  {r.status === 'available' ? 'Trống' : 'Đang thuê'}
                </span>
              </div>
              {r.status === 'occupied' && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <Badge variant={badges.hasContract ? 'success' : 'neutral'}>📋 {badges.hasContract ? 'Có HĐ' : 'Chưa có HĐ'}</Badge>
                  <Badge variant={badges.hasDeposit ? 'info' : 'warning'}>💵 {badges.hasDeposit ? 'Đã cọc' : 'Chưa cọc'}</Badge>
                  <Badge variant={badges.hasPaidCurrentMonth ? 'success' : 'danger'}>{badges.hasPaidCurrentMonth ? '✅' : '❌'} TT T{month}/{year}</Badge>
                  <Badge variant="purple">👥 {badges.memberCount} người</Badge>
                </div>
              )}
              <p className="text-slate-500 mb-3 text-sm">
                {r.original_price > 0 && r.original_price !== r.price && (
                  <s className="text-slate-400 mr-2">{formatVND(r.original_price)}</s>
                )}
                <span className="font-medium text-indigo-600">{formatVND(r.price)}</span> / tháng
              </p>
              {r.note && <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg mb-2">📝 {r.note}</div>}
              {badges.contractNote && <div className="text-xs text-indigo-600 bg-indigo-50 p-2 rounded-lg mb-2">📝 HĐ: {badges.contractNote}</div>}

              <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                <div className="flex gap-1 flex-wrap">
                  {isAdmin && (
                    <button onClick={() => openPayForRoom(r)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-2 py-1.5 rounded-lg transition-colors"
                      title={r.status === 'available' ? 'Thu cọc + Tạo HĐ' : 'Thu tiền'}>
                      <Banknote size={13} /> {r.status === 'available' ? 'Thu cọc' : 'Thu tiền'}
                    </button>
                  )}
                  {r.status === 'occupied' && badges.hasContract && (
                    <button onClick={() => { setDetailRoom(r.id); setDetailType('contract'); }}
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1.5 rounded-lg transition-colors"><ScrollText size={13} /> HĐ</button>
                  )}
                  {r.status === 'occupied' && badges.memberCount > 0 && (
                    <button onClick={() => { setDetailRoom(r.id); setDetailType('tenants'); }}
                      className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 px-2 py-1.5 rounded-lg transition-colors"><Users size={13} /> {badges.memberCount} TV</button>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(r)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 transition-colors"><Pencil size={16} /></button>
                    <button onClick={() => setDeleteId(r.id)} className="p-2 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"><Trash2 size={16} /></button>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
        {rooms.length === 0 && <div className="col-span-full text-center py-12 text-slate-400">Chưa có phòng nào</div>}
      </div>

      {/* Detail Modal */}
      <Modal open={!!detailRoom} onClose={() => setDetailRoom(null)}
        title={detailRoomObj ? `${detailRoomObj.name} — ${detailType === 'contract' ? 'Hợp đồng' : 'Khách thuê'}` : ''} maxWidth="max-w-lg">
        <div className="flex gap-2 mb-4 bg-slate-100 rounded-xl p-1">
          <button onClick={() => setDetailType('contract')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${detailType === 'contract' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>📋 Hợp đồng</button>
          <button onClick={() => setDetailType('tenants')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${detailType === 'tenants' ? 'bg-white shadow text-purple-700' : 'text-slate-500'}`}>👥 Khách thuê ({detailTenants.length})</button>
        </div>
        {detailType === 'contract' && (detailContract ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-400 text-xs block">Mã HĐ</span><span className="font-mono text-xs">{detailContract.id}</span></div>
              <div><span className="text-slate-400 text-xs block">Trạng thái</span><Badge variant={detailContract.status === 'active' ? 'success' : 'neutral'}>{detailContract.status === 'active' ? 'Đang hoạt động' : 'Đã kết thúc'}</Badge></div>
              <div><span className="text-slate-400 text-xs block">Khách</span><span className="font-medium">{detailContract.tenant}</span></div>
              <div><span className="text-slate-400 text-xs block">SĐT</span><span>{detailContract.phone || '—'}</span></div>
              <div><span className="text-slate-400 text-xs block">Thời hạn</span><span>{detailContract.start_date} → {detailContract.end_date || '—'}</span></div>
              <div><span className="text-slate-400 text-xs block">Số người</span><span>{detailContract.people_count || 1}</span></div>
              <div><span className="text-slate-400 text-xs block">Giá thuê</span><span className="font-bold text-indigo-600">{formatVND(detailContract.rent)}</span></div>
              <div><span className="text-slate-400 text-xs block">Tiền cọc</span><span>{formatVND(detailContract.deposit_paid || 0)}</span></div>
            </div>
            {detailContract.note && <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">📝 {detailContract.note}</div>}
            {onNavigate && <button onClick={() => { setDetailRoom(null); onNavigate('contracts'); }} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-2"><ExternalLink size={12} /> Mở trang Hợp đồng</button>}
          </div>
        ) : <div className="text-center py-6 text-slate-400 text-sm">Chưa có hợp đồng</div>)}
        {detailType === 'tenants' && (detailTenants.length > 0 ? (
          <div className="space-y-3">
            {detailTenants.map((t: any) => (
              <div key={t.id} className="bg-slate-50 rounded-xl p-3 text-sm">
                <div className="font-medium text-slate-900 mb-1">{t.name}</div>
                <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
                  <div>📞 {t.phone || '—'}</div><div>🪪 {t.cccd || '—'}</div>
                  <div>🎂 {t.dob || '—'}</div><div>📍 {t.address || '—'}</div>
                </div>
              </div>
            ))}
            {onNavigate && <button onClick={() => { setDetailRoom(null); onNavigate('tenants'); }} className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline mt-2"><ExternalLink size={12} /> Mở trang Khách thuê</button>}
          </div>
        ) : <div className="text-center py-6 text-slate-400 text-sm">Chưa có khách thuê</div>)}
      </Modal>

      {/* Quick Payment Modal — uses shared PaymentFormModal */}
      {payInitialForm && (
        <PaymentFormModal
          config={config}
          data={data}
          open={payModalOpen}
          onClose={() => setPayModalOpen(false)}
          onSuccess={onRefresh}
          initialForm={payInitialForm}
          showRoomSelector={false}
          showExtendedTenantFields={false}
          isNoticeMode={isNoticeMode}
        />
      )}

      {/* Room CRUD Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editRoom ? 'Sửa phòng' : 'Thêm phòng mới'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mã phòng (ID)<span className="text-rose-500 ml-0.5">*</span></label>
            <input value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} disabled={!!editRoom} placeholder="101"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tên phòng<span className="text-rose-500 ml-0.5">*</span></label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Phòng 101"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Loại phòng</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="Phòng đơn">Phòng đơn</option><option value="Phòng đôi">Phòng đôi</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giá thuê/tháng (VNĐ)</label>
              <input type="number" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              {form.price > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.price)}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Giá niêm yết (Gạch ngang)</label>
              <input type="number" value={form.original_price} onChange={e => setForm({ ...form, original_price: Number(e.target.value) })}
                className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              {form.original_price > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.original_price)}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
            <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <button onClick={handleSave} disabled={saving || !form.name}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />} {editRoom ? 'Cập nhật' : 'Tạo phòng'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={deleting}
        message={`Bạn có chắc muốn xóa phòng "${deleteId}"? Dữ liệu sẽ được lưu vào history trước khi xóa.`} />
    </div>
  );
}
