import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Archive, Loader2, FileDown, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { API, downloadBase64Pdf } from '../lib/api';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DatePickerInput } from './ui/DatePickerInput';
import { getContractMonthRange } from '../lib/settings-helpers';
import { roundUp10k } from '../lib/payment-utils';

const formatVND = (n: number, showSuffix: boolean = true) => new Intl.NumberFormat('en-US').format(n) + (showSuffix ? ' VND' : '');
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

interface ContractForm {
  room_id: string;
  tenant: string;
  phone: string;
  cccd: string;
  people_count: number | string;
  children_count: number | string;
  move_in_date: string;
  start_date: string;
  duration: number;
  rent: number;
  deposit: number;
  start_electric: number;
  discount: number;
  extra_person_fee: number;
  note: string;
  end_date: string;
}

const makeEmptyForm = (): ContractForm => ({
  room_id: '', tenant: '', phone: '', cccd: '', people_count: 1, children_count: 0,
  move_in_date: todayStr(), start_date: '', duration: 1, rent: 0, deposit: 0,
  start_electric: 0, discount: 0, extra_person_fee: 0, note: '', end_date: '',
});

interface FieldError {
  room_id?: string;
  tenant?: string;
  phone?: string;
  cccd?: string;
}

export function ContractsTab({ config, data, loading, role, onRefresh }: Props) {
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<ContractForm>(makeEmptyForm());
  const [errors, setErrors] = useState<FieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('room_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const rawContracts = filter === 'active' ? data.contracts : data.contracts_all;
  const { min: minMonths, max: maxMonths } = getContractMonthRange(data.settings);

  const sortedContracts = [...rawContracts].sort((a, b) => {
    let valA = a[sortBy], valB = b[sortBy];
    if (sortBy === 'rent' || sortBy === 'deposit' || sortBy === 'people_count' || sortBy === 'duration') {
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
      
      // Special handling for room_id to sort numerically if possible
      if (sortBy === 'room_id') {
        const numA = parseInt(valA.replace(/\D/g, ''));
        const numB = parseInt(valB.replace(/\D/g, ''));
        if (!isNaN(numA) && !isNaN(numB)) {
          valA = numA;
          valB = numB;
        }
      }
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown size={12} className="ml-1 opacity-20 group-hover:opacity-50" />;
    return sortOrder === 'asc' ? <ChevronUp size={12} className="ml-1 text-indigo-500" /> : <ChevronDown size={12} className="ml-1 text-indigo-500" />;
  };

  const displayRange = (start: string, end: string) => {
    if (!start || !end) return `${start || '—'} → ${end || '—'}`;
    const p1 = start.split('/');
    const p2 = end.split('/');
    if (p1.length === 3 && p2.length === 3) {
      const m1 = Number(p1[1]), y1 = Number(p1[2]);
      const m2 = Number(p2[1]), y2 = Number(p2[2]);
      let diffMonths = (y2 - y1) * 12 + (m2 - m1);
      // If end day is at least start day - 1, count it as a full month
      const d1 = Number(p1[0]), d2 = Number(p2[0]);
      if (d2 >= d1 - 1) diffMonths += 1;
      return `${Math.max(1, diffMonths)} tháng (${start} → ${end})`;
    }
    return `${start} → ${end}`;
  };

  const openCreate = () => {
    setEditItem(null);
    setForm({ ...makeEmptyForm(), duration: minMonths });
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  const openEdit = (c: any) => {
    let durationMonths = Number(c.duration) || 12;

    // Find cccd from tenants sheet
    const t = data.tenants.find((tenant: any) => 
      String(tenant.room_id).trim() === String(c.room_id).trim() && 
      String(tenant.name).trim() === String(c.tenant).trim()
    );
    const tenantCccd = t ? t.cccd : '';

    setEditItem(c);
    setForm({
      room_id: String(c.room_id || ''), tenant: String(c.tenant || ''), phone: String(c.phone || ''), cccd: tenantCccd,
      people_count: c.people_count || 1, children_count: c.children_count || 0,
      move_in_date: String(c.move_in_date || c.start_date || ''), start_date: String(c.start_date || ''), duration: durationMonths,
      rent: c.rent || 0, deposit: c.deposit || 0, start_electric: c.start_electric || 0,
      discount: c.discount || 0, extra_person_fee: c.extra_person_fee || 0, note: String(c.note || ''), end_date: c.end_date || '',
    });
    setErrors({});
    setSaveError('');
    setModalOpen(true);
  };

  const validate = (): boolean => {
    const e: FieldError = {};
    if (!form.room_id) e.room_id = 'Vui lòng chọn phòng';
    if (!form.tenant.trim()) e.tenant = 'Vui lòng nhập tên khách thuê';
    if (form.phone && !/^(0|84)(3|5|7|8|9)[0-9]{8}$/.test(form.phone)) {
      e.phone = 'SĐT không hợp lệ';
    }
    if (form.cccd && !/^0[0-9]{11}$/.test(form.cccd)) {
      e.cccd = 'CCCD gồm 12 số bắt đầu bằng 0';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onRoomChange = (roomId: string) => {
    const room = data.rooms.find((r: any) => String(r.id) === String(roomId));
    const price = room ? Number(room.price) || 0 : 0;
    const settings = data.settings;
    const peopleCount = Number(form.people_count) || 1;
    const roomType = (room ? room.type : 'Phòng đơn').toLowerCase();
    let epf = 0;
    if (roomType === 'phòng đơn' && peopleCount > 1) epf = roundUp10k((Number(settings.EXTRA_FEE_SINGLE) || 0) * (peopleCount - 1));
    else if (roomType === 'phòng đôi' && peopleCount > 2) epf = roundUp10k((Number(settings.EXTRA_FEE_DOUBLE) || 0) * (peopleCount - 2));
    setForm({ ...form, room_id: roomId, rent: price, deposit: price, extra_person_fee: epf });
    if (errors.room_id) setErrors({ ...errors, room_id: undefined });
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editItem) {
        const payload: any = { 
          ...form, 
          deposit: form.rent, 
          people_count: Math.max(1, Number(form.people_count) || 1),
          extra_person_fee: form.extra_person_fee 
        };
        await API.updateContract(config, editItem.id, payload);
      } else {
        await API.createContract(config, { ...form, deposit: form.rent, people_count: Math.max(1, Number(form.people_count) || 1), extra_person_fee: form.extra_person_fee });
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
    try { await API.deleteContract(config, deleteId); setDeleteId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(false);
  };

  const handleArchive = async () => {
    if (!archiveId) return;
    setActing(true);
    try { await API.endContract(config, archiveId); setArchiveId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(false);
  };

  const handlePdf = async (contractId: string, type: 'contract' | 'payment') => {
    setPdfLoading(`${type}_${contractId}`);
    try {
      const res = type === 'contract'
        ? await API.getContractPdf(config, contractId)
        : await API.getPaymentPdf(config, contractId);
      downloadBase64Pdf(res.base64, res.filename);
    } catch (e: any) { alert('Lỗi tạo PDF: ' + e.message); }
    setPdfLoading(null);
  };

  const F = (k: string, v: any) => {
    setForm({ ...form, [k]: v });
    if ((errors as any)[k]) setErrors({ ...errors, [k]: undefined });
  };

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg && msg.trim() ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

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

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th onClick={() => toggleSort('id')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Mã HĐ <SortIcon col="id" /></div></th>
                <th onClick={() => toggleSort('room_id')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Phòng <SortIcon col="room_id" /></div></th>
                <th onClick={() => toggleSort('tenant')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Khách <SortIcon col="tenant" /></div></th>
                <th onClick={() => toggleSort('phone')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">SĐT <SortIcon col="phone" /></div></th>
                <th onClick={() => toggleSort('start_date')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Thời hạn <SortIcon col="start_date" /></div></th>
                <th onClick={() => toggleSort('rent')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Giá thuê <SortIcon col="rent" /></div></th>
                <th onClick={() => toggleSort('deposit')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Cọc <SortIcon col="deposit" /></div></th>
                <th onClick={() => toggleSort('status')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Trạng thái <SortIcon col="status" /></div></th>
                {isAdmin && <th className="px-4 py-3 font-medium">Thao tác</th>}
                {!isAdmin && <th className="px-4 py-3 font-medium">Xuất PDF</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedContracts.map((c: any) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{c.id}</td>
                  <td className="px-4 py-3 font-medium">{c.room_id}</td>
                  <td className="px-4 py-3">{c.tenant}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{displayRange(c.start_date, c.end_date)}</td>
                  <td className="px-4 py-3 font-medium text-indigo-600">{formatVND(c.rent)}</td>
                  <td className="px-4 py-3">{formatVND(c.deposit || 0)}</td>
                  <td className="px-4 py-3"><Badge variant={c.status === 'active' ? 'success' : 'neutral'}>{c.status === 'active' ? 'Đang hoạt động' : 'Đã kết thúc'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => handlePdf(c.id, 'contract')} disabled={pdfLoading === `contract_${c.id}`}
                          title="Xuất PDF Hợp đồng" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 disabled:opacity-50">
                          {pdfLoading === `contract_${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                        </button>
                        <button onClick={() => handlePdf(c.id, 'payment')} disabled={pdfLoading === `payment_${c.id}`}
                          title="Xuất PDF Thông báo TT" className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 disabled:opacity-50">
                          {pdfLoading === `payment_${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                        </button>
                        {isAdmin && <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>}
                        {isAdmin && c.status === 'active' && <button onClick={() => setArchiveId(c.id)} title="Kết thúc & Archive" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600"><Archive size={14} /></button>}
                        {isAdmin && <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                </motion.tr>
              ))}
              {sortedContracts.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Không có hợp đồng nào</td></tr>}
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
            <select id="select-contract-room" value={form.room_id} onChange={e => onRoomChange(e.target.value)} disabled={!!editItem}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50 ${errors.room_id ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
              <option value="">Chọn phòng</option>
              {data.rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.id}) — {formatVND(r.price)}</option>)}
            </select>
            <FieldErr msg={errors.room_id} />
          </div>
          {/* Tenant */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Khách đại diện<RequiredStar /></label>
            <input id="input-contract-tenant" value={form.tenant} onChange={e => F('tenant', e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.tenant ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.tenant} />
          </div>
          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số điện thoại</label>
            <input id="input-contract-phone" value={form.phone} onChange={e => F('phone', e.target.value)} placeholder="0901234567" inputMode="tel"
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.phone} />
          </div>
          {/* CCCD */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số CCCD</label>
            <input id="input-contract-cccd" value={form.cccd} onChange={e => F('cccd', e.target.value)} placeholder="079123456789" inputMode="numeric"
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.cccd} />
          </div>
          {/* People count */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số người ở</label>
            <input id="input-contract-people" type="number" value={form.people_count} onChange={e => F('people_count', e.target.value)} min={1} inputMode="numeric"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Children count */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Trẻ em dưới 8 tuổi</label>
            <input id="input-contract-children" type="number" value={form.children_count} onChange={e => F('children_count', e.target.value)} min={0} inputMode="numeric"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Move-in date */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày vào ở (tính tiền HĐ mới)</label>
            <DatePickerInput id="input-contract-move-in" value={form.move_in_date} onChange={v => F('move_in_date', v)} />
          </div>
          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn HĐ (tháng)</label>
            <input id="input-contract-duration"
              type="number"
              min={minMonths} max={maxMonths}
              value={form.duration}
              inputMode="numeric"
              onChange={e => F('duration', Number(e.target.value) || 1)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 mt-0.5">{minMonths}–{maxMonths} tháng</p>
          </div>
          {/* Rent */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Giá thuê/tháng</label>
            <input id="input-contract-rent" type="number" value={form.rent} onChange={e => F('rent', Number(e.target.value))}
              inputMode="numeric" step="1000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            {form.rent > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.rent)}</p>}
          </div>
          {/* Electric */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số điện ban đầu</label>
            <input id="input-contract-electric" type="number" value={form.start_electric} onChange={e => F('start_electric', Number(e.target.value))}
              inputMode="numeric"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Extra Person Fee */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phụ thu quá người/tháng</label>
            <input id="input-contract-extra-fee" type="number" value={form.extra_person_fee} onChange={e => F('extra_person_fee', Number(e.target.value))}
              inputMode="numeric" step="1000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Discount */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chiết khấu DV/tháng</label>
            <input id="input-contract-discount" type="number" value={form.discount} onChange={e => F('discount', Number(e.target.value))}
              inputMode="numeric" step="1000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Note */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea id="textarea-contract-note" value={form.note} onChange={e => F('note', e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {saveError && (
            <div className="col-span-2 bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">⚠️ {saveError}</div>
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
