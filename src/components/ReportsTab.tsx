import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { FileDown, Printer, Search } from 'lucide-react';
import type { AppConfig, DashboardData } from '../lib/api';
import { formatVND } from '../lib/payment-utils';

export const normalizePeriod = (pStr: string): string => {
  const clean = String(pStr || '').trim();
  if (!clean) return '';
  const parts = clean.split('/');
  if (parts.length === 3) {
    // DD/MM/YYYY or D/M/YYYY -> MM/YYYY
    const m = parts[1].padStart(2, '0');
    return `${m}/${parts[2]}`;
  } else if (parts.length === 2) {
    // MM/YYYY or M/YYYY -> MM/YYYY
    const m = parts[0].padStart(2, '0');
    return `${m}/${parts[1]}`;
  }
  return clean;
};

interface Props {
  config: AppConfig;
  data: DashboardData | null;
  loading: boolean;
}

export function ReportsTab({ data, loading }: Props) {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const defaultPeriod = `${currentMonth.toString().padStart(2, '0')}/${currentYear}`;

  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Extract all available periods from payments
  const availablePeriods = useMemo(() => {
    if (!data) return [];
    const periods = new Set<string>();
    data.payments.forEach(p => {
      let period = p.payment_period || p['kỳ thanh toán'];
      if (!period && (p.received_date || p.date)) {
        period = p.received_date || p.date;
      }
      if (period) {
        periods.add(normalizePeriod(period));
      }
    });
    periods.add(normalizePeriod(defaultPeriod));
    return Array.from(periods).sort((a, b) => {
      const [m1, y1] = a.split('/');
      const [m2, y2] = b.split('/');
      if (y1 !== y2) return Number(y2) - Number(y1);
      return Number(m2) - Number(m1);
    });
  }, [data, defaultPeriod]);

  const reportData = useMemo(() => {
    if (!data || !selectedPeriod) return [];

    const targetPayments = data.payments.filter(p => {
      let period = p.payment_period || p['kỳ thanh toán'];
      if (!period && (p.received_date || p.date)) {
        period = p.received_date || p.date;
      }
      return normalizePeriod(period) === normalizePeriod(selectedPeriod);
    });

    const [selMonth, selYear] = selectedPeriod.split('/').map(Number);
    const selTime = selYear * 12 + selMonth;

    // Group by contract_id
    const grouped = new Map<string, any>();

    // 1. Initialize grouped with all contracts active in the period
    (data.contracts_all || []).forEach((c: any) => {
      let include = false;
      
      const isRoomOccupied = () => {
        const room = data.rooms.find((r: any) => String(r.id) === String(c.room_id));
        return room && room.status === 'occupied';
      };

      if (c.move_in_date || c.start_date) {
        const d = c.move_in_date || c.start_date;
        const parts = d.split('/');
        if (parts.length === 3) {
           const m = Number(parts[1]);
           const y = Number(parts[2]);
           const moveInTime = y * 12 + m;
           if (moveInTime <= selTime) {
              if (c.status === 'active' && isRoomOccupied()) include = true;
           }
        } else {
           if (c.status === 'active' && isRoomOccupied()) include = true;
        }
      } else {
        if (c.status === 'active' && isRoomOccupied()) include = true;
      }
      
      if (include) {
        grouped.set(c.id, {
          contract: c,
          payments: [],
          base_rent: 0,
          water_total: 0,
          surcharge_total: 0,
          electric_total: 0,
          deposit_collected: 0,
          total_revenue: 0,
          electric_old: c.start_electric || 0,
          electric_new: 0,
          electric_usage: 0,
          stayed_days: 0,
          notes: []
        });
      }
    });

    // 2. Process payments for the selected month
    targetPayments.forEach(p => {
      const contractId = p.contract_id || '';
      
      if (!grouped.has(contractId)) {
        const contract = data.contracts_all.find((c: any) => c.id === contractId);
        grouped.set(contractId, {
          contract: contract || {},
          payments: [],
          base_rent: 0,
          water_total: 0,
          surcharge_total: 0,
          electric_total: 0,
          deposit_collected: 0,
          electric_old: p.electric_old || p.old_electric || p['chỉ số điện cũ'] || (contract ? contract.start_electric : 0) || 0,
          electric_new: 0,
          electric_usage: 0,
          stayed_days: 0,
          notes: []
        });
      }

      const group = grouped.get(contractId);
      group.payments.push(p);
      
      const receiver = p.receiver || p['người nhận'] || '';
      
      if (receiver !== 'Chưa nhận') {
        const baseRent = Number(p.base_rent || p['tiền phòng']) || 0;
        const water = Number(p.water_total || p['nước sinh hoạt']) || 0;
        const surcharge = Number(p.surcharge_total || p['phí dịch vụ']) || 0;
        const electric = Number(p.electric_total || p['điện sinh hoạt']) || 0;
        let deposit = Number(p.deposit_amount || p.deposit_fee || p['tiền cọc']) || 0;
        const actualAmount = Number(p.amount || p.total_amount || p['số tiền']) || 0;
        
        const typeStr = String(p.payment_type || p.type || p['loại khoản thu'] || '').toLowerCase();
        if (deposit === 0 && typeStr.includes('cọc')) {
            deposit = actualAmount;
        }

        group.base_rent += baseRent;
        group.water_total += water;
        group.surcharge_total += surcharge;
        group.electric_total += electric;
        group.deposit_collected += deposit;
        group.total_revenue += actualAmount;
      }
      
      if (p.electric_new || p.new_electric || p['chỉ số điện mới']) {
        group.electric_old = p.electric_old || p.old_electric || p['chỉ số điện cũ'] || group.electric_old;
        group.electric_new = p.electric_new || p.new_electric || p['chỉ số điện mới'] || group.electric_new;
        group.electric_usage = p.electric_usage || p['số điện tiêu thụ'] || group.electric_usage;
      }

      if (p.stayed_days !== undefined || p.days_stayed !== undefined || p['số ngày ở'] !== undefined) {
          group.stayed_days = Number(p.stayed_days || p.days_stayed || p['số ngày ở']) || 0;
      }

      if (p.note) group.notes.push(p.note);
    });

    const rows = Array.from(grouped.entries()).map(([contractId, group], index) => {
      const contract = group.contract || {};
      const roomId = contract.room_id || '';
      const roomStr = String(roomId);
      const floor = roomStr ? roomStr.charAt(0) : '';

      // Calculate days in month if missing
      let stayedDays = group.stayed_days;
      if (!stayedDays || stayedDays === 0) {
        if (contract.move_in_date) {
            const parts = selectedPeriod.split('/');
            const month = Number(parts[0]);
            const year = Number(parts[1]);
            const lastDay = new Date(year, month, 0).getDate();
            
            // Check if move_in_date is in the reporting month
            const miParts = contract.move_in_date.split('/'); // DD/MM/YYYY
            if (miParts.length === 3 && Number(miParts[1]) === month && Number(miParts[2]) === year) {
                stayedDays = lastDay - Number(miParts[0]) + 1;
            } else {
                stayedDays = lastDay;
            }
        } else {
             const parts = selectedPeriod.split('/');
             stayedDays = new Date(Number(parts[1]), Number(parts[0]), 0).getDate();
        }
      }

      const noteStr = [contract.note, ...group.notes].filter(Boolean).join('; ');

      return {
        stt: index + 1,
        contract_id: contractId,
        move_in_date: contract.move_in_date || '',
        floor: floor,
        room_id: roomId,
        duration: contract.duration || '',
        stayed_days: stayedDays,
        deposit_paid: group.deposit_collected,
        rent: Number(contract.rent) || 0,
        base_rent: group.base_rent,
        water_total: group.water_total,
        surcharge_total: group.surcharge_total,
        electric_total: group.electric_total,
        electric_old: group.electric_old,
        electric_new: group.electric_new,
        electric_usage: group.electric_usage,
        total_revenue: group.total_revenue,
        note: noteStr
      };
    });

    // Sort by floor then room
    rows.sort((a, b) => {
      if (a.floor !== b.floor) return a.floor.localeCompare(b.floor);
      return String(a.room_id).localeCompare(String(b.room_id));
    });

    // Recalculate STT
    return rows.map((r, i) => ({ ...r, stt: i + 1 }));

  }, [data, selectedPeriod]);

  // Apply search filter
  const filteredReportData = useMemo(() => {
    if (!searchTerm) return reportData;
    const lower = searchTerm.toLowerCase();
    return reportData.filter(r => 
      String(r.room_id).toLowerCase().includes(lower) || 
      String(r.contract_id).toLowerCase().includes(lower)
    );
  }, [reportData, searchTerm]);

  const grandTotal = filteredReportData.reduce((sum, row) => sum + row.total_revenue, 0);
  const grandDeposit = filteredReportData.reduce((sum, row) => sum + row.deposit_paid, 0);

  const periodExpenses = useMemo(() => {
    if (!data?.expenses || !selectedPeriod) return [];
    
    const target = normalizePeriod(selectedPeriod);

    return data.expenses.filter(e => {
      return normalizePeriod(e.period) === target;
    });
  }, [data, selectedPeriod]);

  const handleExportCSV = () => {
    const headers = [
      'STT', 'Ngày ký HĐ', 'Tầng', 'Phòng', 'TG thuê (Tháng)', 'Số ngày ở', 
      'Cọc', 'Giá cho thuê', 'Giá TT thực tế (i)', 'Nước (k)', 'Phí DV (l)', 
      'CSĐ đầu', 'CSĐ cuối', 'Tổng số điện', 'Điện (m)', 
      'Tổng doanh thu', 'Ghi chú'
    ];
    
    const rows = filteredReportData.map(r => [
      r.stt, r.move_in_date, r.floor, r.room_id, r.duration, r.stayed_days,
      r.deposit_paid, r.rent, r.base_rent, r.water_total, r.surcharge_total,
      r.electric_old, r.electric_new, r.electric_usage, r.electric_total,
      r.total_revenue, `"${r.note.replace(/"/g, '""')}"`
    ]);

    // Add Grand Total row
    rows.push([
      '', '', '', '', '', 'TỔNG CỘNG', grandDeposit, '', '', '', '', '', '', '',
      'TỔNG DOANH THU', grandTotal, ''
    ]);

    const headerLines = [
      'Phương Nam Apartment',
      'Tòa nhà Căn hộ Dịch vụ & Cho thuê',
      '',
      'BÁO CÁO KINH DOANH',
      `Kỳ thanh toán: ${selectedPeriod}`,
      ''
    ].map(line => `"${line}"`);

    let csvContent = "\uFEFF" + headerLines.join('\n') + '\n' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

    // ── Append Expenses section ──
    if (periodExpenses.length > 0) {
      const directExp = periodExpenses.filter(e => e.is_reimbursement !== true && e.is_reimbursement !== 'true');
      const reimbExp = periodExpenses.filter(e => e.is_reimbursement === true || e.is_reimbursement === 'true');

      csvContent += '\n\n';
      csvContent += `"CHI PHÍ PHÁT SINH THÁNG ${selectedPeriod}"\n\n`;

      if (directExp.length > 0) {
        csvContent += '"Chi phí trực tiếp (Chủ nhà thanh toán)"\n';
        csvContent += 'STT,Ngày,Loại,Số tiền,Ghi chú\n';
        directExp.forEach((e, i) => {
          csvContent += `${i + 1},${e.expense_date},${e.expense_type},${Number(e.amount) || 0},"${(e.note || '').replace(/"/g, '""')}"\n`;
        });
        const totalDirect = directExp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        csvContent += `,,TỔNG CHI TRỰC TIẾP,${totalDirect},\n`;
      }

      if (reimbExp.length > 0) {
        csvContent += '\n"Chi hộ chủ nhà (Cần hoàn trả)"\n';
        csvContent += 'STT,Ngày,Loại,Số tiền,Người chi hộ,Hoàn trả,Ngày hoàn trả,Ghi chú\n';
        reimbExp.forEach((e, i) => {
          const reimbursed = e.reimbursed === true || e.reimbursed === 'true';
          csvContent += `${i + 1},${e.expense_date},${e.expense_type},${Number(e.amount) || 0},${e.paid_by || ''},${reimbursed ? 'Đã trả' : 'Chưa trả'},${e.reimbursed_at || ''},"${(e.note || '').replace(/"/g, '""')}"\n`;
        });
        const totalReimb = reimbExp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        csvContent += `,,TỔNG CHI HỘ,${totalReimb},,,,\n`;
      }

      const grandExpense = periodExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      csvContent += `\n,,TỔNG CHI PHÍ THÁNG ${selectedPeriod.split('/')[0]},${grandExpense},,,,\n`;
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `bao_cao_kinh_doanh_${selectedPeriod.replace('/', '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintPDF = () => {
    window.print();
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <h2 className="text-xl font-bold text-slate-800">Báo cáo kinh doanh</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select 
            value={selectedPeriod} 
            onChange={e => setSelectedPeriod(e.target.value)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none cursor-pointer"
          >
            <option value="">-- Chọn Kỳ --</option>
            {availablePeriods.map(p => (
              <option key={p} value={p}>Kỳ: {p}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Tìm phòng..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)}
              className="w-48 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" 
            />
          </div>
          <button 
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            <FileDown size={18} /> Excel/CSV
          </button>
          <button 
            onClick={handlePrintPDF}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-indigo-100"
          >
            <Printer size={18} /> Xuất PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        <div className="p-4 border-b border-slate-100 hidden print:block mb-6 relative">
          <div className="absolute top-4 left-4 text-left">
            <h2 className="font-bold uppercase text-sm">Phương Nam Apartment</h2>
          </div>
          <div className="text-center pt-8">
            <h1 className="text-2xl font-bold uppercase">Báo Cáo Kinh Doanh</h1>
            <p className="text-lg mt-2">Kỳ thanh toán: {selectedPeriod}</p>
          </div>
        </div>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full print:w-full text-left text-sm border-separate border-spacing-0 print:border-collapse print:text-[11px]">
            <thead className="bg-slate-50 text-slate-600 print:bg-white print:text-black">
              <tr>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black whitespace-nowrap text-center">STT</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black whitespace-nowrap">Ngày ký HĐ</th>
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-center">Tầng</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black">Phòng</th>
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-center whitespace-nowrap">Thời gian<br/><span className="text-[10px] font-normal">(tháng)</span></th>
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-center whitespace-nowrap">Số ngày ở</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right">Cọc</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right">Giá cho thuê</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Thực tế (i)</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Nước (k)</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Phí DV (l)</th>
                
                {/* Điện (m) có 3 cột nhỏ: CSĐ đầu, CSĐ cuối, Tổng số điện, Điện */}
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-right text-[10px]">CSĐ đầu</th>
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-right text-[10px]">CSĐ cuối</th>
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-right text-[10px]">Tiêu thụ</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Điện (m)</th>
                
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap text-indigo-700 print:text-black">Tổng doanh thu</th>
                <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black min-w-[150px]">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-black">
              {filteredReportData.map((r, idx) => (
                <motion.tr key={r.contract_id + idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-center text-slate-500 print:border-b print:border-slate-300">{r.stt}</td>
                  <td className="px-3 py-2 whitespace-nowrap print:border-b print:border-slate-300">{r.move_in_date}</td>
                  <td className="px-2 py-2 text-center font-medium text-slate-500 print:border-b print:border-slate-300">{r.floor}</td>
                  <td className="px-3 py-2 font-bold text-slate-800 print:border-b print:border-slate-300">{r.room_id}</td>
                  <td className="px-2 py-2 text-center text-slate-600 print:border-b print:border-slate-300">{r.duration}</td>
                  <td className="px-2 py-2 text-center text-slate-600 print:border-b print:border-slate-300">{r.stayed_days}</td>
                  <td className="px-3 py-2 text-right text-slate-600 print:border-b print:border-slate-300">{formatVND(r.deposit_paid)}</td>
                  <td className="px-3 py-2 text-right text-slate-600 print:border-b print:border-slate-300">{formatVND(r.rent)}</td>
                  <td className="px-3 py-2 text-right font-medium text-emerald-600 print:border-b print:border-slate-300 print:text-black">{formatVND(r.base_rent)}</td>
                  <td className="px-3 py-2 text-right text-blue-600 print:border-b print:border-slate-300 print:text-black">{formatVND(r.water_total)}</td>
                  <td className="px-3 py-2 text-right text-amber-600 print:border-b print:border-slate-300 print:text-black">{formatVND(r.surcharge_total)}</td>
                  <td className="px-2 py-2 text-right text-slate-500 text-xs print:border-b print:border-slate-300">{r.electric_old}</td>
                  <td className="px-2 py-2 text-right text-slate-500 text-xs print:border-b print:border-slate-300">{r.electric_new}</td>
                  <td className="px-2 py-2 text-right text-slate-700 font-medium text-xs print:border-b print:border-slate-300">{r.electric_usage}</td>
                  <td className="px-3 py-2 text-right text-rose-600 print:border-b print:border-slate-300 print:text-black">{formatVND(r.electric_total)}</td>
                  <td className="px-3 py-2 text-right font-bold text-indigo-600 print:border-b print:border-slate-300 print:text-black">{formatVND(r.total_revenue)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 max-w-[200px] truncate print:whitespace-normal print:border-b print:border-slate-300" title={r.note}>{r.note || '—'}</td>
                </motion.tr>
              ))}
              {filteredReportData.length === 0 && (
                <tr>
                  <td colSpan={17} className="px-4 py-8 text-center text-slate-400 print:border-b print:border-slate-300">
                    {selectedPeriod ? `Không có dữ liệu cho kỳ ${selectedPeriod}` : 'Chọn Kỳ thanh toán để xem báo cáo kinh doanh'}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-slate-50 font-bold text-slate-800 print:bg-white print:border-t-2 print:border-black">
              <tr>
                <td colSpan={6} className="px-4 py-4 text-right uppercase text-slate-700 print:text-black">
                  TỔNG CỌC
                </td>
                <td className="px-3 py-4 text-right text-slate-700 print:text-black whitespace-nowrap">
                  {formatVND(grandDeposit)}
                </td>
                <td colSpan={8} className="px-4 py-4 text-right uppercase text-indigo-700 print:text-black">
                  TỔNG DOANH THU THÁNG {selectedPeriod.split('/')[0]}
                </td>
                <td className="px-3 py-4 text-right text-lg text-indigo-700 print:text-black whitespace-nowrap">
                  {formatVND(grandTotal)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Expense Report Table (Page 2 when printing) ── */}
      {selectedPeriod && (
        <ExpenseReportSection data={data} selectedPeriod={selectedPeriod} />
      )}

      <style>{`
        @media print {
          @page { size: landscape; margin: 1cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 4px; font-size: 10pt; }
          th { background-color: #f3f4f6 !important; }
          .expense-report-page { page-break-before: always; }
        }
      `}</style>
    </div>
  );
}

/* ── Expense Report Sub-component ── */

function ExpenseReportSection({ data, selectedPeriod }: { data: DashboardData | null; selectedPeriod: string }) {
  const expenses = useMemo(() => {
    if (!data?.expenses || !selectedPeriod) return [];
    
    const target = normalizePeriod(selectedPeriod);

    return data.expenses.filter(e => {
      return normalizePeriod(e.period) === target;
    });
  }, [data, selectedPeriod]);

  // On screen, show a message if empty. In print, hide if empty.
  if (expenses.length === 0) {
    return (
      <div className="mt-6 p-8 border-2 border-dashed border-slate-200 rounded-2xl text-center text-slate-400 print:hidden">
        Không có dữ liệu chi phí cho kỳ {selectedPeriod} để hiển thị trong báo cáo.
      </div>
    );
  }

  const directExpenses = expenses.filter(e => e.is_reimbursement !== true && e.is_reimbursement !== 'true');
  const reimbExpenses = expenses.filter(e => e.is_reimbursement === true || e.is_reimbursement === 'true');
  const totalDirect = directExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalReimb = reimbExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const grandExpense = totalDirect + totalReimb;

  return (
    <div className="expense-report-page bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:shadow-none print:border-none print:rounded-none mt-6 print:mt-0 print:block">
      {/* Print Header */}
      <div className="p-4 border-b border-slate-100 hidden print:block mb-4 relative">
        <div className="absolute top-4 left-4 text-left">
          <h2 className="font-bold uppercase text-xs">Phương Nam Apartment</h2>
        </div>
        <div className="text-center pt-6">
          <h1 className="text-xl font-bold uppercase">Bảng Kê Chi Phí Phát Sinh</h1>
          <p className="text-sm mt-1">Kỳ thanh toán: {selectedPeriod}</p>
        </div>
      </div>

      {/* Screen Header */}
      <div className="p-4 border-b border-slate-100 print:hidden bg-slate-50/50">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className="w-1.5 h-6 bg-indigo-500 rounded-full"></span>
          Chi phí phát sinh tháng {selectedPeriod}
          <span className="ml-2 text-xs font-normal text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm">Trang 2 khi in PDF</span>
        </h3>
      </div>

      <div className="overflow-x-auto print:overflow-visible p-4">
        {/* Direct Expenses */}
        {directExpenses.length > 0 ? (
          <div className="mb-8">
            <h4 className="mb-3 text-sm font-bold text-slate-700 uppercase print:text-black flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 print:hidden"></div>
              1. Chi phí trực tiếp (Chủ nhà thanh toán)
            </h4>
            <table className="w-full text-left text-sm border-collapse print:text-[10pt]">
              <thead className="bg-slate-50 text-slate-600 print:bg-slate-100 print:text-black">
                <tr>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-center w-12">STT</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ngày</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Loại chi phí</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-right">Số tiền</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {directExpenses.map((e, i) => (
                  <tr key={e.id || i} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 text-center text-slate-500 border border-slate-200 print:border-slate-400">{i + 1}</td>
                    <td className="px-4 py-2 border border-slate-200 print:border-slate-400">{e.expense_date}</td>
                    <td className="px-4 py-2 font-medium border border-slate-200 print:border-slate-400">{e.expense_type}</td>
                    <td className="px-4 py-2 text-right font-semibold border border-slate-200 print:border-slate-400">{formatVND(e.amount)}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 border border-slate-200 print:border-slate-400">{e.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-bold print:bg-white">
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 uppercase text-xs">Cộng chi phí trực tiếp</td>
                  <td className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 text-indigo-700 print:text-black">{formatVND(totalDirect)}</td>
                  <td className="border border-slate-200 print:border-slate-400"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-slate-50 rounded-xl text-slate-400 text-sm italic print:hidden">Không có chi phí trực tiếp.</div>
        )}

        {/* Reimbursement Expenses */}
        {reimbExpenses.length > 0 ? (
          <div className="mb-8">
            <h4 className="mb-3 text-sm font-bold text-slate-700 uppercase print:text-black flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 print:hidden"></div>
              2. Các khoản chi hộ (Cần hoàn trả)
            </h4>
            <table className="w-full text-left text-sm border-collapse print:text-[10pt]">
              <thead className="bg-slate-50 text-slate-600 print:bg-slate-100 print:text-black">
                <tr>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-center w-12">STT</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ngày chi</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Nội dung</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-right">Số tiền</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Người chi</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-center">Tình trạng</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ngày trả</th>
                </tr>
              </thead>
              <tbody>
                {reimbExpenses.map((e, i) => {
                  const reimbursed = e.reimbursed === true || e.reimbursed === 'true';
                  return (
                    <tr key={e.id || i} className="hover:bg-slate-50/50">
                      <td className="px-4 py-2 text-center text-slate-500 border border-slate-200 print:border-slate-400">{i + 1}</td>
                      <td className="px-4 py-2 border border-slate-200 print:border-slate-400">{e.expense_date}</td>
                      <td className="px-4 py-2 font-medium border border-slate-200 print:border-slate-400">{e.expense_type}</td>
                      <td className="px-4 py-2 text-right font-semibold border border-slate-200 print:border-slate-400">{formatVND(e.amount)}</td>
                      <td className="px-4 py-2 border border-slate-200 print:border-slate-400">{e.paid_by || '—'}</td>
                      <td className="px-4 py-2 text-center border border-slate-200 print:border-slate-400">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${reimbursed ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                          {reimbursed ? 'Đã trả' : 'Chưa trả'}
                        </span>
                      </td>
                      <td className="px-4 py-2 border border-slate-200 print:border-slate-400">{e.reimbursed_at || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 font-bold print:bg-white">
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 uppercase text-xs">Cộng chi hộ</td>
                  <td className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 text-amber-700 print:text-black">{formatVND(totalReimb)}</td>
                  <td colSpan={3} className="border border-slate-200 print:border-slate-400"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-slate-50 rounded-xl text-slate-400 text-sm italic print:hidden">Không có khoản chi hộ.</div>
        )}

        {/* Grand Total for Expenses */}
        <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl flex justify-between items-center print:bg-white print:border-slate-400 print:rounded-none print:mt-2">
          <span className="text-sm font-bold uppercase text-indigo-900 print:text-black">Tổng cộng chi phí phát sinh tháng {selectedPeriod.split('/')[0]}</span>
          <span className="text-xl font-black text-indigo-700 print:text-black">{formatVND(grandExpense)}</span>
        </div>

        {/* Signature Area for Print */}
        <div className="hidden print:grid grid-cols-2 mt-12 text-center gap-12">
          <div>
            <p className="font-bold">Người lập bảng</p>
            <p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p>
          </div>
          <div>
            <p className="font-bold">Chủ nhà xác nhận</p>
            <p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
