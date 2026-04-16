import { BedDouble, CheckCircle2, Clock, FileText, Loader2 } from 'lucide-react';
import type { DashboardData } from '../lib/api';

const formatVND = (amount: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

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

interface Props {
  data: DashboardData | null;
  loading: boolean;
}

export function OverviewTab({ data, loading }: Props) {
  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>;
  if (!data) return <div className="text-red-500">Failed to load stats</div>;

  const totalRooms = data.rooms.length;
  const occupiedRooms = data.rooms.filter(r => r.status === 'occupied').length;
  const availableRooms = totalRooms - occupiedRooms;
  const totalExpected = data.contracts.reduce((s: number, c: any) => s + (Number(c.rent) || 0), 0);
  const pendingPayments = data.payments.filter((p: any) => p.status === 'Chưa tới chủ nhà').reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
  const totalTenants = data.tenants.length;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800">Tổng quan</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Tổng số phòng" value={totalRooms} icon={<BedDouble size={24} />} colorClass="bg-blue-100 text-blue-600" />
        <StatCard title="Đang thuê" value={`${occupiedRooms} / ${availableRooms} trống`} icon={<CheckCircle2 size={24} />} colorClass="bg-green-100 text-green-600" />
        <StatCard title="Chờ chủ nhà nhận" value={formatVND(pendingPayments)} icon={<Clock size={24} />} colorClass="bg-amber-100 text-amber-600" />
        <StatCard title="Doanh thu kỳ vọng/tháng" value={formatVND(totalExpected)} icon={<FileText size={24} />} colorClass="bg-purple-100 text-purple-600" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Hợp đồng đang hoạt động" value={data.contracts.length} icon={<FileText size={24} />} colorClass="bg-indigo-100 text-indigo-600" />
        <StatCard title="Tổng số khách thuê" value={totalTenants} icon={<CheckCircle2 size={24} />} colorClass="bg-teal-100 text-teal-600" />
        <StatCard title="Tổng giao dịch" value={data.payments.length} icon={<Clock size={24} />} colorClass="bg-orange-100 text-orange-600" />
      </div>
    </div>
  );
}
