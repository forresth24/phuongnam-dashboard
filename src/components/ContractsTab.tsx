import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Archive, Loader2, FileDown, ArrowUpDown, ChevronUp, ChevronDown, RefreshCw, ScrollText, MoreVertical } from 'lucide-react';
import { API, downloadBase64Pdf } from '../lib/api';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DatePickerInput } from './ui/DatePickerInput';
import { getContractMonthRange } from '../lib/settings-helpers';
import { roundUp1k } from '../lib/payment-utils';
import { getContractFullTenantName, getContractTenantPhone } from '../lib/tenant-utils';

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
  tenants_details: string;
  move_in_date: string;
  start_date: string;
  start_date_mode: string;
  duration: number;
  rent: number;
  deposit_paid: number;
  start_electric: number;
  discount: number;
  extra_person_fee: number;
  note: string;
  end_date: string;
  tenant_id: string;
}
const makeEmptyForm = (): ContractForm => ({
  room_id: '', tenant: '', phone: '', cccd: '', people_count: 1, tenants_details: '',
  move_in_date: todayStr(), start_date: '', start_date_mode: 'first_of_month', duration: 3, rent: 0, deposit_paid: 0,
  start_electric: 0, discount: 0, extra_person_fee: 0, note: '', end_date: '', tenant_id: '',
});

interface FieldError {
  room_id?: string;
  tenant?: string;
  phone?: string;
  cccd?: string;
}

