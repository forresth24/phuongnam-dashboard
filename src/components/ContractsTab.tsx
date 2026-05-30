import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Archive, Loader2, FileDown, FileText, ArrowUpDown, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
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
  room_id: '', tenant: '', phone: '', cccd: '', people_count: 1, children_count: 0,
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
  const [filter, setFilter] = useState<'active' | 'all'>('active');
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
  const [debtTotal, setDebtTotal] = useState<string>('');
  const [cleaningFee, setCleaningFee] = useState<string>('');
  const [showCalcBreakdown, setShowCalcBreakdown] = useState(false);
  const [calculatedConsumption, setCalculatedConsumption] = useState(0);
  const [calculatedElectricCost, setCalculatedElectricCost] = useState(0);
  const [calculatedRefund, setCalculatedRefund] = useState(0);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>('room_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Sub-contract member selection modal state
  const [subContractModalOpen, setSubContractModalOpen] = useState(false);
  const [subContractActiveContract, setSubContractActiveContract] = useState<any>(null);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const rawContracts = filter === 'active' ? data.contracts : data.contracts_all;
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
    if (roomType === 'phòng đơn' && peopleCount > 1) epf = roundUp10k((Number(settings.EXTRA_FEE_SINGLE) || 0) * (peopleCount - 1));
    else if (roomType === 'phòng đôi' && peopleCount > 2) epf = roundUp10k((Number(settings.EXTRA_FEE_DOUBLE) || 0) * (peopleCount - 2));
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
        final_electric_reading: finalElectricReading || undefined,
      });

      if (!forfeitDeposit) {
        const contract = (data?.contracts_all || data?.contracts || []).find((c: any) => c.id === archiveId);
        if (contract) {
          const depositAmount = Number(contract.deposit_paid) || 0;
          let refundAmount = depositAmount;
          let note = `Trả cọc - Phòng ${contract.room_id} - ${contract.tenant}`;

          if (finalElectricReading) {
            const startElectric = Number(contract.start_electric) || 0;
            const finalReading = Number(finalElectricReading);
            if (!isNaN(finalReading) && finalReading > startElectric) {
              const consumption = finalReading - startElectric;
              const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
              const electricCost = consumption * electricPrice;
              refundAmount = Math.max(0, depositAmount - electricCost);
              note += ` (Điện: ${finalReading} - ${startElectric} = ${consumption}kWh x ${formatVND(electricPrice, false)} = ${formatVND(electricCost, false)})`;
            }
          }

          if (refundAmount > 0) {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            await API.createPayable(config, {
              contract_id: contract.id,
              room_id: contract.room_id,
              tenant: contract.tenant,
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
      setShowCalcBreakdown(false);
      onRefresh();
    }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setActing(false);
  };

  const handlePdf = async (contractId: string, type: 'contract' | 'payment' | 'sub_contract') => {
    setPdfLoading(`${type}_${contractId}`);
    try {
      let res;
      if (type === 'contract') res = await API.getContractPdf(config, contractId);
      else if (type === 'payment') res = await API.getPaymentPdf(config, contractId);
      else if (type === 'sub_contract') res = await API.getSubContractPdf(config, contractId);
      
      if (res) downloadBase64Pdf(res.base64, res.filename);
    } catch (e: any) { alert('Lỗi tạo PDF: ' + e.message); }
    setPdfLoading(null);
  };

  const handleTerminationPdf = async (contract: any) => {
    setPdfLoading(`termination_${contract.id}`);
    try {
      const deposit = Number(contract.deposit_paid) || 0;
      const startElectric = Number(contract.start_electric) || 0;
      const finalReading = finalElectricReading ? Number(finalElectricReading) : NaN;
      const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
      const debt = Number(debtTotal) || 0;
      const cleaning = Number(cleaningFee) || 0;

      let consumption = 0;
      let electricCost = 0;
      let totalDeductions = debt + cleaning;
      let refundAmount = deposit;

      if (!isNaN(finalReading) && finalReading > startElectric) {
        consumption = finalReading - startElectric;
        electricCost = consumption * electricPrice;
        totalDeductions += electricCost;
        refundAmount = Math.max(0, deposit - electricCost);
      }
      refundAmount = Math.max(0, deposit - totalDeductions);

      const res = await API.getTerminationPdf(config, contract.id, {
        final_electric_reading: !isNaN(finalReading) ? finalReading : undefined,
        electric_consumption: consumption || undefined,
        electric_cost: electricCost || undefined,
        electric_price: electricPrice,
        refund_amount: refundAmount,
        debt_total: debt || undefined,
        cleaning_fee: cleaning || undefined,
      });

      if (res) downloadBase64Pdf(res.base64, res.filename);
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
    
    setPdfLoading(`sub_contract_${subContractActiveContract.id}`);
    
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
          res = await API.getSubContractPdf(config, subContractActiveContract.id);
        } else {
          res = await API.getSubContractPdf(config, subContractActiveContract.id, tenantId);
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
                  <td className="px-4 py-3">{c.tenant}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{displayRange(c.start_date, c.end_date)}</td>
                  <td className="px-4 py-3 font-medium text-indigo-600">{formatVND(c.rent)}</td>
                  <td className="px-4 py-3">{formatVND(c.deposit_paid || 0)}</td>
                  <td className="px-4 py-3"><Badge variant={c.status === 'active' ? 'success' : 'neutral'}>{c.status === 'active' ? 'Đang hoạt động' : 'Đã kết thúc'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => handlePdf(c.id, 'contract')} disabled={pdfLoading === `contract_${c.id}`}
                          title="Xuất PDF Hợp đồng" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 disabled:opacity-50">
                          {pdfLoading === `contract_${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                        </button>
                        <button 
                          onClick={() => {
                            const roomTenants = data.tenants.filter((t: any) => String(t.room_id).trim() === String(c.room_id).trim());
                            setSubContractActiveContract(c);
                            if (roomTenants.length > 0) {
                              setSelectedTenants(roomTenants.map((t: any) => t.id));
                            } else {
                              setSelectedTenants(['representative']);
                            }
                            setSubContractModalOpen(true);
                          }} 
                          disabled={pdfLoading !== null}
                          title="Xuất PDF HĐ Phụ" className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 disabled:opacity-50"
                        >
                          {pdfLoading === `sub_contract_${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                        </button>
                        {isAdmin && c.status === 'active' && <button onClick={() => handleTerminationPdf(c)} disabled={pdfLoading === `termination_${c.id}`} title="Biên bản thanh lý HĐ" className="p-1.5 rounded-lg hover:bg-violet-50 text-slate-400 hover:text-violet-600 disabled:opacity-50">{pdfLoading === `termination_${c.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}</button>}
                        {isAdmin && <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>}
                        {isAdmin && c.status === 'active' && <button onClick={() => { setArchiveId(c.id); setForfeitDeposit(false); setFinalElectricReading(''); setDebtTotal(''); setCleaningFee(''); setShowCalcBreakdown(false); }} title="Kết thúc & Archive" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600"><Archive size={14} /></button>}
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
            <select id="select-contract-room" value={form.room_id} onChange={e => onRoomChange(e.target.value)} disabled={!!editItem}
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
      <ConfirmDialog open={!!archiveId} onClose={() => setArchiveId(null)} onConfirm={handleArchive} loading={acting} title="Kết thúc & Archive" confirmLabel="Kết thúc HĐ" message="Kết thúc hợp đồng này? Hợp đồng sẽ được chuyển vào sheet archived_contracts. Thanh toán sẽ được giữ lại.">
        <div className="space-y-3">
          <label className="flex items-center justify-center gap-2 text-sm text-slate-700 bg-amber-50 p-3 rounded-lg border border-amber-200 cursor-pointer">
            <input type="checkbox" checked={forfeitDeposit} onChange={e => setForfeitDeposit(e.target.checked)} className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4" />
            <span className="font-medium text-amber-800">Khách bỏ cọc?</span>
          </label>
          {!forfeitDeposit && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Chỉ số điện cuối (nếu có)</label>
                <input
                  type="number"
                  value={finalElectricReading}
                  onChange={e => {
                    const v = e.target.value;
                    setFinalElectricReading(v);
                    const contract = (data?.contracts_all || data?.contracts || []).find((c: any) => c.id === archiveId);
                    if (contract && v) {
                      const startElectric = Number(contract.start_electric) || 0;
                      const finalReading = Number(v);
                      if (!isNaN(finalReading) && finalReading > startElectric) {
                        const consumption = finalReading - startElectric;
                        const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
                        const electricCost = consumption * electricPrice;
                        setCalculatedConsumption(consumption);
                        setCalculatedElectricCost(electricCost);
                        const debt = Number(debtTotal) || 0;
                        const cleaning = Number(cleaningFee) || 0;
                        setCalculatedRefund(Math.max(0, (Number(contract.deposit_paid) || 0) - electricCost - debt - cleaning));
                        setShowCalcBreakdown(true);
                      } else {
                        setShowCalcBreakdown(false);
                      }
                    } else {
                      setShowCalcBreakdown(false);
                    }
                  }}
                  placeholder="Nhập chỉ số điện mới"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nợ kỳ trước (nếu có)</label>
                  <input
                    type="number"
                    value={debtTotal}
                    onChange={e => setDebtTotal(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Phí vệ sinh (nếu có)</label>
                  <input
                    type="number"
                    value={cleaningFee}
                    onChange={e => setCleaningFee(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              {showCalcBreakdown && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs space-y-1">
                  <p className="text-slate-700">Điện tiêu thụ: {calculatedConsumption} kWh</p>
                  <p className="text-slate-700">Tiền điện: {formatVND(calculatedElectricCost)}</p>
                  <p className="text-blue-800 font-semibold text-sm">Tiền cọc còn lại: {formatVND(calculatedRefund)}</p>
                </div>
              )}
              <p className="text-xs text-slate-400">Để trống nếu trả đủ tiền cọc và không có khoản trừ khác.</p>
            </div>
          )}
          {forfeitDeposit && (
            <p className="text-xs text-amber-600/80">Ghi chú "Khách bỏ cọc" vào hợp đồng và thanh toán.</p>
          )}
        </div>
      </ConfirmDialog>

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
    </div>
  );
}
