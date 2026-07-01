import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, CheckCircle2, Loader2, FileText, Pencil, ArrowUpDown, ChevronUp, ChevronDown, Search, Filter, ArrowRightCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API, downloadBase64Pdf } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { getReceivers, autoPaymentStatus } from '../lib/settings-helpers';
import { PaymentFormModal } from './PaymentFormModal';
import { DatePickerInput } from './ui/DatePickerInput';
import {
  formatVND, firstDayOfMonthStr, makeEmptyPaymentForm, todayStr,
  type PaymentFormData,
} from '../lib/payment-utils';

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

export function PaymentsTab({ config, data, loading, role, onRefresh }: Props) {
  const [acting, setActing] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [initialForm, setInitialForm] = useState<PaymentFormData>(makeEmptyPaymentForm());
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [pdfExportItem, setPdfExportItem] = useState<any>(null);
  const [pdfDebtOverride, setPdfDebtOverride] = useState(0);
  const [pdfDueDate, setPdfDueDate] = useState('');
  const pdfOriginalDebtRef = useRef(0);
  const [completeItem, setCompleteItem] = useState<any>(null);
  const [completeReceiver, setCompleteReceiver] = useState('');
  const [completeMethod, setCompleteMethod] = useState('Tiền mặt');
  const [completeDate, setCompleteDate] = useState(todayStr());
  const [completeAmount, setCompleteAmount] = useState(0);
  const [sortBy, setSortBy] = useState<string>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Filters
  const [filterRoom, setFilterRoom] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterReceiver, setFilterReceiver] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const now = new Date();
  const currentPeriod = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const [filterPeriod, setFilterPeriod] = useState(currentPeriod);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActing, setBulkActing] = useState(false);

  // Bulk Transfer Modal
  const [bulkTransferOpen, setBulkTransferOpen] = useState(false);
  const [bulkTransferDate, setBulkTransferDate] = useState(todayStr());
  const [bulkTransferMethod, setBulkTransferMethod] = useState('Tiền mặt');
  const [bulkTransferAmount, setBulkTransferAmount] = useState(0);
  const [bulkTransferReceiver, setBulkTransferReceiver] = useState('');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const rawPayments = data.payments;
  const receivers = getReceivers(data.settings);

  const getContractTenantName = (contract: any) => {
    if (!contract) return '';
    const t = data.tenants.find((t: any) => t.id === contract.tenant_id);
    return t ? t.name : '';
  };
  const getContractTenantPhone = (contract: any) => {
    if (!contract) return '';
    const t = data.tenants.find((t: any) => t.id === contract.tenant_id);
    return t ? t.phone : '';
  };

  const getRoomName = (contractId: string) => {
    const c = data.contracts_all.find((c: any) => c.id === contractId);
    if (!c) return contractId;
    const r = data.rooms.find((r: any) => r.id === c.room_id);
    return r ? r.name : c.room_id;
  };

  const getRoomData = (contractId: string) => {
    const c = data.contracts_all.find((c: any) => c.id === contractId);
    if (!c) return null;
    return data.rooms.find((r: any) => r.id === c.room_id);
  };

  const getFloor = (contractId: string) => {
    const r = getRoomData(contractId);
    if (!r) return '';
    const match = (r.name || r.id).match(/\d/);
    return match ? match[0] : '';
  };

  const sortedPayments = [...rawPayments].sort((a, b) => {
    let valA, valB;
    if (sortBy === 'room_name') {
      valA = getRoomName(a.contract_id).toLowerCase();
      valB = getRoomName(b.contract_id).toLowerCase();
    } else if (sortBy === 'floor') {
      valA = getFloor(a.contract_id);
      valB = getFloor(b.contract_id);
    } else if (sortBy === 'amount') {
      valA = Number(a.amount) || 0;
      valB = Number(b.amount) || 0;
    } else if (sortBy === 'received_date' || sortBy === 'updated_at') {
      const parseDate = (d: string) => {
        if (!d) return '0';
        // Handle ISO-like dates (2026-04-01T10:00:00) or DD/MM/YYYY
        if (d.includes('T')) return d;
        const parts = d.split('/');
        if (parts.length === 3) return parts[2] + parts[1] + parts[0];
        return d;
      };
      valA = parseDate(a[sortBy]);
      valB = parseDate(b[sortBy]);
    } else if (sortBy === 'payment_period') {
      const parsePeriod = (p: string) => {
        if (!p) return '0';
        const parts = p.split('/');
        if (parts.length === 2) return parts[1] + parts[0]; // MM/YYYY -> YYYYMM
        return p;
      };
      valA = parsePeriod(a.payment_period || (a.received_date ? a.received_date.split('/').slice(1).join('/') : ''));
      valB = parsePeriod(b.payment_period || (b.received_date ? b.received_date.split('/').slice(1).join('/') : ''));
    } else {
      valA = String(a[sortBy] || '').toLowerCase();
      valB = String(b[sortBy] || '').toLowerCase();
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const filteredPayments = sortedPayments.filter(p => {
    if (filterRoom && !getRoomName(p.contract_id).toLowerCase().includes(filterRoom.toLowerCase()) && !p.contract_id.toLowerCase().includes(filterRoom.toLowerCase())) return false;
    if (filterType && p.payment_type !== filterType) return false;
    if (filterReceiver && p.receiver !== filterReceiver) return false;
    if (filterStatus && (p.status || 'Hoàn thành') !== filterStatus) return false;
    if (filterPeriod && !((p.payment_period || '').includes(filterPeriod))) return false;
    return true;
  });

  const totalFiltered = filteredPayments.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedPayments = filteredPayments.slice((safePage - 1) * pageSize, safePage * pageSize);

  const allFilteredIds = filteredPayments.map(p => p.id);
  const isAllSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(selectedIds.filter(id => !allFilteredIds.includes(id)));
    } else {
      const newSelected = [...new Set([...selectedIds, ...allFilteredIds])];
      setSelectedIds(newSelected);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortOrder(key === 'amount' || key === 'received_date' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown size={12} className="ml-1 opacity-20 group-hover:opacity-50" />;
    return sortOrder === 'asc' ? <ChevronUp size={12} className="ml-1 text-indigo-500" /> : <ChevronDown size={12} className="ml-1 text-indigo-500" />;
  };


  // ─── Actions ────────────────────────────────────────────

  const handleComplete = (p: any) => {
    setCompleteItem(p);
    setCompleteReceiver(receivers[0] || '');
    setCompleteMethod(p.method || 'Tiền mặt');
    setCompleteDate(todayStr());
    setCompleteAmount(p.amount || 0);
  };

  const handleDoComplete = async () => {
    if (!completeItem) return;
    setActing(completeItem.id);
    try {
      await API.updatePayment(config, completeItem.id, {
        ...completeItem,
        amount: completeAmount,
        receiver: completeReceiver,
        method: completeMethod,
        status: autoPaymentStatus(completeReceiver, data.settings),
        received_date: completeDate,
        is_partial: completeAmount < (completeItem.total_amount_calculated || completeItem.amount || 0),
      });
      setCompleteItem(null);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setActing(null);
  };

  const handleBulkTransfer = async () => {
    if (selectedIds.length === 0) return;
    const totalAmount = selectedIds.reduce((sum, id) => {
      const p = rawPayments.find(p => p.id === id);
      return sum + (Number(p?.amount) || 0);
    }, 0);
    setBulkTransferAmount(totalAmount);
    setBulkTransferReceiver(receivers[0] || '');
    setBulkTransferMethod('Tiền mặt');
    setBulkTransferDate(todayStr());
    setBulkTransferOpen(true);
  };

  const handleDoBulkTransfer = async () => {
    if (selectedIds.length === 0) return;
    setBulkActing(true);
    setBulkTransferOpen(false);
    try {
      await API.bulkUpdatePayments(config, selectedIds, {
        receiver: bulkTransferReceiver,
        status: autoPaymentStatus(bulkTransferReceiver, data.settings),
        method: bulkTransferMethod,
        received_date: bulkTransferDate,
        updated_at: new Date().toISOString(),
      });
      setSelectedIds([]);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi bulk update: ' + e.message);
    }
    setBulkActing(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { await API.deletePayment(config, deleteId); setDeleteId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  const handleExportPdfClick = async (payment: any) => {
    const isNotice = !payment.receiver || payment.receiver === 'Chưa nhận';
    if (isNotice) {
      // Notice: show popup for debt override and due date
      setPdfExportItem(payment);
      const orig = Number(payment.previous_debt) || Number(payment['nợ kỳ trước']) || 0;
      setPdfDebtOverride(orig);
      pdfOriginalDebtRef.current = orig;
      const d = new Date();
      d.setDate(d.getDate() + 3);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      setPdfDueDate(`${dd}/${mm}/${yyyy}`);
    } else {
      // Receipt: export directly, no popup
      const id = payment.id;
      setExportingId(id);
      try {
        const res = await API.getReceiptPdf(config, id);
        downloadBase64Pdf(res.base64, res.filename);
      } catch (e: any) {
        alert('Lỗi xuất PDF: ' + e.message);
      }
      setExportingId(null);
    }
  };

  const handlePdfExportConfirm = async () => {
    if (!pdfExportItem) return;
    const id = pdfExportItem.id;
    setExportingId(id);
    setPdfExportItem(null);
    try {
      const changed = pdfDebtOverride !== pdfOriginalDebtRef.current;
      if (changed) await API.updatePayment(config, id, { previous_debt: pdfDebtOverride });
      const res = await API.getReceiptPdf(config, id, pdfDueDate || undefined);
      downloadBase64Pdf(res.base64, res.filename);
      if (changed) onRefresh();
    } catch (e: any) {
      alert('Lỗi xuất PDF: ' + e.message);
    }
    setExportingId(null);
  };

  // ─── Open Forms ─────────────────────────────────────────

  const openCreate = () => {
    setEditItem(null);
    setInitialForm(makeEmptyPaymentForm());
    setModalOpen(true);
  };

  const openEdit = (p: any) => {
    const contract = data.contracts_all.find((c: any) => c.id === p.contract_id);
    setEditItem(p);
    // Map sheet headers (Vietnamese) to form fields
    const baseRent = Number(p.base_rent) || 0;
    const extraFee = Number(p.extra_fee_total) || 0;
    const livingFee = Number(p.surcharge_total) || 0;
    const waterFee = Number(p.water_total) || 0;
    const electricFee = Number(p.electric_total) || 0;
    const depositFee = Number(p.deposit_fee) || 0;
    const discount = Number(p.discount_applied) || Number(p.discount) || 0;

    const pType = String(p.payment_type || '').toLowerCase();
    const included = [];
    if (pType.includes('tháng') || pType.includes('phòng') || pType === '') {
      included.push('base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee');
    }
    if (pType.includes('cọc')) {
      included.push('deposit_fee');
    }
    // Fallback if no known type
    if (included.length === 0) {
      included.push('base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee');
    }

    setInitialForm({
      room_id: contract ? contract.room_id : '',
      contract_id: p.contract_id,
      amount: p.amount,
      received_date: p.received_date,
      receiver: p.receiver || 'Chưa nhận',
      method: p.method || 'Tiền mặt',
      status: p.status || 'Chưa tới chủ nhà',
      is_partial: String(p.is_partial).toUpperCase() === 'TRUE',
      note: p.note || '',
      tenant: getContractTenantName(contract),
      phone: getContractTenantPhone(contract),
      cccd: '',
      issue_date: '',
      issue_place: '',
      address: '',
      dob: '',
      duration: 12,
      start_date: firstDayOfMonthStr(),
      people_count: contract ? Number(contract.people_count) || 1 : 1,
      discount: discount,
      base_rent: baseRent,
      extra_person_fee: extraFee,
      living_fee: livingFee,
      water_fee: waterFee,
      electric_fee: electricFee,
      deposit_fee: depositFee,
      included_fields: included,
      stayed_days: Number(p.stayed_days) || Number(p.period_days) || 30,
      period_days: Number(p.period_days) || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
      old_electric: Number(p.old_electric) || (contract ? Number(contract.start_electric) || 0 : 0),
      new_electric: Number(p.new_electric) || 0,
      electric_usage: Number(p.electric_usage) || (Math.max(0, (Number(p.new_electric) || 0) - (Number(p.old_electric) || 0))),
      previous_debt: Number(p.previous_debt) || 0,
      deposit_paid: Number(p.deposit_paid) || 0,
      payment_period: p.payment_period || (p.received_date ? p.received_date.split('/').slice(1).join('/') : ''),
    });
    setModalOpen(true);
  };

  const getRoom = (contractId: string) => {
    const c = data.contracts_all.find((c: any) => c.id === contractId);
    if (!c) return contractId;
    const r = data.rooms.find((r: any) => r.id === c.room_id);
    return r ? r.name : c.room_id;
  };

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Lịch sử thanh toán</h2>
        <div className="flex items-center gap-3">
          {selectedIds.length > 0 && isAdmin && (
            <motion.button initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              onClick={handleBulkTransfer} disabled={bulkActing}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm">
              {bulkActing ? <Loader2 size={18} className="animate-spin" /> : <ArrowRightCircle size={18} />}
              Chuyển {selectedIds.length} mục cho Chủ nhà
            </motion.button>
          )}
          {isAdmin && (
            <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
              <Plus size={18} /> Thu tiền
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
          <input id="input-payment-filter-room" name="filter_room" type="text" placeholder="Tìm phòng, HĐ..." value={filterRoom} onChange={e => { setFilterRoom(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
        </div>

        <div className="relative">
          <Filter className="absolute left-3 top-2.5 text-slate-400" size={16} />
          <select id="select-payment-filter-type" name="filter_type" value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none">
            <option value="">Tất cả loại GD</option>
            {Array.from(new Set(rawPayments.map(p => p.payment_type))).filter(Boolean).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <select id="select-payment-filter-receiver" name="filter_receiver" value={filterReceiver} onChange={e => { setFilterReceiver(e.target.value); setPage(1); }}
            className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none">
            <option value="">Tất cả người nhận</option>
            {receivers.map(r => <option key={r} value={r}>{r}</option>)}
            <option value="Chưa nhận">Chưa nhận</option>
          </select>
        </div>

        <div className="relative">
          <select id="select-payment-filter-status" name="filter_status" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            className="w-full px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none">
            <option value="">Tất cả trạng thái</option>
            <option value="Chưa tới chủ nhà">Chưa tới chủ nhà</option>
            <option value="Hoàn thành">Hoàn thành</option>
          </select>
        </div>

        <div className="relative flex gap-2">
          <select id="select-payment-filter-period" value={filterPeriod} onChange={e => { setFilterPeriod(e.target.value); setPage(1); }}
            className="flex-1 px-4 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none">
            <option value="">Tất cả kỳ</option>
            {(() => {
              const periods = [...new Set(rawPayments
                .map(p => p.payment_period || '')
                .filter(Boolean)
              )].sort((a, b) => {
                const [mA, yA] = a.split('/');
                const [mB, yB] = b.split('/');
                return Number(yB + mB) - Number(yA + mA);
              });
              return periods.map(p => <option key={p} value={p}>{p}</option>);
            })()}
          </select>
          <input type="month" value={filterPeriod ? `20${filterPeriod.split('/')[1]}-${filterPeriod.split('/')[0]}` : ''}
            onChange={e => {
              if (e.target.value) {
                const [y, m] = e.target.value.split('-');
                setFilterPeriod(`${m}/${y.slice(2)}`);
                setPage(1);
              }
            }}
            className="w-44 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-separate border-spacing-0">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {isAdmin && (
                  <th className="w-12 px-4 py-3 font-medium sticky left-0 z-20 bg-slate-50 border-b border-slate-100">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  </th>
                )}
                <th onClick={() => toggleSort('room_name')} className={`px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group sticky border-b border-slate-100 z-20 bg-slate-50 ${isAdmin ? 'left-12' : 'left-0'}`}>
                  <div className="flex items-center">HĐ / Phòng <SortIcon col="room_name" /></div>
                </th>
                <th onClick={() => toggleSort('floor')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Tầng <SortIcon col="floor" /></div></th>
                <th onClick={() => toggleSort('payment_type')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Loại GD <SortIcon col="payment_type" /></div></th>
                <th onClick={() => toggleSort('payment_period')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Kỳ <SortIcon col="payment_period" /></div></th>
                <th onClick={() => toggleSort('amount')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Số tiền <SortIcon col="amount" /></div></th>
                <th onClick={() => toggleSort('received_date')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Ngày <SortIcon col="received_date" /></div></th>
                <th onClick={() => toggleSort('updated_at')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group whitespace-nowrap border-b border-slate-100"><div className="flex items-center">Lần sửa cuối <SortIcon col="updated_at" /></div></th>
                <th onClick={() => toggleSort('receiver')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Người nhận <SortIcon col="receiver" /></div></th>
                <th onClick={() => toggleSort('method')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Hình thức <SortIcon col="method" /></div></th>
                <th onClick={() => toggleSort('status')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group border-b border-slate-100"><div className="flex items-center">Trạng thái <SortIcon col="status" /></div></th>
                <th className="px-4 py-3 font-medium border-b border-slate-100">Ghi chú</th>
                {isAdmin && <th className="px-4 py-3 font-medium border-b border-slate-100">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagedPayments.map((p: any) => (
                <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`hover:bg-slate-50/50 transition-colors ${selectedIds.includes(p.id) ? 'bg-indigo-50/30' : ''}`}>
                  {isAdmin && (
                    <td className="w-12 px-4 py-3 sticky left-0 z-10 bg-white shadow-[1px_0_0_0_rgba(0,0,0,0.05)]">
                      <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggleSelect(p.id)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    </td>
                  )}
                  <td className={`px-4 py-3 sticky z-10 bg-white shadow-[1px_0_0_0_rgba(0,0,0,0.05)] ${isAdmin ? 'left-12' : 'left-0'}`}>
                    <div className="font-medium text-slate-900 text-xs whitespace-nowrap">{getRoom(p.contract_id)}</div>
                    <div className="text-[10px] text-slate-400 font-mono whitespace-nowrap">{p.contract_id}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-slate-600">
                    {getFloor(p.contract_id)}
                  </td>
                  <td className="px-4 py-3 min-w-[130px]">
                    <span className="block text-sm">{p.payment_type || 'Tiền phòng'}</span>
                    {String(p.is_partial).toUpperCase() === 'TRUE' && <Badge variant="danger" className="mt-1">Trả thiếu</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-slate-600">
                      {(function() {
                        const pStr = p.payment_period || p.received_date || p.date || '';
                        const parts = pStr.split('/');
                        if (parts.length === 3) return parts[1] + '/' + parts[2];
                        return pStr || '—';
                      })()}
                    </span>
                  </td>
                  <td className="px-4 py-3 min-w-[130px]">
                    <div className="font-bold text-indigo-600">{formatVND(p.amount)}</div>
                    {p.total_amount_calculated > 0 && p.total_amount_calculated !== p.amount && (
                      <div className="text-[10px] text-slate-400 mt-0.5">Định mức: {formatVND(p.total_amount_calculated)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{p.received_date || p.date}</td>
                  <td className="px-4 py-3 text-slate-400 text-[10px] whitespace-nowrap">
                    {p.updated_at ? (p.updated_at.includes('T') ? new Date(p.updated_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' }) : p.updated_at) : '—'}
                  </td>
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
                        <button onClick={() => handleExportPdfClick(p)} disabled={exportingId === p.id}
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
              {pagedPayments.length === 0 && <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-400">Chưa có giao dịch nào phù hợp bộ lọc</td></tr>}
            </tbody>
            {selectedIds.length > 0 && (
              <tfoot>
                <tr className="bg-indigo-50/80 border-t-2 border-indigo-200">
                  {isAdmin && <td className="w-12 px-4 py-3 sticky left-0 z-10 bg-indigo-50/80"></td>}
                  <td className={`px-4 py-3 sticky z-10 bg-indigo-50/80 ${isAdmin ? 'left-12' : 'left-0'}`}>
                    <span className="font-semibold text-indigo-700 text-sm">Tổng ({selectedIds.length} mục chọn)</span>
                  </td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3">
                    <span className="font-bold text-indigo-700 text-base">
                      {formatVND(selectedIds.reduce((sum, id) => {
                        const p = rawPayments.find(p => p.id === id);
                        return sum + (Number(p?.amount) || 0);
                      }, 0))}
                    </span>
                  </td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  {isAdmin && <td className="px-4 py-3"></td>}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>{totalFiltered} khoản thu</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none">
            <option value={20}>20 / trang</option>
            <option value={50}>50 / trang</option>
            <option value={100}>100 / trang</option>
          </select>
          {totalPages > 1 && (
            <span className="text-xs text-slate-400">
              {(safePage - 1) * pageSize + 1}&ndash;{Math.min(safePage * pageSize, totalFiltered)} / {totalFiltered}
            </span>
          )}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (safePage <= 4) {
                pageNum = i + 1;
              } else if (safePage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                pageNum = safePage - 3 + i;
              }
              return (
                <button key={pageNum} onClick={() => setPage(pageNum)}
                  className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${safePage === pageNum ? 'bg-indigo-600 text-white shadow-sm' : 'hover:bg-slate-100 text-slate-600'}`}>
                  {pageNum}
                </button>
              );
            })}
            <button onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
      <PaymentFormModal
        config={config}
        data={data}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={onRefresh}
        initialForm={initialForm}
        editItem={editItem}
        showRoomSelector={true}
        showExtendedTenantFields={true}
        title={editItem ? 'Sửa khoản thu' : 'Thu tiền nhanh'}
      />

      {/* Receipt Confirmation Modal */}
      <Modal open={!!completeItem} onClose={() => setCompleteItem(null)} title="Xác nhận nhận tiền" maxWidth="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Bạn đang xác nhận đã nhận số tiền <span className="font-bold text-indigo-600">{completeItem ? formatVND(completeItem.amount) : ''}</span> cho <span className="font-medium text-slate-900">{completeItem?.payment_type}</span>.
          </p>
          
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền thực nhận<RequiredStar /></label>
            <div className="relative">
              <input id="input-complete-amount" name="complete_amount" type="number" value={completeAmount} onChange={e => setCompleteAmount(Number(e.target.value) || 0)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
              <div className="absolute right-3 top-2 text-[10px] text-slate-400 uppercase font-bold pointer-events-none">VND</div>
            </div>
            {completeAmount > 0 && <p className="text-[10px] text-indigo-500 mt-1 font-medium">{formatVND(completeAmount)}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
            <select id="select-complete-receiver" name="complete_receiver" value={completeReceiver} onChange={e => setCompleteReceiver(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              {receivers.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu tiền</label>
            <div className="flex items-center gap-2">
              {completeDate === todayStr() ? (
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600">Hôm nay</div>
              ) : (
                <div className="flex-1"><DatePickerInput value={completeDate} onChange={setCompleteDate} /></div>
              )}
              {completeDate === todayStr() && (
                <button onClick={() => setCompleteDate('')} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Chọn ngày khác</button>
              )}
              {completeDate !== todayStr() && (
                <button onClick={() => setCompleteDate(todayStr())} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Chọn hôm nay</button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phương thức<RequiredStar /></label>
            <select id="select-complete-method" name="complete_method" value={completeMethod} onChange={e => setCompleteMethod(e.target.value)}
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

      {/* PDF Export Override Popup (only for payment notices) */}
      <Modal open={!!pdfExportItem} onClose={() => setPdfExportItem(null)} title="Xuất Thông báo thanh toán" maxWidth="max-w-sm">
        {pdfExportItem && (
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-xl p-3 text-sm space-y-1">
              <p>Phòng: <span className="font-medium text-slate-900">{getRoomName(pdfExportItem.contract_id)}</span></p>
              <p>Mã: <span className="font-mono text-xs text-slate-500">{pdfExportItem.id}</span></p>
              <p>Loại: <span className="font-medium">{pdfExportItem.payment_type}</span></p>
              <p>Số tiền: <span className="font-bold text-indigo-600">{formatVND(pdfExportItem.amount)}</span></p>
              <p>Kỳ: <span className="font-medium">{pdfExportItem.payment_period || pdfExportItem['kỳ thanh toán'] || '—'}</span></p>
            </div>
            <div className="border-t border-amber-100 pt-3">
              <label className="block text-sm font-bold text-amber-700 mb-1">Nợ kỳ trước (ghi đè)</label>
              <input
                id="input-pdf-debt-override"
                name="pdf_debt_override"
                type="number"
                value={pdfDebtOverride}
                onChange={e => setPdfDebtOverride(Number(e.target.value) || 0)}
                step="1000" inputMode="numeric"
                className="w-full border-2 border-amber-200 bg-amber-50/30 rounded-xl px-3 py-2.5 text-sm text-amber-800 font-medium focus:ring-2 focus:ring-amber-400 focus:border-amber-400 focus:outline-none"
                placeholder="0"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">Giá trị này sẽ được lưu và sử dụng trong PDF. Có thể để trống nếu không có nợ.</p>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <label className="block text-sm font-bold text-indigo-700 mb-1">Ngày đến hạn</label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <DatePickerInput value={pdfDueDate} onChange={setPdfDueDate} />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">Chọn ngày đến hạn hiển thị trên PDF. Mặc định: hôm nay + {data?.settings?.DUE_DAYS || 5} ngày.</p>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setPdfExportItem(null)}
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
                Hủy
              </button>
              <button onClick={handlePdfExportConfirm} disabled={exportingId === pdfExportItem?.id}
                className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm shadow-amber-100">
                {exportingId === pdfExportItem?.id ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                Xuất PDF
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk Transfer Modal */}
      <Modal open={bulkTransferOpen} onClose={() => setBulkTransferOpen(false)} title={`Chuyển ${selectedIds.length} khoản thu cho Chủ nhà`} maxWidth="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Bạn đang chuyển <span className="font-bold text-indigo-600">{selectedIds.length} khoản thu</span> với tổng số tiền <span className="font-bold text-indigo-600">{formatVND(bulkTransferAmount)}</span>.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền thực nhận<RequiredStar /></label>
            <div className="relative">
              <input id="input-bulk-amount" name="bulk_amount" type="number" value={bulkTransferAmount} onChange={e => setBulkTransferAmount(Number(e.target.value) || 0)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-indigo-600 focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
              <div className="absolute right-3 top-2 text-[10px] text-slate-400 uppercase font-bold pointer-events-none">VND</div>
            </div>
            {bulkTransferAmount > 0 && <p className="text-[10px] text-indigo-500 mt-1 font-medium">{formatVND(bulkTransferAmount)}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
            <select id="select-bulk-receiver" value={bulkTransferReceiver} onChange={e => setBulkTransferReceiver(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              {receivers.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu tiền</label>
            <div className="flex items-center gap-2">
              {bulkTransferDate === todayStr() ? (
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600">Hôm nay</div>
              ) : (
                <div className="flex-1"><DatePickerInput value={bulkTransferDate} onChange={setBulkTransferDate} /></div>
              )}
              {bulkTransferDate === todayStr() && (
                <button onClick={() => setBulkTransferDate('')} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Chọn ngày khác</button>
              )}
              {bulkTransferDate !== todayStr() && (
                <button onClick={() => setBulkTransferDate(todayStr())} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Chọn hôm nay</button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phương thức<RequiredStar /></label>
            <select id="select-bulk-method" value={bulkTransferMethod} onChange={e => setBulkTransferMethod(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              <option value="Tiền mặt">Tiền mặt</option>
              <option value="Chuyển khoản">Chuyển khoản</option>
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setBulkTransferOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Hủy</button>
            <button onClick={handleDoBulkTransfer} disabled={bulkActing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-xl text-sm font-medium transition-all shadow-md shadow-emerald-100 disabled:opacity-50 flex items-center gap-2">
              {bulkActing && <Loader2 size={16} className="animate-spin" />}
              Xác nhận chuyển
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} title="Xóa thanh toán" message="Bạn có chắc chắn muốn xóa khoản thanh toán này? Hành động này không thể hoàn tác."
        confirmLabel="Xóa" onConfirm={handleDelete} onClose={() => setDeleteId(null)} loading={deleting} />
    </div>
  );
}
