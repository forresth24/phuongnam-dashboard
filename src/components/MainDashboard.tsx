import { useState, useEffect, useCallback } from 'react';
import { API, type AppConfig, type DashboardData, type UserRole } from '../lib/api';
import { LayoutDashboard, BedDouble, FileText, Users, ScrollText, Settings, LogOut, Shield, PieChart, Receipt } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { OverviewTab } from './OverviewTab';
import { RoomsTab } from './RoomsTab';
import { ContractsTab } from './ContractsTab';
import { TenantsTab } from './TenantsTab';
import { PaymentsTab } from './PaymentsTab';
import { ExpensesTab } from './ExpensesTab';
import { ReportsTab } from './ReportsTab';
import { SettingsTab } from './SettingsTab';

declare const __APP_VERSION__: string | undefined;

// ==========================================
// MAIN LAYOUT
// ==========================================

export function MainDashboard({ config, onLogout }: { config: AppConfig, onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>('viewer');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashData, roleData] = await Promise.all([
        API.getDashboardData(config),
        API.getRole(config),
      ]);
      setData(dashData);
      setRole(roleData.role);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
    setLoading(false);
  }, [config]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const forceRefresh = () => fetchData();

  const TABS = [
    { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
    { id: 'rooms', label: 'Phòng', icon: BedDouble },
    { id: 'contracts', label: 'Hợp đồng', icon: ScrollText },
    { id: 'tenants', label: 'Khách thuê', icon: Users },
    { id: 'payments', label: 'Thanh toán', icon: FileText },
    { id: 'expenses', label: 'Chi phí', icon: Receipt },
    { id: 'reports', label: 'Báo cáo', icon: PieChart },
    { id: 'settings', label: 'Cài đặt', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row pb-20 md:pb-0">
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col sticky top-0 h-screen print:hidden">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
            Phương Nam
          </h1>
          <p className="text-xs text-slate-400 mt-1">Management Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {TABS.map(t => {
             const Icon = t.icon;
             const isActive = activeTab === t.id;
             return (
               <button
                 key={t.id}
                 onClick={() => setActiveTab(t.id)}
                 className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
                   isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
                 }`}
               >
                 <Icon size={18} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
                 {t.label}
               </button>
             );
          })}
        </nav>
        <div className="p-4 border-t border-slate-100 space-y-2">
          <div className="flex items-center gap-2 px-4 py-2 text-xs">
            <Shield size={14} className={role === 'admin' ? 'text-emerald-500' : 'text-amber-500'} />
            <span className={`font-medium ${role === 'admin' ? 'text-emerald-600' : 'text-amber-600'}`}>
              {role === 'admin' ? 'Admin' : 'Viewer'}
            </span>
          </div>
          <button onClick={onLogout} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl font-medium text-sm text-rose-600 hover:bg-rose-50 transition-colors">
            <LogOut size={18} /> Đăng xuất
          </button>
          <div className="px-4 pt-2 text-center text-[10px] text-slate-400 font-medium">
            Phiên bản: {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Dev'}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full print:p-0 print:max-w-none print:w-full">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between bg-white p-4 rounded-2xl shadow-sm mb-6 border border-slate-100 print:hidden">
          <div>
            <h1 className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
              Phương Nam
            </h1>
            <div className="text-[9px] text-slate-400 font-medium mt-0.5">
              v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'Dev'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${role === 'admin' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {role === 'admin' ? 'Admin' : 'Viewer'}
            </span>
            <button onClick={onLogout} className="text-slate-400 hover:text-rose-500">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && <OverviewTab data={data} loading={loading} />}
            {activeTab === 'rooms' && <RoomsTab config={config} data={data} loading={loading} role={role} onRefresh={forceRefresh} onNavigate={setActiveTab} />}
            {activeTab === 'contracts' && <ContractsTab config={config} data={data} loading={loading} role={role} onRefresh={forceRefresh} />}
            { activeTab === 'tenants' && <TenantsTab config={config} data={data} loading={loading} role={role} onRefresh={forceRefresh} /> }
            { activeTab === 'payments' && <PaymentsTab config={config} data={data} loading={loading} role={role} onRefresh={forceRefresh} /> }
            { activeTab === 'expenses' && <ExpensesTab config={config} data={data} loading={loading} role={role} onRefresh={forceRefresh} /> }
            { activeTab === 'reports' && <ReportsTab config={config} data={data} loading={loading} /> }
            { activeTab === 'settings' && <SettingsTab config={config} data={data} loading={loading} role={role} onRefresh={forceRefresh} /> }
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation (Mobile) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 flex justify-between items-center z-50 pb-safe print:hidden">
        {TABS.map(t => {
           const Icon = t.icon;
           const isActive = activeTab === t.id;
           return (
             <button
               key={t.id}
               onClick={() => setActiveTab(t.id)}
               className={`flex flex-col items-center gap-0.5 px-1 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}
             >
               <Icon size={20} className={isActive ? 'text-indigo-600' : 'text-slate-400'} />
               <span className="text-[9px] font-medium">{t.label}</span>
             </button>
           );
        })}
      </nav>
    </div>
  );
}
