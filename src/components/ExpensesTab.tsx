import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Pencil, Trash2, Check, X, RotateCcw, HandCoins, Wallet } from 'lucide-react';
import { API, type AppConfig, type DashboardData, type UserRole } from '../lib/api';
import { formatVND } from '../lib/payment-utils';

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

const EXPENSE_TYPES = ['Rác', 'Điện', 'Nước', 'Internet', 'Bảo trì', 'Sửa chữa', 'Trả cọc', 'Khác'];

const TYPE_COLORS: Record<string, string> = {
  'Rác': 'bg-lime-100 text-lime-700',
  'Điện': 'bg-amber-100 text-amber-700',
  'Nước': 'bg-blue-100 text-blue-700',
  'Internet': 'bg-violet-100 text-violet-700',
  'Bảo trì': 'bg-orange-100 text-orange-700',
  'Sửa chữa': 'bg-rose-100 text-rose-700',
  'Trả cọc': 'bg-cyan-100 text-cyan-700',
  'Khác': 'bg-slate-100 text-slate-600',
};

interface ExpenseForm {
  expense_type: string;
  amount: string;
  expense_date: string; // DD/MM/YYYY for API
  expense_date_iso: string; // YYYY-MM-DD for native date input
  period: string;
  is_reimbursement: boolean;
  paid_by: string;
  note: string;
}

/** DD/MM/YYYY → YYYY-MM-DD */
const toISO = (ddmmyyyy: string): string => {
  const p = ddmmyyyy.split('/');
  if (p.length !== 3) return '';
  return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
};

/** YYYY-MM-DD → DD/MM/YYYY */
const fromISO = (iso: string): string => {
  const p = iso.split('-');
  if (p.length !== 3) return '';
  return `${p[2]}/${p[1]}/${p[0]}`;
};

/** YYYY-MM-DD → MM/YYYY */
const periodFromISO = (iso: string): string => {
  const p = iso.split('-');
  if (p.length !== 3) return '';
  return `${p[1]}/${p[0]}`;
};

const defaultForm = (): ExpenseForm => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return {
    expense_type: 'Khác',
    amount: '',
    expense_date: `${dd}/${mm}/${yyyy}`,
    expense_date_iso: `${yyyy}-${mm}-${dd}`,
    period: `${mm}/${yyyy}`,
    is_reimbursement: false,
    paid_by: '',
    note: '',
  };
};

