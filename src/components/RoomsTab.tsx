import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Loader2, ScrollText, Users, ExternalLink, Banknote } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
const todayStr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

function getCurrentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function isPaymentInCurrentMonth(dateStr: string) {
  if (!dateStr) return false;
  const { month, year } = getCurrentMonthYear();
  const parts = String(dateStr).split('/');
  if (parts.length === 3) {
    return Number(parts[1]) === month && Number(parts[2]) === year;
  }
  const d = new Date(dateStr);
  return d.getMonth() + 1 === month && d.getFullYear() === year;
}

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
  onNavigate?: (tab: string) => void;
}

const emptyRoom = { id: '', name: '', type: 'Phòng đơn', price: 0, note: '' };

interface PayForm {
  room_id: string;
  contract_id: string;
  payment_type: string;
  amount: number;
  date: string;
  receiver: string;
  method: string;
  status: string;
  note: string;
  // auto-create contract fields
  tenant: string;
  phone: string;
  cccd: string;
  duration: number;
}

interface PayError {
  amount?: string;
  receiver?: string;
  tenant?: string;
  phone_cccd?: string;
}

export function RoomsTab({ config, data, loading, role, onRefresh, onNavigate }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editRoom, setEditRoom] = useState<any>(null);
  const [form, setForm] = useState(emptyRoom);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Detail panels
  const [detailRoom, setDetailRoom] = useState<string | null>(null);
  const [detailType, setDetailType] = useState<'contract' | 'tenants'>('contract');
  // Quick payment
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payForm, setPayForm] = useState<PayForm | null>(null);
  const [payErrors, setPayErrors] = useState<PayError>({});
  const [paySaving, setPaySaving] = useState(false);
  const [paySaveError, setPaySaveError] = useState('');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const rooms = data.rooms;
  const isAdmin = role === 'admin';

  const getActiveContract = (roomId: string) =>
    data.contracts.find((c: any) => String(c.room_id).trim() === String(roomId).trim());

  const getRoomBadges = (room: any) => {
    const activeContract = getActiveContract(room.id);
    const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(room.id).trim());
    const hasContract = !!activeContract;
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
    return { hasContract, hasDeposit, hasPaidCurrentMonth, memberCount: roomTenants.length, contractNote, activeContract, roomTenants };
  };

  // ─── Room CRUD ───
  const openCreate = () => { setEditRoom(null); setForm(emptyRoom); setModalOpen(true); };
  const openEdit = (room: any) => {
    setEditRoom(room);
    setForm({ id: room.id, name: room.name, type: room.type || '', price: room.price || 0, note: room.note || '' });
    setModalOpen(true);
  };
  const handleSave = async () => {
    setSaving(true);
    try {
      if (editRoom) { await API.updateRoom(config, editRoom.id, form); }
      else { await API.createRoom(config, form); }
      setModalOpen(false);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setSaving(false);
  };
  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { await API.deleteRoom(config, deleteId); setDeleteId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  // ─── Quick Payment ───
  const openPayForRoom = (room: any) => {
    const contract = getActiveContract(room.id);
    const price = Number(room.price) || 0;
    setPayForm({
      room_id: room.id,
      contract_id: contract ? contract.id : '',
      payment_type: room.status === 'available' ? 'Tiền cọc giữ phòng' : 'Tiền phòng',
      amount: price,
      date: todayStr(),
      receiver: '',
      method: 'Tiền mặt',
      status: 'Chưa tới chủ nhà',
      note: '',
      tenant: contract ? contract.tenant : '',
      phone: contract ? contract.phone : '',
      cccd: '',
      duration: 12,
    });
    setPayErrors({});
    setPaySaveError('');
    setPayModalOpen(true);
  };

  const needsNewContract = payForm ? !payForm.contract_id : false;

  const validatePay = (): boolean => {
    if (!payForm) return false;
    const e: PayError = {};
    if (!payForm.amount || payForm.amount <= 0) e.amount = 'Vui lòng nhập số tiền';
    if (!payForm.receiver.trim()) e.receiver = 'Vui lòng nhập tên người nhận';
    if (needsNewContract) {
      if (!payForm.tenant.trim()) e.tenant = 'Vui lòng nhập tên khách thuê';
      if (!payForm.phone.trim() && !payForm.cccd.trim()) e.phone_cccd = 'Cần ít nhất SĐT hoặc CCCD';
    }
    setPayErrors(e);
    return Object.keys(e).length === 0;
  };

  const handlePay = async () => {
    if (!payForm || !validatePay()) return;
    setPaySaving(true);
    setPaySaveError('');
    try {
      let contractId = payForm.contract_id;
      // Auto-create contract if room has none
      if (!contractId) {
        const contractResult = await API.createContract(config, {
          room_id: payForm.room_id,
          tenant: payForm.tenant,
          phone: payForm.phone,
          cccd: payForm.cccd,
          duration: payForm.duration,
        });
        contractId = contractResult.id;
      }
      if (!contractId) { setPaySaveError('Không tìm thấy hợp đồng'); setPaySaving(false); return; }

      const room = rooms.find((r: any) => r.id === payForm.room_id);
      const roomPrice = room ? Number(room.price) || 0 : 0;
      const isPartial = payForm.payment_type === 'Tiền phòng' && payForm.amount < roomPrice;

      await API.createPayment(config, {
        contract_id: contractId,
        payment_type: payForm.payment_type,
        amount: payForm.amount,
        date: payForm.date || todayStr(),
        note: payForm.note,
        receiver: payForm.receiver,
        method: payForm.method,
        status: payForm.status,
        is_partial: isPartial,
        total_amount_calculated: roomPrice,
      });
      setPayModalOpen(false);
      onRefresh();
    } catch (e: any) { setPaySaveError(e.message || 'Lỗi không xác định'); }
    setPaySaving(false);
  };

  const PF = (k: string, v: any) => {
    if (!payForm) return;
    setPayForm({ ...payForm, [k]: v });
    const errKey = k === 'phone' || k === 'cccd' ? 'phone_cccd' : k;
    if ((payErrors as any)[errKey]) setPayErrors({ ...payErrors, [errKey]: undefined });
  };

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

  const { month, year } = getCurrentMonthYear();

  // Detail view data
  const detailContract = detailRoom ? getActiveContract(detailRoom) : null;
  const detailTenants = detailRoom ? data.tenants.filter((t: any) => String(t.room_id).trim() === String(detailRoom).trim()) : [];
  const detailRoomObj = detailRoom ? rooms.find((r: any) => r.id === detailRoom) : null;
  const payRoomObj = payForm ? rooms.find((r: any) => r.id === payForm.room_id) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Danh sách phòng</h2>
        {isAdmin && (
          <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
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
                  <Badge variant={badges.hasContract ? 'success' : 'neutral'}>📋 {badges.hasContract ? 'Có HĐ' : 'Chưa có HĐ'}</Badge>
                  <Badge variant={badges.hasDeposit ? 'info' : 'warning'}>💵 {badges.hasDeposit ? 'Đã cọc' : 'Chưa cọc'}</Badge>
                  <Badge variant={badges.hasPaidCurrentMonth ? 'success' : 'danger'}>{badges.hasPaidCurrentMonth ? '✅' : '❌'} TT T{month}/{year}</Badge>
                  <Badge variant="purple">👥 {badges.memberCount} người</Badge>
                </div>
              )}

              {/* Price */}
              <p className="text-slate-500 mb-3">{formatVND(r.price)} / tháng</p>

              {/* Notes */}
              {r.note && <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg mb-2">📝 {r.note}</div>}
              {badges.contractNote && <div className="text-xs text-indigo-600 bg-indigo-50 p-2 rounded-lg mb-2">📝 HĐ: {badges.contractNote}</div>}

              {/* Shortcuts + Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                {/* Shortcuts */}
                <div className="flex gap-1 flex-wrap">
                  {/* Quick pay - always shown for admin */}
                  {isAdmin && (
                    <button
                      onClick={() => openPayForRoom(r)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-2 py-1.5 rounded-lg transition-colors"
                      title={r.status === 'available' ? 'Thu cọc + Tạo HĐ' : 'Thu tiền'}
                    >
                      <Banknote size={13} /> {r.status === 'available' ? 'Thu cọc' : 'Thu tiền'}
                    </button>
                  )}
                  {r.status === 'occupied' && badges.hasContract && (
                    <button onClick={() => { setDetailRoom(r.id); setDetailType('contract'); }}
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1.5 rounded-lg transition-colors" title="Xem hợp đồng">
                      <ScrollText size={13} /> HĐ
                    </button>
                  )}
                  {r.status === 'occupied' && badges.memberCount > 0 && (
                    <button onClick={() => { setDetailRoom(r.id); setDetailType('tenants'); }}
                      className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 px-2 py-1.5 rounded-lg transition-colors" title="Xem khách thuê">
                      <Users size={13} /> {badges.memberCount} TV
                    </button>
                  )}
                </div>

                {/* Admin actions */}
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

      {/* ─── Detail Modal: Contract or Tenants ─── */}
      <Modal open={!!detailRoom} onClose={() => setDetailRoom(null)}
        title={detailRoomObj ? `${detailRoomObj.name} — ${detailType === 'contract' ? 'Hợp đồng' : 'Khách thuê'}` : ''} maxWidth="max-w-lg">
        <div className="flex gap-2 mb-4 bg-slate-100 rounded-xl p-1">
          <button onClick={() => setDetailType('contract')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${detailType === 'contract' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>📋 Hợp đồng</button>
          <button onClick={() => setDetailType('tenants')} className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${detailType === 'tenants' ? 'bg-white shadow text-purple-700' : 'text-slate-500'}`}>👥 Khách thuê ({detailTenants.length})</button>
        </div>
        {detailType === 'contract' && (
          detailContract ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-slate-400 text-xs block">Mã HĐ</span><span className="font-mono text-xs">{detailContract.id}</span></div>
                <div><span className="text-slate-400 text-xs block">Trạng thái</span><Badge variant={detailContract.status === 'active' ? 'success' : 'neutral'}>{detailContract.status === 'active' ? 'Đang hoạt động' : 'Đã kết thúc'}</Badge></div>
                <div><span className="text-slate-400 text-xs block">Khách đại diện</span><span className="font-medium">{detailContract.tenant}</span></div>
                <div><span className="text-slate-400 text-xs block">SĐT</span><span>{detailContract.phone || '—'}</span></div>
                <div><span className="text-slate-400 text-xs block">Thời hạn</span><span>{detailContract.start_date} → {detailContract.end_date || '—'}</span></div>
                <div><span className="text-slate-400 text-xs block">Số người</span><span>{detailContract.people_count || 1}</span></div>
                <div><span className="text-slate-400 text-xs block">Giá thuê</span><span className="font-bold text-indigo-600">{formatVND(detailContract.rent)}</span></div>
                <div><span className="text-slate-400 text-xs block">Tiền cọc</span><span>{formatVND(detailContract.deposit || 0)}</span></div>
              </div>
              {detailContract.note && <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg mt-2">📝 {detailContract.note}</div>}
              {onNavigate && (
                <button onClick={() => { setDetailRoom(null); onNavigate('contracts'); }} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-2">
                  <ExternalLink size={12} /> Mở trang Hợp đồng
                </button>
              )}
            </div>
          ) : <div className="text-center py-6 text-slate-400 text-sm">Chưa có hợp đồng cho phòng này</div>
        )}
        {detailType === 'tenants' && (
          detailTenants.length > 0 ? (
            <div className="space-y-3">
              {detailTenants.map((t: any) => (
                <div key={t.id} className="bg-slate-50 rounded-xl p-3 text-sm">
                  <div className="font-medium text-slate-900 mb-1">{t.name}</div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
                    <div>📞 {t.phone || '—'}</div>
                    <div>🪪 {t.cccd || '—'}</div>
                    <div>🎂 {t.dob || '—'}</div>
                    <div>📍 {t.address || '—'}</div>
                  </div>
                </div>
              ))}
              {onNavigate && (
                <button onClick={() => { setDetailRoom(null); onNavigate('tenants'); }} className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline mt-2">
                  <ExternalLink size={12} /> Mở trang Khách thuê
                </button>
              )}
            </div>
          ) : <div className="text-center py-6 text-slate-400 text-sm">Chưa có khách thuê nào trong phòng này</div>
        )}
      </Modal>

      {/* ─── Quick Payment Modal ─── */}
      <Modal open={payModalOpen} onClose={() => setPayModalOpen(false)}
        title={payRoomObj ? `Thu tiền — ${payRoomObj.name}` : 'Thu tiền'} maxWidth="max-w-xl">
        {payForm && (
          <div className="space-y-4">
            {/* Room info banner */}
            <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900">{payRoomObj?.name}</span>
                <span className="text-xs text-slate-500 ml-2">{payRoomObj?.type}</span>
              </div>
              <span className="text-sm font-medium text-indigo-600">{formatVND(payRoomObj?.price || 0)}/tháng</span>
            </div>

            {/* Auto-create contract if no active contract */}
            {needsNewContract && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                <p className="font-medium text-amber-800 mb-2">🆕 Phòng trống — sẽ tự động tạo hợp đồng mới</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tên khách<RequiredStar /></label>
                    <input value={payForm.tenant} onChange={e => PF('tenant', e.target.value)}
                      className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${payErrors.tenant ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                    <FieldErr msg={payErrors.tenant} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">SĐT<RequiredStar /></label>
                    <input value={payForm.phone} onChange={e => PF('phone', e.target.value)} placeholder="0901..."
                      className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${payErrors.phone_cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">CCCD <span className="text-slate-400 font-normal">(hoặc SĐT)</span></label>
                    <input value={payForm.cccd} onChange={e => PF('cccd', e.target.value)} placeholder="079..."
                      className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${payErrors.phone_cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                    <FieldErr msg={payErrors.phone_cccd} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn HĐ</label>
                    <select value={payForm.duration} onChange={e => PF('duration', Number(e.target.value))}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                      {[3, 6, 9, 12].map(n => <option key={n} value={n}>{n} tháng</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Existing contract info */}
            {!needsNewContract && payForm.contract_id && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800 flex items-center gap-2">
                📋 HĐ: <span className="font-mono text-xs">{payForm.contract_id}</span> — {payForm.tenant}
              </div>
            )}

            {/* Payment details */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Loại giao dịch</label>
                <select value={payForm.payment_type} onChange={e => PF('payment_type', e.target.value)}
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
                <input type="number" value={payForm.amount} onChange={e => PF('amount', Number(e.target.value))}
                  className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${payErrors.amount ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                {payForm.amount > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(payForm.amount)}</p>}
                <FieldErr msg={payErrors.amount} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu</label>
                <input value={payForm.date} onChange={e => PF('date', e.target.value)} placeholder="DD/MM/YYYY"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
                <input value={payForm.receiver} onChange={e => PF('receiver', e.target.value)} placeholder="Chủ nhà / Người uỷ quyền"
                  className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${payErrors.receiver ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                <FieldErr msg={payErrors.receiver} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Hình thức</label>
                <select value={payForm.method} onChange={e => PF('method', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                  <option value="Tiền mặt">Tiền mặt</option>
                  <option value="Chuyển khoản">Chuyển khoản</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Trạng thái</label>
                <select value={payForm.status} onChange={e => PF('status', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                  <option value="Chưa tới chủ nhà">Chưa tới chủ nhà</option>
                  <option value="Hoàn thành">Hoàn thành (đã tới chủ nhà)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
              <textarea value={payForm.note} onChange={e => PF('note', e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            </div>

            {paySaveError && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">⚠️ {paySaveError}</div>
            )}

            <button onClick={handlePay} disabled={paySaving}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {paySaving && <Loader2 size={16} className="animate-spin" />}
              <Banknote size={18} />
              {needsNewContract ? 'Tạo HĐ + Thu tiền' : 'Thu tiền'}
            </button>
          </div>
        )}
      </Modal>

      {/* ─── Room Create/Edit Modal ─── */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editRoom ? 'Sửa phòng' : 'Thêm phòng mới'}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mã phòng (ID)<RequiredStar /></label>
            <input value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} disabled={!!editRoom} placeholder="101"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tên phòng<RequiredStar /></label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Phòng 101"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Loại phòng</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="Phòng đơn">Phòng đơn</option>
              <option value="Phòng đôi">Phòng đôi</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Giá thuê/tháng (VNĐ)</label>
            <input type="number" value={form.price} onChange={e => setForm({ ...form, price: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            {form.price > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.price)}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
            <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <button onClick={handleSave} disabled={saving || !form.name}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 size={16} className="animate-spin" />}
            {editRoom ? 'Cập nhật' : 'Tạo phòng'}
          </button>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={deleting}
        message={`Bạn có chắc muốn xóa phòng "${deleteId}"? Dữ liệu sẽ được lưu vào history trước khi xóa.`} />
    </div>
  );
}
