import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Loader2, CheckCircle, XCircle, FileText, Pencil, Trash2 } from 'lucide-react';
import { API, downloadBase64Pdf } from '../lib/api';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { Badge } from './ui/Badge';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Modal } from './ui/Modal';

const formatVND = (n: number, showSuffix: boolean = true) =>
  new Intl.NumberFormat('en-US').format(n) + (showSuffix ? ' VND' : '');

const roundUp1k = (n: number) => Math.ceil(n / 1000) * 1000;

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

export function PayablesTab({ config, data, loading, role, onRefresh }: Props) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('pending');
  const [acting, setActing] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editForm, setEditForm] = useState({ amount: '', note: '' });
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [termPayable, setTermPayable] = useState<any>(null);
  const [termFinalReading, setTermFinalReading] = useState('');
  const [termDebtTotal, setTermDebtTotal] = useState('');
  const [termCleaningFee, setTermCleaningFee] = useState('');
  const [termStayedDays, setTermStayedDays] = useState(30);

  const isAdmin = role === 'admin';

  const payables = useMemo(() => {
    if (!data?.payables) return [];
    let list = [...data.payables];
    if (filter === 'pending') list = list.filter(p => p.status === 'pending' || p.status === 'false' || !p.status);
    if (filter === 'paid') list = list.filter(p => p.status === 'paid' || p.status === 'true');
    return list.sort((a, b) => {
      const da = a.created_at || '';
      const db = b.created_at || '';
      return db.localeCompare(da);
    });
  }, [data, filter]);

  const totalPending = payables
    .filter(p => p.status === 'pending' || p.status === 'false' || !p.status)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const handleToggleStatus = async (payable: any) => {
    if (!isAdmin) return;
    setActing(true);
    try {
      const newStatus = (payable.status === 'paid' || payable.status === 'true') ? 'pending' : 'paid';
      await API.updatePayable(config, payable.id, { status: newStatus });
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setActing(false);
  };

  const openTerminationForm = (payable: any) => {
    if (!payable.contract_id) {
      alert('Không tìm thấy hợp đồng liên kết');
      return;
    }
    // Pre-fill from note if possible
    const note = payable.note || '';
    const elecMatch = note.match(/(\d+)\s*-\s*(\d+)\s*=\s*(\d+)\s*kWh/i);
    setTermPayable(payable);
    setTermFinalReading(elecMatch ? elecMatch[1] : '');
    setTermDebtTotal('');
    setTermCleaningFee('');
    setTermStayedDays(30);
  };

  const handleTerminationPdf = async () => {
    if (!termPayable) return;
    setPdfLoading(`termination_${termPayable.id}`);
    try {
      // Use the original deposit from the contract, not the payable's net amount
      const contract = (data?.contracts_all || []).find((c: any) => c.id === termPayable.contract_id);
      const originalDeposit = contract ? Number(contract.deposit_paid) || 0 : (Number(termPayable.amount) || 0);
      const startElectric = contract ? Number(contract.start_electric) || 0 : 0;
      const peopleCount = Number(contract?.people_count) || 1;
      const discount = Number(contract?.discount) || 0;
      const fullRent = Number(contract?.rent) || 0;

      const finalReading = termFinalReading ? Number(termFinalReading) : NaN;
      const electricPrice = Number(data?.settings?.ELECTRIC_PRICE) || 3500;
      const debt = Number(termDebtTotal) || 0;
      const cleaning = Number(termCleaningFee) || 0;
      const ds = termStayedDays;

      let consumption = 0;
      let electricCost = 0;
      if (!isNaN(finalReading) && finalReading > startElectric) {
        consumption = finalReading - startElectric;
        electricCost = consumption * electricPrice;
      }

      const proratedRent = roundUp1k(fullRent / 30 * ds);
      const proratedWater = roundUp1k((Number(data?.settings?.WATER_PRICE_PER_PERSON) || 0) * peopleCount / 30 * ds);
      const monthlySurcharge = Math.max(0, (Number(data?.settings?.SURCHARGE_PER_PERSON) || 0) * peopleCount - discount);
      const proratedService = roundUp1k(monthlySurcharge / 30 * ds);

      const totalDeductions = proratedRent + electricCost + debt + cleaning + proratedWater + proratedService;
      const refundAmount = Math.max(0, originalDeposit - totalDeductions);

      const res = await API.getTerminationPdf(config, termPayable.contract_id, {
        final_electric_reading: !isNaN(finalReading) ? finalReading : undefined,
        electric_consumption: consumption || undefined,
        electric_cost: electricCost || undefined,
        electric_price: electricPrice,
        refund_amount: refundAmount,
        debt_total: debt || undefined,
        cleaning_fee: cleaning || undefined,
        water_fee: proratedWater || undefined,
        service_fee: proratedService || undefined,
        stayed_days: ds,
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
      setTermPayable(null);
    } catch (e: any) {
      alert('Lỗi tạo PDF: ' + e.message);
    }
    setPdfLoading(null);
  };

  const openEdit = (payable: any) => {
    setEditingItem(payable);
    setEditForm({ amount: String(payable.amount || ''), note: payable.note || '' });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    setActing(true);
    try {
      await API.updatePayable(config, editingItem.id, {
        amount: Number(editForm.amount) || 0,
        note: editForm.note,
      });
      setShowEditModal(false);
      setEditingItem(null);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setActing(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setActing(true);
    try {
      // Use archive pattern for delete
      await API.updatePayable(config, deleteId, { status: 'cancelled', updated_at: new Date().toISOString() });
      setDeleteId(null);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setActing(false);
  };

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-800">Khoản phải trả</h2>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button onClick={() => setFilter('all')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Tất cả</button>
            <button onClick={() => setFilter('pending')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'pending' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Chưa trả</button>
            <button onClick={() => setFilter('paid')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === 'paid' ? 'bg-white shadow text-indigo-700' : 'text-slate-500'}`}>Đã trả</button>
          </div>
          {filter === 'pending' && totalPending > 0 && (
            <div className="text-sm font-semibold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
              Tổng chưa trả: {formatVND(totalPending)}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Phòng</th>
                <th className="px-4 py-3 font-medium">Khách thuê</th>
                <th className="px-4 py-3 font-medium text-right">Số tiền (VND)</th>
                <th className="px-4 py-3 font-medium text-center">Loại</th>
                <th className="px-4 py-3 font-medium text-center">Trạng thái</th>
                <th className="px-4 py-3 font-medium text-center">Ngày kết thúc HĐ</th>
                <th className="px-4 py-3 font-medium">Ghi chú</th>
                {isAdmin && <th className="px-4 py-3 font-medium text-center">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payables.map((p, idx) => {
                const isPaid = p.status === 'paid' || p.status === 'true';
                return (
                  <motion.tr key={p.id || idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-bold text-slate-800">{p.room_id}</td>
                    <td className="px-4 py-3 text-slate-700">{p.tenant}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatVND(p.amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="neutral">{p.payable_type || 'Trả cọc'}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isPaid ? <CheckCircle size={12} /> : <XCircle size={12} />}
                        {isPaid ? 'Đã trả' : 'Chưa trả'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-500 text-xs">{p.contract_ended_at || '—'}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate" title={p.note}>{p.note || '—'}</td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => handleToggleStatus(p)}
                            disabled={acting}
                            title={isPaid ? 'Đánh dấu chưa trả' : 'Đánh dấu đã trả'}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 ${isPaid ? 'hover:bg-amber-50 text-amber-500 hover:text-amber-700' : 'hover:bg-emerald-50 text-emerald-500 hover:text-emerald-700'}`}
                          >
                            {isPaid ? <XCircle size={14} /> : <CheckCircle size={14} />}
                          </button>
                          {p.contract_id && (
                            <button
                              onClick={() => openTerminationForm(p)}
                              disabled={pdfLoading === `termination_${p.id}`}
                              title="Biên bản thanh lý HĐ"
                              className="p-1.5 rounded-lg hover:bg-violet-50 text-slate-400 hover:text-violet-600 disabled:opacity-50"
                            >
                              {pdfLoading === `termination_${p.id}` ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                            </button>
                          )}
                          <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    )}
                  </motion.tr>
                );
              })}
              {payables.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                    {filter === 'pending' ? 'Không có khoản phải trả nào đang chờ.' : filter === 'paid' ? 'Chưa có khoản nào đã trả.' : 'Chưa có dữ liệu khoản phải trả.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal open={showEditModal} onClose={() => setShowEditModal(false)} title="Sửa khoản phải trả" maxWidth="max-w-sm">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền (VND)</label>
            <input type="number" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} rows={3} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowEditModal(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Hủy</button>
            <button onClick={handleSaveEdit} disabled={acting} className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {acting && <Loader2 size={16} className="animate-spin" />} Lưu
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={acting} message="Xóa khoản phải trả này?" />

      {/* Termination PDF Form */}
      <Modal open={!!termPayable} onClose={() => setTermPayable(null)} title="Biên bản thanh lý HĐ" maxWidth="max-w-sm">
        <div className="space-y-4">
          <p className="text-xs text-slate-500">Nhập thông tin quyết toán trước khi tạo PDF biên bản thanh lý.</p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Số ngày ở thực tế tháng cuối</label>
            <input type="number" min={0} max={31} value={termStayedDays}
              onChange={e => setTermStayedDays(e.target.value === "" ? 30 : Math.max(0, Math.min(31, Number(e.target.value))))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Chỉ số điện cuối</label>
            <input type="number" value={termFinalReading} onChange={e => setTermFinalReading(e.target.value)}
              placeholder="Để trống nếu không có"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nợ kỳ trước</label>
              <input type="number" value={termDebtTotal} onChange={e => setTermDebtTotal(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Phí vệ sinh</label>
              <input type="number" value={termCleaningFee} onChange={e => setTermCleaningFee(e.target.value)}
                placeholder="0"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </div>
          {(() => {
            const contract = (data?.contracts_all || []).find((c: any) => c.id === termPayable?.contract_id);
            if (!contract) return null;
            const depositPaid = Number(contract.deposit_paid) || 0;
            const fullRent = Number(contract.rent) || 0;
            const ds = termStayedDays;
            const proratedRent = roundUp1k(fullRent / 30 * ds);
            const peopleCount = Number(contract.people_count) || 1;
            const discount = Number(contract.discount) || 0;
            const proratedWater = roundUp1k((Number(data?.settings?.WATER_PRICE_PER_PERSON) || 0) * peopleCount / 30 * ds);
            const monthlySurcharge = Math.max(0, (Number(data?.settings?.SURCHARGE_PER_PERSON) || 0) * peopleCount - discount);
            const proratedService = roundUp1k(monthlySurcharge / 30 * ds);
            return (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs space-y-1">
                <p className="flex justify-between text-slate-700 font-medium">Số tiền đã cọc:<span>{formatVND(depositPaid)}</span></p>
                {proratedRent > 0 && <p className="flex justify-between text-slate-600">Tiền phòng {ds} ngày:<span className="text-rose-600">-{formatVND(proratedRent)}</span></p>}
                {proratedWater > 0 && <p className="flex justify-between text-slate-600">Tiền nước {ds} ngày:<span className="text-rose-600">-{formatVND(proratedWater)}</span></p>}
                {proratedService > 0 && <p className="flex justify-between text-slate-600">Phí dịch vụ {ds} ngày (chiết khấu -{formatVND(discount)}/tháng):<span className="text-rose-600">-{formatVND(proratedService)}</span></p>}
              </div>
            );
          })()}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setTermPayable(null)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors">Hủy</button>
            <button onClick={handleTerminationPdf} disabled={pdfLoading === `termination_${termPayable?.id}`} className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 text-white font-medium hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {pdfLoading === `termination_${termPayable?.id}` && <Loader2 size={16} className="animate-spin" />} Tạo PDF
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