export function ExpensesTab({ config, data, loading, role, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterReimb, setFilterReimb] = useState('all');

  const expenses = useMemo(() => {
    if (!data?.expenses) return [];
    let list = [...data.expenses];
    if (filterType !== 'all') list = list.filter(e => e.expense_type === filterType);
    if (filterReimb === 'reimbursement') list = list.filter(e => e.is_reimbursement === true || e.is_reimbursement === 'true');
    if (filterReimb === 'direct') list = list.filter(e => e.is_reimbursement !== true && e.is_reimbursement !== 'true');
    if (filterReimb === 'pending') list = list.filter(e => (e.is_reimbursement === true || e.is_reimbursement === 'true') && e.reimbursed !== true && e.reimbursed !== 'true');
    return list.sort((a, b) => {
      const da = a.expense_date || a.created_at || '';
      const db = b.expense_date || b.created_at || '';
      return db.localeCompare(da);
    });
  }, [data, filterType, filterReimb]);

  const totalExpenses = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalReimbursement = expenses.filter(e => e.is_reimbursement === true || e.is_reimbursement === 'true').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const pendingReimb = expenses.filter(e => (e.is_reimbursement === true || e.is_reimbursement === 'true') && e.reimbursed !== true && e.reimbursed !== 'true').reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const isAdmin = role === 'admin';

  const openAdd = () => {
    setForm(defaultForm());
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (expense: any) => {
    const dateStr = expense.expense_date || '';
    setForm({
      expense_type: expense.expense_type || 'Khác',
      amount: String(expense.amount || ''),
      expense_date: dateStr,
      expense_date_iso: toISO(dateStr),
      period: expense.period || '',
      is_reimbursement: expense.is_reimbursement === true || expense.is_reimbursement === 'true',
      paid_by: expense.paid_by || '',
      note: expense.note || '',
    });
    setEditingId(expense.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.amount || Number(form.amount) <= 0) return alert('Vui lòng nhập số tiền hợp lệ');
    setSaving(true);
    try {
      const { expense_date_iso: _unused, ...rest } = form;
      const payload = {
        ...rest,
        amount: Number(form.amount),
        is_reimbursement: form.is_reimbursement,
      };
      if (editingId) {
        await API.updateExpense(config, editingId, payload);
      } else {
        await API.createExpense(config, payload);
      }
      setShowForm(false);
      await onRefresh();
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Xóa chi phí này?')) return;
    try {
      await API.deleteExpense(config, id);
      await onRefresh();
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  const handleToggleReimbursed = async (expense: any) => {
    const newVal = !(expense.reimbursed === true || expense.reimbursed === 'true');
    try {
      await API.updateExpense(config, expense.id, { reimbursed: newVal });
      await onRefresh();
    } catch (err: any) {
      alert('Lỗi: ' + err.message);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-800">Quản lý Chi phí</h2>
        {isAdmin && (
          <button onClick={openAdd} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm">
            <Plus size={18} /> Thêm chi phí
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center"><Wallet size={20} className="text-rose-500" /></div>
            <span className="text-sm text-slate-500">Tổng chi phí</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{formatVND(totalExpenses)}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center"><HandCoins size={20} className="text-amber-500" /></div>
            <span className="text-sm text-slate-500">Tổng chi hộ</span>
          </div>
          <p className="text-2xl font-bold text-slate-800">{formatVND(totalReimbursement)}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center"><RotateCcw size={20} className="text-orange-500" /></div>
            <span className="text-sm text-slate-500">Chưa hoàn trả</span>
          </div>
          <p className="text-2xl font-bold text-orange-600">{formatVND(pendingReimb)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-400 focus:outline-none">
          <option value="all">Tất cả loại</option>
          {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterReimb} onChange={e => setFilterReimb(e.target.value)} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-400 focus:outline-none">
          <option value="all">Tất cả</option>
          <option value="direct">Chi trực tiếp</option>
          <option value="reimbursement">Chi hộ</option>
          <option value="pending">Chưa hoàn trả</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-separate border-spacing-0">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold border-b border-slate-200">Ngày</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200">Loại</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200">Kỳ</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200 text-right">Số tiền</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200">Hình thức</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200">Người chi hộ</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200 text-center">Hoàn trả</th>
                <th className="px-4 py-3 font-semibold border-b border-slate-200">Ghi chú</th>
                {isAdmin && <th className="px-4 py-3 font-semibold border-b border-slate-200 text-center">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.map((exp, idx) => {
                const isReimb = exp.is_reimbursement === true || exp.is_reimbursement === 'true';
                const isReimbursed = exp.reimbursed === true || exp.reimbursed === 'true';
                return (
                  <motion.tr key={exp.id || idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{exp.expense_date}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-semibold ${TYPE_COLORS[exp.expense_type] || TYPE_COLORS['Khác']}`}>
                        {exp.expense_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{exp.period}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatVND(exp.amount)}</td>
                    <td className="px-4 py-3">
                      {isReimb ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700">
                          <HandCoins size={12} /> Chi hộ
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700">
                          <Wallet size={12} /> Trực tiếp
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{isReimb ? (exp.paid_by || '—') : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {isReimb ? (
                        isReimbursed ? (
                          <button onClick={() => isAdmin && handleToggleReimbursed(exp)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors" title={exp.reimbursed_at ? `Hoàn trả: ${exp.reimbursed_at}` : ''}>
                            <Check size={12} /> Đã trả
                          </button>
                        ) : (
                          <button onClick={() => isAdmin && handleToggleReimbursed(exp)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-orange-100 text-orange-700 hover:bg-orange-200 transition-colors">
                            <X size={12} /> Chưa trả
                          </button>
                        )
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate" title={exp.note}>{exp.note || '—'}</td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => openEdit(exp)} className="p-1.5 rounded-lg hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"><Pencil size={15} /></button>
                          <button onClick={() => handleDelete(exp.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    )}
                  </motion.tr>
                );
              })}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 9 : 8} className="px-4 py-12 text-center text-slate-400">
                    Chưa có chi phí nào
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800">{editingId ? 'Sửa chi phí' : 'Thêm chi phí mới'}</h3>
              </div>
              <div className="p-6 space-y-4">
                {/* Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Loại chi phí</label>
                  <select id="select-expense-type" name="expense_type" value={form.expense_type} onChange={e => setForm({ ...form, expense_type: e.target.value })} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                    {EXPENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Số tiền (VNĐ)</label>
                  <input id="input-expense-amount" name="amount" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="500000" className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                </div>
                {/* Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Ngày phát sinh</label>
                    <input id="input-expense-date" name="expense_date" type="date" value={form.expense_date_iso} onChange={e => {
                      const iso = e.target.value;
                      setForm({
                        ...form,
                        expense_date_iso: iso,
                        expense_date: fromISO(iso),
                        period: periodFromISO(iso),
                      });
                    }} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Kỳ (MM/YYYY)</label>
                    <input id="input-expense-period" name="period" type="text" value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} placeholder="05/2026" className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  </div>
                </div>
                {/* Reimbursement Toggle */}
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <input type="checkbox" id="is_reimbursement" name="is_reimbursement" checked={form.is_reimbursement} onChange={e => setForm({ ...form, is_reimbursement: e.target.checked, paid_by: e.target.checked ? form.paid_by : '' })} className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <label htmlFor="is_reimbursement" className="text-sm font-medium text-slate-700 cursor-pointer">
                    Chi hộ chủ nhà <span className="text-slate-400 font-normal">(chủ nhà sẽ trả lại)</span>
                  </label>
                </div>
                {/* Paid By */}
                {form.is_reimbursement && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Người chi hộ</label>
                    <input id="input-expense-paid-by" name="paid_by" type="text" value={form.paid_by} onChange={e => setForm({ ...form, paid_by: e.target.value })} placeholder="Tên người chi hộ" className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  </motion.div>
                )}
                {/* Note */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Ghi chú</label>
                  <textarea id="textarea-expense-note" name="note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2} placeholder="Mô tả chi phí..." className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none resize-none" />
                </div>
              </div>
              <div className="p-6 border-t border-slate-100 flex justify-end gap-3">
                <button onClick={() => setShowForm(false)} className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">Hủy</button>
                <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 shadow-sm">
                  {saving ? 'Đang lưu...' : (editingId ? 'Cập nhật' : 'Thêm')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