export function ContractsTab({ config, data, loading, role, onRefresh }: Props) {
  const [filter, setFilter] = useState<'active' | 'ended' | 'all'>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState<ContractForm>(makeEmptyForm());
  const [errors, setErrors] = useState<FieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [forfeitDeposit, setForfeitDeposit] = useState(false);
  const [acting, setActing] = useState(false);
  const [finalElectricReading, setFinalElectricReading] = useState<string>('');
  const [moveOutElectricReading, setMoveOutElectricReading] = useState<string>('');
  const [debtTotal, setDebtTotal] = useState<string>('');
  const [cleaningFee, setCleaningFee] = useState<string>('');
  const [stayedDays, setStayedDays] = useState<number>(30);
  const [showCalcBreakdown, setShowCalcBreakdown] = useState(false);
  const [calculatedConsumption, setCalculatedConsumption] = useState(0);
  const [calculatedElectricCost, setCalculatedElectricCost] = useState(0);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [terminationContract, setTerminationContract] = useState<any>(null);
  const [moreMenuId, setMoreMenuId] = useState<string | null>(null);

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('room_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Sub-contract member selection modal state
  const [subContractModalOpen, setSubContractModalOpen] = useState(false);
  const [subContractActiveContract, setSubContractActiveContract] = useState<any>(null);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);

  // Sign date modal state
  const [signDateModal, setSignDateModal] = useState<{
    type: 'contract' | 'sub_contract' | 'extension';
    contractId?: string;
    subContractTenants?: string[];
  } | null>(null);
  const [signDateOption, setSignDateOption] = useState<'today' | 'custom' | 'blank'>('today');
  const [signDateCustom, setSignDateCustom] = useState('');
  const [signDateConfirming, setSignDateConfirming] = useState(false);
  const [extensionDuration, setExtensionDuration] = useState<number>(3);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';

  // Lookup helpers for tenant data via tenant_id
  // (uses shared helpers from tenant-utils.ts)

  const rawContracts = filter === 'active' ? data.contracts : (filter === 'ended' ? data.contracts_all.filter((c: any) => c.status !== 'active') : data.contracts_all);
  const { min: minMonths, max: maxMonths } = getContractMonthRange(data.settings);

  const sortedContracts = [...rawContracts].sort((a, b) => {
    let valA = a[sortBy], valB = b[sortBy];
    if (sortBy === 'rent' || sortBy === 'deposit_paid' || sortBy === 'people_count' || sortBy === 'duration') {
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

  const displayRange = (start: string, end: string, duration?: number) => {
    if (!start || !end) return `${start || '—'} → ${end || '—'}`;
    const prefix = duration ? `${duration} tháng (` : '';
    const suffix = duration ? ')' : '';
    return `${prefix}${start} → ${end}${suffix}`;
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

    // Find tenant from tenant_id
    const t = c.tenant_id ? data.tenants.find((t: any) => t.id === c.tenant_id) : null;
    const tenantName = t ? t.name : (c.tenant || '');
    const tenantPhone = t ? t.phone : (c.phone || '');
    const tenantCccd = t ? t.cccd : '';

    setEditItem(c);
    setForm({
      room_id: String(c.room_id || ''), tenant: tenantName, phone: tenantPhone, cccd: tenantCccd,
      people_count: c.people_count || 1, tenants_details: c.tenants_details || '',
      move_in_date: String(c.move_in_date || c.start_date || ''), start_date: String(c.start_date || ''), start_date_mode: 'first_of_month', duration: durationMonths,
      rent: c.rent || 0, deposit_paid: c.deposit_paid || 0, start_electric: c.start_electric || 0,
      discount: c.discount || 0, extra_person_fee: c.extra_person_fee || 0, note: String(c.note || ''), end_date: c.end_date || '',
      tenant_id: String(c.tenant_id || ''),
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
    if (roomType === 'phòng đơn' && peopleCount > 1) epf = roundUp1k((Number(settings.EXTRA_FEE_SINGLE) || 0) * (peopleCount - 1));
    else if (roomType === 'phòng đôi' && peopleCount > 2) epf = roundUp1k((Number(settings.EXTRA_FEE_DOUBLE) || 0) * (peopleCount - 2));
    setForm({ ...form, room_id: roomId, rent: price, deposit_paid: 0, extra_person_fee: epf });
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
          deposit_paid: form.deposit_paid, 
          people_count: Math.max(1, Number(form.people_count) || 1),
          extra_person_fee: form.extra_person_fee 
        };
        await API.updateContract(config, editItem.id, payload);
      } else {
        await API.createContract(config, { ...form, deposit_paid: form.deposit_paid, people_count: Math.max(1, Number(form.people_count) || 1), extra_person_fee: form.extra_person_fee });
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
    try {
      await API.endContract(config, archiveId, {
        forfeitDeposit,
        final_electric_reading: moveOutElectricReading || undefined,
      });

      if (!forfeitDeposit) {
        const contract = (data?.contracts_all || data?.contracts || []).find((c: any) => c.id === archiveId);
        if (contract) {
          const depositAmount = Number(contract.deposit_paid) || 0;
          const baselineReading = finalElectricReading ? Number(finalElectricReading) : NaN;
          const moveOutReading = moveOutElectricReading ? Number(moveOutElectricReading) : NaN;
          const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
          const debt = Number(debtTotal) || 0;
          const cleaning = Number(cleaningFee) || 0;
          const fullRent = Number(contract.rent) || 0;
          const ds = stayedDays;
          const discount = Number(contract.discount) || 0;
          const peopleCount = Number(contract.people_count) || 1;
          const proratedRent = roundUp1k(fullRent / 30 * ds);
          const proratedWater = roundUp1k((Number(data?.settings?.WATER_PRICE_PER_PERSON) || 0) * peopleCount / 30 * ds);
          const monthlySurcharge = Math.max(0, (Number(data?.settings?.SURCHARGE_PER_PERSON) || 0) * peopleCount - discount);
          const proratedService = roundUp1k(monthlySurcharge / 30 * ds);

          let note = `Trả cọc - Phòng ${contract.room_id} - ${getContractFullTenantName(contract, data.tenants)}`;
          let electricCost = 0;

          if (!isNaN(moveOutReading) && !isNaN(baselineReading) && moveOutReading > baselineReading) {
            const consumption = moveOutReading - baselineReading;
            electricCost = consumption * electricPrice;
            note += ` (Điện: ${moveOutReading} - ${baselineReading} = ${consumption}kWh x ${formatVND(electricPrice, false)} = ${formatVND(electricCost, false)})`;
          }

          const refundAmount = Math.max(0, depositAmount - proratedRent - proratedWater - proratedService - debt - cleaning - electricCost);

          if (refundAmount > 0) {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            await API.createPayable(config, {
              contract_id: contract.id,
              room_id: contract.room_id,
              tenant: getContractFullTenantName(contract, data.tenants),
              amount: refundAmount,
              status: 'pending',
              payable_type: 'Trả cọc',
              contract_ended_at: `${dd}/${mm}/${yyyy}`,
              note,
            });
          }
        }
      }

      setArchiveId(null);
      setForfeitDeposit(false);
      setFinalElectricReading('');
      setMoveOutElectricReading('');
      setStayedDays(30);
      setShowCalcBreakdown(false);
      onRefresh();
    }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(false);
  };

  const handleTerminationPdf = async (contract: any) => {
    setPdfLoading(`termination_${contract.id}`);
    try {
      const deposit = Number(contract.deposit_paid) || 0;
      const baselineReading = finalElectricReading ? Number(finalElectricReading) : NaN;
      const moveOutReading = moveOutElectricReading ? Number(moveOutElectricReading) : NaN;
      const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
      const debt = Number(debtTotal) || 0;
      const cleaning = Number(cleaningFee) || 0;
      const fullRent = Number(contract.rent) || 0;
      const daysStayed = stayedDays;
      const discount = Number(contract.discount) || 0;
      const peopleCount = Number(contract.people_count) || 1;

      let refundAmount = deposit;
      let consumption = 0;
      let electricCost = 0;
      const proratedRent = roundUp1k(fullRent / 30 * daysStayed);
      const proratedWater = roundUp1k((Number(data?.settings?.WATER_PRICE_PER_PERSON) || 0) * peopleCount / 30 * daysStayed);
      const monthlySurcharge = Math.max(0, (Number(data?.settings?.SURCHARGE_PER_PERSON) || 0) * peopleCount - discount);
      const proratedService = roundUp1k(monthlySurcharge / 30 * daysStayed);
      let totalDeductions = debt + cleaning + proratedRent + proratedWater + proratedService;

      if (!isNaN(moveOutReading) && !isNaN(baselineReading) && moveOutReading > baselineReading) {
        consumption = moveOutReading - baselineReading;
        electricCost = consumption * electricPrice;
        totalDeductions += electricCost;
      }
      refundAmount = Math.max(0, deposit - totalDeductions);

      const res = await API.getTerminationPdf(config, contract.id, {
        final_electric_reading: !isNaN(moveOutReading) ? moveOutReading : undefined,
        electric_consumption: consumption || undefined,
        electric_cost: electricCost || undefined,
        electric_price: electricPrice,
        refund_amount: refundAmount,
        debt_total: debt || undefined,
        cleaning_fee: cleaning || undefined,
        water_fee: proratedWater || undefined,
        service_fee: proratedService || undefined,
        stayed_days: daysStayed,
        full_rent: fullRent || undefined,
        prorated_rent: proratedRent || undefined,
      });

      if (res) {
        downloadBase64Pdf(res.base64, res.filename);
        if (res.corrections && Object.keys(res.corrections).length > 0) {
          const msgs: string[] = [];
          if (res.corrections.electric_consumption !== undefined) msgs.push(`Số điện tiêu thụ: ${res.corrections.electric_consumption} kWh`);
          if (res.corrections.electric_cost !== undefined) msgs.push(`Tiền điện: ${formatVND(res.corrections.electric_cost)}`);
          if (res.corrections.water_fee !== undefined) msgs.push(`Tiền nước: ${formatVND(res.corrections.water_fee)} (có thể do khác biệt số khách/chiết khấu)`);
          if (res.corrections.service_fee !== undefined) msgs.push(`Phí dịch vụ: ${formatVND(res.corrections.service_fee)} (có thể do khác biệt số khách/chiết khấu)`);
          if (msgs.length > 0) alert('⚠️ Hệ thống đã tự động điều chỉnh số liệu (khác với dashboard gửi lên):\n' + msgs.join('\n'));
        }
      }
    } catch (e: any) { alert('Lỗi tạo PDF Biên bản thanh lý: ' + e.message); }
    setPdfLoading(null);
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      await API.restoreContract(config, id);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi khôi phục hợp đồng: ' + e.message);
    }
    setRestoringId(null);
  };

  const handleExportSubContracts = async () => {
    if (!subContractActiveContract || selectedTenants.length === 0) return;
    // Show sign date modal before proceeding
    setSignDateOption('today');
    setSignDateCustom('');
    setSignDateConfirming(false);
    setSignDateModal({ type: 'sub_contract', contractId: subContractActiveContract.id });
  };

  const doExportSubContracts = async (signDate?: string) => {
    if (!subContractActiveContract || selectedTenants.length === 0) return;

    setPdfLoading(`sub_contract_${subContractActiveContract.id}`);
    setSignDateConfirming(true);

    try {
      const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(subContractActiveContract.room_id).trim());

      const items = roomTenants.length > 0 ? roomTenants : [
        {
          id: 'representative',
          name: subContractActiveContract.tenant,
          phone: subContractActiveContract.phone || 'N/A',
          cccd: subContractActiveContract.cccd || 'N/A'
        }
      ];

      for (const tenantId of selectedTenants) {
        const t = items.find((item: any) => item.id === tenantId);
        const tName = t ? t.name : subContractActiveContract.tenant;

        let res;
        if (tenantId === 'representative') {
          res = await API.getSubContractPdf(config, subContractActiveContract.id, undefined, signDate);
        } else {
          res = await API.getSubContractPdf(config, subContractActiveContract.id, tenantId, signDate);
        }

        if (res) {
          const cleanName = tName ? tName.trim().replace(/\s+/g, '_') : 'ThanhVien';
          const filename = `HopDongPhu_${subContractActiveContract.room_id}_${cleanName}.pdf`;
          downloadBase64Pdf(res.base64, filename);
        }
      }
      setSubContractModalOpen(false);
    } catch (e: any) {
      alert('Lỗi tạo PDF HĐ Phụ: ' + e.message);
    }

    setPdfLoading(null);
    setSignDateModal(null);
    setSignDateConfirming(false);
  };

  const doGenerateContractPdf = async (signDate?: string) => {
    if (!signDateModal?.contractId) return;
    setPdfLoading(`contract_${signDateModal.contractId}`);
    setSignDateConfirming(true);
    try {
      const res = await API.getContractPdf(config, signDateModal.contractId, signDate);
      if (res) downloadBase64Pdf(res.base64, res.filename);
    } catch (e: any) { alert('Lỗi tạo PDF: ' + e.message); }
    setPdfLoading(null);
    setSignDateModal(null);
    setSignDateConfirming(false);
  };

  const doGenerateExtensionPdf = async (signDate?: string) => {
    if (!signDateModal?.contractId) return;
    setPdfLoading(`extension_${signDateModal.contractId}`);
    setSignDateConfirming(true);
    try {
      const res = await API.getExtensionPdf(config, signDateModal.contractId, extensionDuration, signDate);
      if (res) downloadBase64Pdf(res.base64, res.filename);
    } catch (e: any) { alert('Lỗi tạo PDF Phụ lục gia hạn: ' + e.message); }
    setPdfLoading(null);
    setSignDateModal(null);
    setSignDateConfirming(false);
  };

  const handlePdfSignDateConfirm = async () => {
    if (!signDateModal) return;
    let signDate: string | undefined;
    if (signDateOption === 'custom' && signDateCustom) {
      signDate = signDateCustom; // YYYY-MM-DD from input type="date"
    } else if (signDateOption === 'blank') {
      signDate = 'blank';
    }
    if (signDateModal.type === 'contract') {
      await doGenerateContractPdf(signDate);
    } else if (signDateModal.type === 'sub_contract') {
      await doExportSubContracts(signDate);
    } else if (signDateModal.type === 'extension') {
      await doGenerateExtensionPdf(signDate);
    }
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
            <button onClick={() => setFilter('ended')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'ended' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Đã kết thúc</button>
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
                <th onClick={() => toggleSort('deposit_paid')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Cọc <SortIcon col="deposit_paid" /></div></th>
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
                  <td className="px-4 py-3">{getContractFullTenantName(c, data.tenants)}</td>
                  <td className="px-4 py-3 text-slate-500">{getContractTenantPhone(c, data.tenants)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{displayRange(c.start_date, c.end_date, c.duration)}</td>
                  <td className="px-4 py-3 font-medium text-indigo-600">{formatVND(c.rent)}</td>
                  <td className="px-4 py-3">{formatVND(c.deposit_paid || 0)}</td>
                  <td className="px-4 py-3"><Badge variant={c.status === 'active' ? 'success' : 'neutral'}>{c.status === 'active' ? 'Đang hoạt động' : 'Đã kết thúc'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 items-center">
                        <div className="relative">
                          <button onClick={(e) => { e.stopPropagation(); setMoreMenuId(moreMenuId === c.id ? null : c.id); }}
                            title="Xuất PDF" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600">
                            <MoreVertical size={14} />
                          </button>
                          {moreMenuId === c.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setMoreMenuId(null)} />
                              <div className="absolute left-0 top-full z-50 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px]">
                                <button onClick={() => { setMoreMenuId(null); setSignDateOption('today'); setSignDateCustom(''); setSignDateModal({ type: 'contract', contractId: c.id }); }}
                                  disabled={pdfLoading === `contract_${c.id}`}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-left">
                                  <FileDown size={13} className="text-blue-500" /> PDF Hợp đồng
                                </button>
                                <button onClick={() => { setMoreMenuId(null); const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(c.room_id).trim()); setSubContractActiveContract(c); setSelectedTenants(roomTenants.length > 0 ? roomTenants.map((t: any) => t.id) : ['representative']); setSubContractModalOpen(true); }}
                                  disabled={pdfLoading !== null}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-left">
                                  <FileDown size={13} className="text-emerald-500" /> PDF HĐ Phụ
                                </button>
                                <button onClick={() => { setMoreMenuId(null); setExtensionDuration(Number(c.duration) || 3); setSignDateOption('today'); setSignDateCustom(''); setSignDateModal({ type: 'extension', contractId: c.id }); }}
                                  disabled={pdfLoading === `extension_${c.id}`}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-left">
                                  <FileDown size={13} className="text-amber-500" /> PDF Phụ lục gia hạn
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        {isAdmin && c.status !== 'active' && (
                          <button onClick={() => {
                            const contractPayments = (data.payments || []).filter(
                              (p: any) => String(p.contract_id).trim() === String(c.id).trim()
                            );
                            let defaultReading = '';
                            if (contractPayments.length > 0) {
                              const sorted = [...contractPayments].sort((a, b) => {
                                const da = (a.received_date || a.date || '').split('/');
                                const db = (b.received_date || b.date || '').split('/');
                                return (Number(db[2]) - Number(da[2])) || (Number(db[1]) - Number(da[1])) || (Number(db[0]) - Number(da[0]));
                              });
                              const lastWithReading = sorted.find((p: any) =>
                                p.new_electric !== undefined && p.new_electric !== null && p.new_electric !== '' && !isNaN(Number(p.new_electric))
                              );
                              if (lastWithReading) {
                                defaultReading = String(lastWithReading.new_electric);
                              }
                            }
                            setFinalElectricReading(defaultReading);
                            setMoveOutElectricReading('');
                            setDebtTotal('');
                            setCleaningFee('');
                            setStayedDays(30);
                            setShowCalcBreakdown(false);
                            setTerminationContract(c);
                          }} title="Xuất biên bản thanh lý"
                            className="p-1.5 rounded-lg hover:bg-violet-50 text-slate-400 hover:text-violet-600">
                            <ScrollText size={14} />
                          </button>
                        )}
                        {isAdmin && <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>}
                        {isAdmin && c.status === 'active' && <button onClick={() => {
                          const contractPayments = (data.payments || []).filter(
                            (p: any) => String(p.contract_id).trim() === String(c.id).trim()
                          );
                          let defaultReading = '';
                          if (contractPayments.length > 0) {
                            const sorted = [...contractPayments].sort((a, b) => {
                              const da = (a.received_date || a.date || '').split('/');
                              const db = (b.received_date || b.date || '').split('/');
                              return (Number(db[2]) - Number(da[2])) || (Number(db[1]) - Number(da[1])) || (Number(db[0]) - Number(da[0]));
                            });
                            const lastWithReading = sorted.find((p: any) =>
                              p.new_electric !== undefined && p.new_electric !== null && p.new_electric !== '' && !isNaN(Number(p.new_electric))
                            );
                            if (lastWithReading) {
                              defaultReading = String(lastWithReading.new_electric);
                            }
                          }
                          setArchiveId(c.id);
                          setForfeitDeposit(false);
                          setFinalElectricReading(defaultReading);
                          setMoveOutElectricReading('');
                          setDebtTotal('');
                          setCleaningFee('');
                          setStayedDays(30);
                          setShowCalcBreakdown(false);
                        }} title="Kết thúc & Archive" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600"><Archive size={14} /></button>}
                        {isAdmin && <button onClick={() => setDeleteId(c.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
                        {isAdmin && c.status !== 'active' && (
                          <button onClick={() => handleRestore(c.id)} disabled={restoringId === c.id} title="Khôi phục hợp đồng"
                            className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 disabled:opacity-50"
                          >
                            {restoringId === c.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          </button>
                        )}
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
            <select id="select-contract-room" name="room_id" value={form.room_id} onChange={e => onRoomChange(e.target.value)} disabled={!!editItem}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50 ${errors.room_id ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
              <option value="">-- Chọn phòng --</option>
              {data.rooms.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.id}) - {formatVND(r.price)}
                </option>
              ))}
            </select>
            <FieldErr msg={errors.room_id} />
          </div>

          {/* Tenant Selection */}
          {(!editItem || (editItem && !editItem.tenant_id)) && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 mb-1">Chọn khách cũ (nếu có)</label>
              <select 
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none bg-slate-50"
                value={form.tenant_id}
                onChange={(e) => {
                  const tid = e.target.value;
                  if (!tid) {
                    setForm({ ...form, tenant_id: '', tenant: '', phone: '', cccd: '' });
                    return;
                  }
                  const t = data.tenants.find((i: any) => i.id === tid);
                  if (t) {
                    setForm({ ...form, tenant_id: tid, tenant: t.name || '', phone: t.phone || '', cccd: t.cccd || '' });
                  }
                }}
              >
                <option value="">-- Khách mới (Tự động tạo) --</option>
                {(data.tenants || []).map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} - {t.phone || 'N/A'} ({t.id})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1 italic">
                * Nếu là khách mới, hãy để trống ô này. Hệ thống sẽ tự động tạo hồ sơ khách thuê.
              </p>
            </div>
          )}

          {/* Tenant */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Khách đại diện<RequiredStar /></label>
            <input id="input-contract-tenant" name="tenant" value={form.tenant} onChange={e => F('tenant', e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.tenant ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.tenant} />
          </div>
          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số điện thoại</label>
            <input id="input-contract-phone" name="phone" value={form.phone} onChange={e => F('phone', e.target.value)} placeholder="0901234567" inputMode="tel"
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.phone} />
          </div>
          {/* CCCD */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số CCCD</label>
            <input id="input-contract-cccd" name="cccd" value={form.cccd} onChange={e => F('cccd', e.target.value)} placeholder="079123456789" inputMode="numeric"
              className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
            <FieldErr msg={errors.cccd} />
          </div>
          {/* People count */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số người ở</label>
            <input id="input-contract-people" name="people_count" type="number" value={form.people_count} onChange={e => F('people_count', e.target.value)} min={1} inputMode="numeric"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Tenants details - optional */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Thông tin khách (tên, CCCD, ...)</label>
            <textarea id="input-contract-tenants-details" name="tenants_details" value={form.tenants_details || ''} onChange={e => F('tenants_details', e.target.value)} rows={2} placeholder="Ví dụ: Nguyễn Văn A (CCCD: 079...), Trần Thị B (CCCD: 079...)"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Move-in date */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày vào ở (tính tiền HĐ mới)</label>
            <DatePickerInput id="input-contract-move-in" value={form.move_in_date} onChange={v => F('move_in_date', v)} />
          </div>
          {/* Start date mode */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày bắt đầu hợp đồng</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'first_of_month', label: 'Đầu tháng' },
                { value: 'move_in_date', label: 'Ngày vào ở' },
                { value: 'current_date', label: 'Ngày hiện tại' },
                { value: 'custom', label: 'Chọn ngày' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => setForm({ ...form, start_date_mode: opt.value, start_date: opt.value === 'custom' ? (form.start_date || form.move_in_date) : '' })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${form.start_date_mode === opt.value ? 'bg-indigo-100 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {form.start_date_mode === 'custom' && (
              <div className="mt-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Chọn ngày bắt đầu</label>
                <DatePickerInput id="input-contract-start-date" value={form.start_date} onChange={v => F('start_date', v)} />
              </div>
            )}
          </div>
          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn HĐ (tháng)</label>
            <input id="input-contract-duration" name="duration"
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
            <input id="input-contract-rent" name="rent" type="number" value={form.rent} onChange={e => F('rent', Number(e.target.value))}
              inputMode="numeric" step="1000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            {form.rent > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{formatVND(form.rent)}</p>}
          </div>
          {/* Electric */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số điện ban đầu</label>
            <input id="input-contract-electric" name="start_electric" type="number" value={form.start_electric} onChange={e => F('start_electric', Number(e.target.value))}
              inputMode="numeric"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Extra Person Fee */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phụ thu quá người/tháng</label>
            <input id="input-contract-extra-fee" name="extra_person_fee" type="number" value={form.extra_person_fee} onChange={e => F('extra_person_fee', Number(e.target.value))}
              inputMode="numeric" step="1000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Discount */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chiết khấu DV/tháng</label>
            <input id="input-contract-discount" name="discount" type="number" value={form.discount} onChange={e => F('discount', Number(e.target.value))}
              inputMode="numeric" step="1000"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          {/* Note */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea id="textarea-contract-note" name="note" value={form.note} onChange={e => F('note', e.target.value)} rows={2}
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
      <ConfirmDialog open={!!archiveId} onClose={() => setArchiveId(null)} onConfirm={handleArchive} loading={acting} title="Kết thúc & Archive" confirmLabel="Kết thúc HĐ" message="Kết thúc hợp đồng này? Hợp đồng sẽ được chuyển vào sheet archived_contracts. Thanh toán sẽ được giữ lại.">
        <div className="space-y-3">
          <label className="flex items-center justify-center gap-2 text-sm text-slate-700 bg-amber-50 p-3 rounded-lg border border-amber-200 cursor-pointer">
            <input type="checkbox" checked={forfeitDeposit} onChange={e => setForfeitDeposit(e.target.checked)} className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4" />
            <span className="font-medium text-amber-800">Khách bỏ cọc?</span>
          </label>
          {!forfeitDeposit && (
            <div className="space-y-2">
              {/* Prorated rent for early termination */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Số ngày ở thực tế tháng cuối</label>
                <input id="input-archive-stayed-days" type="number" min={0} max={31} value={stayedDays}
                  onChange={e => setStayedDays(e.target.value === "" ? 30 : Math.max(0, Math.min(31, Number(e.target.value))))}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              </div>
              {/* Baseline reading from payment — readonly display */}
              {finalElectricReading && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Chỉ số điện cuối (mốc)</label>
                  <p id="input-archive-electric-baseline" className="text-sm font-semibold text-slate-800">{finalElectricReading}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Từ payment gần nhất, tự động điền</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Chỉ số điện tính tới ngày trả phòng</label>
                <input id="input-archive-electric-moveout" type="number" value={moveOutElectricReading}
                  onChange={e => {
                    const v = e.target.value;
                    setMoveOutElectricReading(v);
                    const contract = (data?.contracts_all || data?.contracts || []).find((c: any) => c.id === archiveId);
                    if (contract && v && finalElectricReading) {
                      const baseline = Number(finalElectricReading);
                      const moveOut = Number(v);
                      const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;

                      let electricCost = 0;
                      if (!isNaN(moveOut) && !isNaN(baseline) && moveOut > baseline) {
                        const consumption = moveOut - baseline;
                        electricCost = consumption * electricPrice;
                        setCalculatedConsumption(consumption);
                        setCalculatedElectricCost(electricCost);
                      } else {
                        setCalculatedConsumption(0);
                        setCalculatedElectricCost(0);
                      }
                      setShowCalcBreakdown(true);
                    } else {
                      setShowCalcBreakdown(false);
                    }
                  }}
                  placeholder="Nhập chỉ số điện thực tế"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nợ kỳ trước (nếu có)</label>
                  <input id="input-archive-debt"
                    type="number"
                    value={debtTotal}
                    onChange={e => setDebtTotal(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Phí vệ sinh (nếu có)</label>
                  <input id="input-archive-cleaning"
                    type="number"
                    value={cleaningFee}
                    onChange={e => setCleaningFee(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              {showCalcBreakdown && archiveId && (() => {
                const contract = (data?.contracts_all || data?.contracts || []).find((c: any) => c.id === archiveId);
                const depositPaid = Number(contract?.deposit_paid) || 0;
                const fullRent = Number(contract?.rent) || 0;
                const ds = stayedDays;
                const proratedRent = roundUp1k(fullRent / 30 * ds);
                const debtAmt = Number(debtTotal) || 0;
                const cleaningAmt = Number(cleaningFee) || 0;
                const discount = Number(contract?.discount) || 0;
                const peopleCount = Number(contract?.people_count) || 1;
                const monthlySurcharge = Math.max(0, (Number(data?.settings?.SURCHARGE_PER_PERSON) || 0) * peopleCount - discount);
                const proratedWater = roundUp1k((Number(data?.settings?.WATER_PRICE_PER_PERSON) || 0) * peopleCount / 30 * ds);
                const proratedService = roundUp1k(monthlySurcharge / 30 * ds);
                const refundAmount = Math.max(0, depositPaid - proratedRent - proratedWater - proratedService - calculatedElectricCost - debtAmt - cleaningAmt);
                return (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs space-y-1">
                    <p className="flex justify-between text-slate-700 font-medium">Số tiền đã cọc:<span>{formatVND(depositPaid)}</span></p>
                    {proratedRent > 0 && (
                      <p className="flex justify-between text-slate-600">Tiền phòng {ds} ngày:<span className="text-rose-600">-{formatVND(proratedRent)}</span></p>
                    )}
                    {proratedWater > 0 && <p className="flex justify-between text-slate-600">Tiền nước {ds} ngày:<span className="text-rose-600">-{formatVND(proratedWater)}</span></p>}
                    {proratedService > 0 && <p className="flex justify-between text-slate-600">Phí dịch vụ {ds} ngày (chiết khấu -{formatVND(discount)}/tháng):<span className="text-rose-600">-{formatVND(proratedService)}</span></p>}
                    {calculatedElectricCost > 0 && (
                      <>
                        <p className="text-slate-700">Điện tiêu thụ: {calculatedConsumption} kWh</p>
                        <p className="flex justify-between text-slate-600">Tiền điện:<span className="text-rose-600">-{formatVND(calculatedElectricCost)}</span></p>
                      </>
                    )}
                    {debtAmt > 0 && <p className="flex justify-between text-slate-600">Nợ kỳ trước:<span className="text-rose-600">-{formatVND(debtAmt)}</span></p>}
                    {cleaningAmt > 0 && <p className="flex justify-between text-slate-600">Phí vệ sinh:<span className="text-rose-600">-{formatVND(cleaningAmt)}</span></p>}
                    <p className="text-blue-800 font-semibold text-sm">Tiền cọc còn lại: {formatVND(refundAmount)}</p>
                  </div>
                );
              })()}
              {/* PDF Termination button inside archive popup */}
              {!forfeitDeposit && archiveId && (() => {
                const c = (data?.contracts_all || data?.contracts || []).find((cc: any) => cc.id === archiveId);
                return c ? (
                  <button onClick={() => handleTerminationPdf(c)}
                    disabled={pdfLoading === `termination_${archiveId}`}
                    className="w-full bg-violet-600 hover:bg-violet-700 text-white py-2 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
                    {pdfLoading === `termination_${archiveId}` ? <Loader2 size={16} className="animate-spin" /> : <ScrollText size={16} />}
                    Xuất Biên bản thanh lý (PDF)
                  </button>
                ) : null;
              })()}
              <p className="text-xs text-slate-400">Để trống nếu trả đủ tiền cọc và không có khoản trừ khác.</p>
            </div>
          )}
          {forfeitDeposit && (
            <p className="text-xs text-amber-600/80">Ghi chú "Khách bỏ cọc" vào hợp đồng và thanh toán.</p>
          )}
        </div>
      </ConfirmDialog>


      {/* Termination PDF popup for ended contracts */}
      <Modal open={!!terminationContract} onClose={() => setTerminationContract(null)} title={`Xuất Biên bản thanh lý — Phòng ${terminationContract?.room_id || ''}`} maxWidth="max-w-md">
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Số ngày ở thực tế tháng cuối</label>
            <input type="number" min={0} max={31} value={stayedDays}
              onChange={e => setStayedDays(e.target.value === "" ? 30 : Math.max(0, Math.min(31, Number(e.target.value))))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          {finalElectricReading && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Chỉ số điện cuối (mốc)</label>
              <p className="text-sm font-semibold text-slate-800">{finalElectricReading}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Từ payment gần nhất, tự động điền</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chỉ số điện tính tới ngày trả phòng</label>
            <input type="number" value={moveOutElectricReading}
              onChange={e => {
                const v = e.target.value;
                setMoveOutElectricReading(v);
                const contract = terminationContract;
                if (contract && v && finalElectricReading) {
                  const baseline = Number(finalElectricReading);
                  const moveOut = Number(v);
                  const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
                  let electricCost = 0;
                  if (!isNaN(moveOut) && !isNaN(baseline) && moveOut > baseline) {
                    const consumption = moveOut - baseline;
                    electricCost = consumption * electricPrice;
                    setCalculatedConsumption(consumption);
                    setCalculatedElectricCost(electricCost);
                  } else {
                    setCalculatedConsumption(0);
                    setCalculatedElectricCost(0);
                  }
                  setShowCalcBreakdown(true);
                } else {
                  setShowCalcBreakdown(false);
                }
              }}
              placeholder="Nhập chỉ số điện thực tế"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nợ kỳ trước (nếu có)</label>
              <input type="number" value={debtTotal} onChange={e => setDebtTotal(e.target.value)} placeholder="0"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phí vệ sinh (nếu có)</label>
              <input type="number" value={cleaningFee} onChange={e => setCleaningFee(e.target.value)} placeholder="0"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </div>
          {showCalcBreakdown && terminationContract && (() => {
            const contract = terminationContract;
            const depositPaid = Number(contract?.deposit_paid) || 0;
            const fullRent = Number(contract?.rent) || 0;
            const ds = stayedDays;
            const proratedRent = roundUp1k(fullRent / 30 * ds);
            const debtAmt = Number(debtTotal) || 0;
            const cleaningAmt = Number(cleaningFee) || 0;
            const discount = Number(contract?.discount) || 0;
            const peopleCount = Number(contract?.people_count) || 1;
            const monthlySurcharge = Math.max(0, (Number(data?.settings?.SURCHARGE_PER_PERSON) || 0) * peopleCount - discount);
            const proratedWater = roundUp1k((Number(data?.settings?.WATER_PRICE_PER_PERSON) || 0) * peopleCount / 30 * ds);
            const proratedService = roundUp1k(monthlySurcharge / 30 * ds);
            const refundAmount = Math.max(0, depositPaid - proratedRent - proratedWater - proratedService - calculatedElectricCost - debtAmt - cleaningAmt);
            return (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs space-y-1">
                <p className="flex justify-between text-slate-700 font-medium">Số tiền đã cọc:<span>{formatVND(depositPaid)}</span></p>
                {proratedRent > 0 && <p className="flex justify-between text-slate-600">Tiền phòng {ds} ngày:<span className="text-rose-600">-{formatVND(proratedRent)}</span></p>}
                {proratedWater > 0 && <p className="flex justify-between text-slate-600">Tiền nước {ds} ngày:<span className="text-rose-600">-{formatVND(proratedWater)}</span></p>}
                {proratedService > 0 && <p className="flex justify-between text-slate-600">Phí dịch vụ {ds} ngày (chiết khấu -{formatVND(discount)}/tháng):<span className="text-rose-600">-{formatVND(proratedService)}</span></p>}
                {calculatedElectricCost > 0 && (
                  <>
                    <p className="text-slate-700">Điện tiêu thụ: {calculatedConsumption} kWh</p>
                    <p className="flex justify-between text-slate-600">Tiền điện:<span className="text-rose-600">-{formatVND(calculatedElectricCost)}</span></p>
                  </>
                )}
                {debtAmt > 0 && <p className="flex justify-between text-slate-600">Nợ kỳ trước:<span className="text-rose-600">-{formatVND(debtAmt)}</span></p>}
                {cleaningAmt > 0 && <p className="flex justify-between text-slate-600">Phí vệ sinh:<span className="text-rose-600">-{formatVND(cleaningAmt)}</span></p>}
                <p className="text-blue-800 font-semibold text-sm">Tiền cọc còn lại: {formatVND(refundAmount)}</p>
              </div>
            );
          })()}
          <button onClick={() => { if (terminationContract) handleTerminationPdf(terminationContract); }}
            disabled={pdfLoading === `termination_${terminationContract?.id}`}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
            {pdfLoading === `termination_${terminationContract?.id}` ? <Loader2 size={16} className="animate-spin" /> : <ScrollText size={16} />}
            Xuất Biên bản thanh lý (PDF)
          </button>
          <p className="text-xs text-slate-400">Để trống nếu trả đủ tiền cọc và không có khoản trừ khác.</p>
        </div>
      </Modal>


      {/* Sub-Contract Member Selection Modal */}
      <Modal 
        open={subContractModalOpen} 
        onClose={() => setSubContractModalOpen(false)} 
        title={`Xuất Hợp đồng phụ — Phòng ${subContractActiveContract?.room_id || ''}`} 
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Chọn thành viên để xuất hợp đồng phụ (mỗi người sẽ xuất thành 1 bản PDF riêng biệt):
          </p>

          {/* Member List */}
          <div className="border border-slate-100 rounded-xl divide-y divide-slate-100 overflow-hidden max-h-60 overflow-y-auto bg-slate-50/50">
            {subContractActiveContract && (() => {
              const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(subContractActiveContract.room_id).trim());
              
              const items = roomTenants.length > 0 ? roomTenants : [
                {
                  id: 'representative',
                  name: subContractActiveContract.tenant,
                  phone: subContractActiveContract.phone || 'N/A',
                  cccd: subContractActiveContract.cccd || 'N/A'
                }
              ];

              const allSelected = items.every(item => selectedTenants.includes(item.id));
              const someSelected = items.some(item => selectedTenants.includes(item.id)) && !allSelected;

              return (
                <>
                  {/* Select All Row */}
                  <div className="flex items-center px-4 py-3 bg-white font-medium text-xs text-slate-600">
                    <label className="flex items-center gap-3 cursor-pointer w-full select-none">
                      <input 
                        type="checkbox" 
                        checked={allSelected}
                        ref={el => {
                          if (el) el.indeterminate = someSelected;
                        }}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTenants(items.map(item => item.id));
                          } else {
                            setSelectedTenants([]);
                          }
                        }}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                      />
                      <span>Chọn tất cả ({items.length})</span>
                    </label>
                  </div>

                  {/* Individual Member Rows */}
                  {items.map((t: any) => {
                    const isSelected = selectedTenants.includes(t.id);
                    return (
                      <div key={t.id} className="flex items-center px-4 py-3 hover:bg-slate-50 bg-white transition-colors">
                        <label className="flex items-start gap-3 cursor-pointer w-full select-none">
                          <input 
                            type="checkbox" 
                            checked={isSelected}
                            onChange={() => {
                              if (isSelected) {
                                setSelectedTenants(selectedTenants.filter(id => id !== t.id));
                              } else {
                                setSelectedTenants([...selectedTenants, t.id]);
                              }
                            }}
                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 mt-0.5 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{t.name}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              SĐT: <span className="font-mono">{t.phone || 'N/A'}</span>
                              {t.cccd && <> • CCCD: <span className="font-mono">{t.cccd}</span></>}
                            </p>
                          </div>
                        </label>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button 
              onClick={() => setSubContractModalOpen(false)}
              className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 py-2.5 rounded-xl font-medium transition-colors text-sm"
            >
              Hủy
            </button>
            <button 
              onClick={handleExportSubContracts} 
              disabled={selectedTenants.length === 0 || pdfLoading !== null}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-sm shadow-emerald-100"
            >
              {pdfLoading !== null && <Loader2 size={16} className="animate-spin" />}
              Xuất PDF ({selectedTenants.length} bản)
            </button>
          </div>
        </div>
      </Modal>

      {/* Sign Date Modal */}
      <Modal
        open={signDateModal !== null}
        onClose={() => { if (!signDateConfirming) setSignDateModal(null); }}
        title="Chọn Ngày Ký"
        maxWidth="max-w-sm"
      >
        <div className="space-y-4">
          {signDateModal?.type === 'extension' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <label className="block text-sm font-medium text-amber-900 mb-2">Số tháng gia hạn</label>
              <input type="number" min={1} max={120} value={extensionDuration}
                onChange={e => setExtensionDuration(Math.max(1, Number(e.target.value) || 1))}
                className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
              <p className="text-xs text-amber-700 mt-1">Nhập số tháng gia hạn hợp đồng (mặc định theo thời hạn HĐ gốc)</p>
            </div>
          )}
          <p className="text-sm text-slate-500">Chọn ngày ký cho hợp đồng:</p>

          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${signDateOption === 'today' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="signDate" value="today" checked={signDateOption === 'today'} onChange={() => setSignDateOption('today')} className="mt-0.5 accent-indigo-600" />
            <div>
              <p className="text-sm font-medium text-slate-800">Ngày hiện tại</p>
              <p className="text-xs text-slate-400">Lấy ngày {new Date().getDate()} tháng {new Date().getMonth() + 1} năm {new Date().getFullYear()}</p>
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${signDateOption === 'custom' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="signDate" value="custom" checked={signDateOption === 'custom'} onChange={() => setSignDateOption('custom')} className="mt-0.5 accent-indigo-600" />
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">Chọn ngày bất kỳ</p>
              {signDateOption === 'custom' && (
                <input type="date" value={signDateCustom} onChange={(e) => setSignDateCustom(e.target.value)}
                  className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              )}
            </div>
          </label>

          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${signDateOption === 'blank' ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}>
            <input type="radio" name="signDate" value="blank" checked={signDateOption === 'blank'} onChange={() => setSignDateOption('blank')} className="mt-0.5 accent-indigo-600" />
            <div>
              <p className="text-sm font-medium text-slate-800">Để trống</p>
              <p className="text-xs text-slate-400">Ngày ký sẽ hiển thị "........"</p>
            </div>
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setSignDateModal(null)} disabled={signDateConfirming}
              className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-700 py-2.5 rounded-xl font-medium transition-colors text-sm">
              Hủy
            </button>
            <button onClick={handlePdfSignDateConfirm} disabled={signDateConfirming || (signDateOption === 'custom' && !signDateCustom)}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-sm shadow-indigo-100">
              {signDateConfirming ? <Loader2 size={16} className="animate-spin" /> : null}
              Xác nhận
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
