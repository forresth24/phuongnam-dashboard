import { useState, useEffect } from 'react';
import { API, type AppConfig } from '../lib/api';
import { LayoutDashboard, BedDouble, FileText, CheckCircle2, Clock, LogOut, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// --- Formatter ---
const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

// --- Sub-components ---

function StatCard({ title, value, icon, colorClass }: any) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex items-center gap-4">
      <div className={`p-4 rounded-xl ${colorClass}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
      </div>
    </div>
  );
}

// ==========================================
// TABS
// ==========================================

function OverviewTab({ config, refreshKey }: { config: AppConfig, refreshKey: number }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.getStats(config).then(setStats).finally(() => setLoading(false));
  }, [config, refreshKey]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!stats) return <div className="text-red-500">Failed to load stats</div>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Tổng quan</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Tổng số phòng" value={stats.totalRooms} icon={<BedDouble size={24} />} colorClass="bg-blue-100 text-blue-600" />
        <StatCard title="Đang thuê" value={stats.occupiedRooms} icon={<CheckCircle2 size={24} />} colorClass="bg-green-100 text-green-600" />
        <StatCard title="Đang giao uỷ quyền" value={formatVND(stats.pendingPayments)} icon={<Clock size={24} />} colorClass="bg-amber-100 text-amber-600" />
        <StatCard title="Tổng doanh thu/tháng" value={formatVND(stats.totalExpected)} icon={<FileText size={24} />} colorClass="bg-purple-100 text-purple-600" />
      </div>
    </div>
  );
}

function RoomsTab({ config, refreshKey }: { config: AppConfig, refreshKey: number }) {
  const [rooms, setRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    API.getRooms(config).then(setRooms).finally(() => setLoading(false));
  }, [config, refreshKey]);

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Danh sách phòng</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rooms.map((r, i) => (
          <motion.div 
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            key={r.id} 
            className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-slate-900">{r.name}</h3>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${r.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'}`}>
                {r.status === 'available' ? 'Trống' : 'Đang thuê'}
              </span>
            </div>
            <p className="text-slate-500 mb-4">{formatVND(r.price)} / tháng</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function PaymentsTab({ config, refreshKey, onUpdate }: { config: AppConfig, refreshKey: number, onUpdate: () => void }) {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    API.getPayments(config)
      .then(data => setPayments(data.reverse())) // Show newest first
      .finally(() => setLoading(false));
  }, [config, refreshKey]);

  const handleComplete = async (id: string) => {
    setActing(id);
    try {
      await API.completePayment(config, id);
      onUpdate();
    } catch (e) {
      alert('Lỗi cập nhật. Vui lòng thử lại.');
    }
    setActing(null);
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Lịch sử thanh toán</h2>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-6 py-4 font-medium">Hợp đồng</th>
                <th className="px-6 py-4 font-medium">Số tiền</th>
                <th className="px-6 py-4 font-medium focus:hidden">Ngày</th>
                <th className="px-6 py-4 font-medium">Trạng thái</th>
                <th className="px-6 py-4 font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-medium text-slate-900">{p.contract_id}</td>
                  <td className="px-6 py-4 font-bold text-indigo-600">{formatVND(p.amount)}</td>
                  <td className="px-6 py-4 text-slate-500 min-w-[120px]">{p.date}</td>
                  <td className="px-6 py-4 min-w-[160px]">
                    <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                      (!p.status || p.status === 'Hoàn thành') ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {p.status || 'Hoàn thành'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {p.status === 'Chưa tới chủ nhà' && (
                      <button 
                        onClick={() => handleComplete(p.id)}
                        disabled={acting === p.id}
                        className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 min-w-max"
                      >
                        {acting === p.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Đã nhận tiền
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-500">Chưa có giao dịch nào</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// MAIN LAYOUT
// ==========================================

export function MainDashboard({ config, onLogout }: { config: AppConfig, onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);

  const forceRefresh = () => setRefreshKey(k => k + 1);

  const TABS = [
    { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'rooms', label: 'Phòng', icon: BedDouble },
    { id: 'payments', label: 'Thanh toán', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row pb-20 md:pb-0">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col sticky top-0 h-screen">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
            Phương Nam
          </h1>
          <p className="text-xs text-slate-400 mt-1">Management Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {TABS.map(t => {
             const Icon = t.icon;
             const isActive = activeTab === t.id;
             return (
               <button
                 key={t.id}
                 onClick={() => setActiveTab(t.id)}
                 className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all ${
                   isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                 }`}
               >
                 <Icon size={20} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
                 {t.label}
               </button>
             );
          })}
        </nav>
        <div className="p-4 border-t border-slate-100">
          <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-rose-600 hover:bg-rose-50 transition-colors">
            <LogOut size={20} /> Đăng xuất
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm mb-6 border border-slate-100">
          <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
            Phương Nam
          </h1>
          <button onClick={onLogout} className="text-slate-400 hover:text-rose-500">
            <LogOut size={20} />
          </button>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && <OverviewTab config={config} refreshKey={refreshKey} />}
            {activeTab === 'rooms' && <RoomsTab config={config} refreshKey={refreshKey} />}
            {activeTab === 'payments' && <PaymentsTab config={config} refreshKey={refreshKey} onUpdate={forceRefresh} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation (Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-between items-center z-50 pb-safe">
        {TABS.map(t => {
           const Icon = t.icon;
           const isActive = activeTab === t.id;
           return (
             <button
               key={t.id}
               onClick={() => setActiveTab(t.id)}
               className={`flex flex-col items-center gap-1 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}
             >
               <Icon size={24} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
               <span className="text-[10px] font-medium">{t.label}</span>
             </button>
           );
        })}
      </nav>
    </div>
  );
}
