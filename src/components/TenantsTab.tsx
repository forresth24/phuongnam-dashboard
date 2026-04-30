import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Loader2, Search, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import type { AppConfig, DashboardData, UserRole } from '../lib/api';
import { API } from '../lib/api';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
  role: UserRole;
  onRefresh: () => void;
}

const emptyForm = { room_id: '', name: '', phone: '', cccd: '', dob: '', issue_date: '', issue_place: 'Cục Cảnh Sát', address: '' };

export function TenantsTab({ config, data, loading, role, onRefresh }: Props) {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState<string>('room_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return null;

  const isAdmin = role === 'admin';
  const tenants = data.tenants.filter((t: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.name || '').toLowerCase().includes(q) || (t.room_id || '').toLowerCase().includes(q) || (t.phone || '').includes(q) || (t.cccd || '').includes(q);
  });

  const sortedTenants = [...tenants].sort((a, b) => {
    let valA = a[sortBy], valB = b[sortBy];
    
    valA = String(valA || '').toLowerCase();
    valB = String(valB || '').toLowerCase();
    
    // Numerical sort for room_id
    if (sortBy === 'room_id') {
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

  const openCreate = () => {
    setEditItem(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (t: any) => {
    setEditItem(t);
    setForm({
      room_id: t.room_id || '', name: t.name || '', phone: t.phone || '', cccd: t.cccd || '',
      dob: t.dob || '', issue_date: t.issue_date || '', issue_place: t.issue_place || '', address: t.address || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editItem) {
        await API.updateTenant(config, editItem.id, form);
      } else {
        await API.createTenant(config, form);
      }
      setModalOpen(false);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await API.deleteTenant(config, deleteId);
      setDeleteId(null);
      onRefresh();
    } catch (e: any) { alert('Lỗi: ' + e.message); }
    setDeleting(false);
  };

  const F = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-bold text-slate-800">Khách thuê</h2>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Tìm tên, phòng, SĐT..."
              className="pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-56"
            />
          </div>
          {isAdmin && (
            <button onClick={openCreate} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
              <Plus size={18} /> Thêm
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th onClick={() => toggleSort('room_id')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Phòng <SortIcon col="room_id" /></div></th>
                <th onClick={() => toggleSort('name')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Họ tên <SortIcon col="name" /></div></th>
                <th onClick={() => toggleSort('phone')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">SĐT <SortIcon col="phone" /></div></th>
                <th onClick={() => toggleSort('cccd')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">CCCD <SortIcon col="cccd" /></div></th>
                <th onClick={() => toggleSort('dob')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Ngày sinh <SortIcon col="dob" /></div></th>
                <th onClick={() => toggleSort('address')} className="px-4 py-3 font-medium cursor-pointer hover:bg-slate-100 group"><div className="flex items-center">Địa chỉ <SortIcon col="address" /></div></th>
                {isAdmin && <th className="px-4 py-3 font-medium">Thao tác</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedTenants.map((t: any) => (
                <motion.tr key={t.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium">{t.room_id}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                  <td className="px-4 py-3 text-slate-500">{t.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{t.cccd || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{t.dob || '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-[200px] truncate">{t.address || '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-indigo-600"><Pencil size={14} /></button>
                        <button onClick={() => setDeleteId(t.id)} className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  )}
                </motion.tr>
              ))}
              {sortedTenants.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Không có khách thuê nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editItem ? 'Sửa khách thuê' : 'Thêm khách thuê'} maxWidth="max-w-xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Phòng</label>
            <select value={form.room_id} onChange={e => F('room_id', e.target.value)} disabled={!!editItem} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50">
              <option value="">Chọn phòng</option>
              {data.rooms.map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Họ tên *</label>
            <input value={form.name} onChange={e => F('name', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">SĐT</label>
            <input value={form.phone} onChange={e => F('phone', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">CCCD</label>
            <input value={form.cccd} onChange={e => F('cccd', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày sinh</label>
            <input value={form.dob} onChange={e => F('dob', e.target.value)} placeholder="DD/MM/YYYY" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ngày cấp CCCD</label>
            <input value={form.issue_date} onChange={e => F('issue_date', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nơi cấp</label>
            <select 
              value={form.issue_place || 'Cục Cảnh Sát'} 
              onChange={e => F('issue_place', e.target.value)} 
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
            >
              <option value="Cục Cảnh Sát">Cục Cảnh Sát</option>
              <option value="Bộ Công An">Bộ Công An</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Địa chỉ</label>
            <input value={form.address} onChange={e => F('address', e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <div className="col-span-2">
            <button onClick={handleSave} disabled={saving || !form.room_id || !form.name} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving && <Loader2 size={16} className="animate-spin" />}
              {editItem ? 'Cập nhật' : 'Thêm khách thuê'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={deleting} message="Xóa khách thuê này? Dữ liệu sẽ được lưu vào history." />
    </div>
  );
}
