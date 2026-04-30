import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2, CheckCircle2, Loader2, FileText, Pencil } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API, downloadBase64Pdf } from '../lib/api';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { getReceivers, autoPaymentStatus } from '../lib/settings-helpers';
import { PaymentFormModal } from './PaymentFormModal';
import {
  formatVND, firstDayOfMonthStr, makeEmptyPaymentForm,
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
  const [completeItem, setCompleteItem] = useState<any>(null);
  const [completeReceiver, setCompleteReceiver] = useState('');
  const [completeMethod, setCompleteMethod] = useState('Tiền mặt');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const payments = [...data.payments].reverse();
  const receivers = getReceivers(data.settings);


  // ─── Actions ────────────────────────────────────────────

  const handleComplete = (p: any) => {
    setCompleteItem(p);
    setCompleteReceiver(receivers[0] || '');
    setCompleteMethod(p.method || 'Tiền mặt');
  };

  const handleDoComplete = async () => {
    if (!completeItem) return;
    setActing(completeItem.id);
    try {
      await API.updatePayment(config, completeItem.id, {
        ...completeItem,
        receiver: completeReceiver,
        method: completeMethod,
        status: autoPaymentStatus(completeReceiver, data.settings),
      });
      setCompleteItem(null);
      onRefresh();
    } catch (e: any) {
      alert('Lỗi: ' + e.message);
    }
    setActing(null);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try { await API.deletePayment(config, deleteId); setDeleteId(null); onRefresh(); }
    catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  const handleExportPdf = async (id: string) => {
    setExportingId(id);
    try {
      const res = await API.getReceiptPdf(config, id);
      downloadBase64Pdf(res.base64, res.filename);
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
    const baseRent = Number(p.base_rent) || Number(p['tiền phòng']) || 0;
    const extraFee = Number(p.extra_fee_total) || Number(p['phụ thu quá người']) || 0;
    const livingFee = Number(p.surcharge_total) || Number(p['phí dịch vụ']) || 0;
    const waterFee = Number(p.water_total) || Number(p['nước sinh hoạt']) || 0;
    const electricFee = Number(p.electric_total) || Number(p['điện sinh hoạt']) || 0;
    const depositFee = Number(p.deposit_fee) || Number(p['tiền cọc']) || 0;
    const discount = Number(p.discount_applied) || Number(p['chiết khấu']) || Number(p['giảm giá']) || Number(p['chiết khấu/tháng']) || Number(p['discount']) || 0;

    const included = ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'];
    if (depositFee > 0) included.push('deposit_fee');

    setInitialForm({
      room_id: contract ? contract.room_id : '',
      contract_id: p.contract_id,
      amount: p.amount,
      date: p.date,
      receiver: p.receiver || 'Chưa nhận',
      method: p.method || 'Tiền mặt',
      status: p.status || 'Chưa tới chủ nhà',
      is_partial: String(p.is_partial).toUpperCase() === 'TRUE',
      note: p.note || '',
      tenant: contract ? contract.tenant : '',
      phone: contract ? contract.phone : '',
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
      days_stayed: Number(p.days_stayed) || Number(p.days_in_month) || 30,
      days_in_month: 30,
      old_electric: Number(p.old_electric) || (contract ? Number(contract.start_electric) || 0 : 0),
      new_electric: Number(p.new_electric) || 0,
      previous_debt: Number(p.previous_debt) || Number(p['nợ kỳ trước']) || 0,
      deposit_paid: Number(p.deposit_paid) || 0,
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
        {isAdmin && (
          <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
            <Plus size={18} /> Thu tiền
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">HĐ / Phòng</th>
                <th className="px-4 py-3 font-medium">Loại GD</th>
                <th className="px-4 py-3 font-medium">Số tiền</th>
                <th className="px-4 py-3 font-medium">Ngày</th>
                <th className="px-4 py-3 font-medium">Người nhận</th>
                <th className="px-4 py-3 font-medium">Hình thức</th>
                <th className="px-4 py-3 font-medium">Trạng thái</th>
                <th className="px-4 py-3 font-medium">Ghi chú</th>
                {isAdmin && <th className="px-4 py-3 font-medium">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p: any) => (
                <motion.tr key={p.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900 text-xs">{getRoom(p.contract_id)}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{p.contract_id}</div>
                  </td>
                  <td className="px-4 py-3 min-w-[130px]">
                    <span className="block text-sm">{p.payment_type || 'Tiền phòng'}</span>
                    {String(p.is_partial).toUpperCase() === 'TRUE' && <Badge variant="danger" className="mt-1">Trả thiếu</Badge>}
                  </td>
                  <td className="px-4 py-3 min-w-[130px]">
                    <div className="font-bold text-indigo-600">{formatVND(p.amount)}</div>
                    {p.total_amount_calculated > 0 && p.total_amount_calculated !== p.amount && (
                      <div className="text-[10px] text-slate-400 mt-0.5">Định mức: {formatVND(p.total_amount_calculated)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{p.date}</td>
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
                        <button onClick={() => handleExportPdf(p.id)} disabled={exportingId === p.id} 
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
              {payments.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Chưa có giao dịch nào</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Form Modal — uses shared PaymentFormModal */}
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
            <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
            <select value={completeReceiver} onChange={e => setCompleteReceiver(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
              {receivers.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phương thức<RequiredStar /></label>
            <select value={completeMethod} onChange={e => setCompleteMethod(e.target.value)}
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

      <ConfirmDialog open={!!deleteId} title="Xóa thanh toán" message="Bạn có chắc chắn muốn xóa khoản thanh toán này? Hành động này không thể hoàn tác."
        confirmLabel="Xóa" onConfirm={handleDelete} onClose={() => setDeleteId(null)} loading={deleting} />
    </div>
  );
}
