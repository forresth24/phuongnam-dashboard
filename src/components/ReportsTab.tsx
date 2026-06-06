import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { FileDown, Printer, Search } from 'lucide-react';
import type { AppConfig, DashboardData } from '../lib/api';
import { formatVND as originalFormatVND } from '../lib/payment-utils';
const formatVND = (amount: number) => originalFormatVND(amount, false);

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

export const safeParseNumber = (val: any): number => {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleanStr = String(val).replace(/[^0-9-]/g, '');
  const num = parseInt(cleanStr, 10);
  return isNaN(num) ? 0 : num;
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
  const [fromDatetime, setFromDatetime] = useState('');
  const [toDatetime, setToDatetime] = useState('');
  const [showToCustom, setShowToCustom] = useState(false);
  const [timeRangeId, setTimeRangeId] = useState(0); // >0 = trigger time range report

  // Extract all available periods from payments
  const availablePeriods = useMemo(() => {
    if (!data) return [];
    const periods = new Set<string>();
    data.payments.forEach(p => {
      let period = p.payment_period;
      if (!period && p.received_date) {
        period = p.received_date;
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

  /* ── Helper: parse payment datetime for time range filter ── */
  const getPaymentTime = (p: any): Date | null => {
    for (const field of ['updated_at', 'completed_date', 'received_date', 'date']) {
      const v = p[field];
      if (!v) continue;
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
      // Try DD/MM/YYYY HH:mm:ss format
      if (typeof v === 'string' && v.includes('/')) {
        const m = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (m) {
          const d2 = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
          if (!isNaN(d2.getTime())) return d2;
        }
      }
    }
    return null;
  };

  const reportData = useMemo(() => {
    if (!data) return [];
    const usePeriod = !!selectedPeriod;
    const useTimeRange = timeRangeId > 0 && !!fromDatetime;
    if (!usePeriod && !useTimeRange) return [];

    // 1. Filter payments
    let targetPayments = data.payments;

    if (usePeriod) {
      targetPayments = targetPayments.filter(p => {
        let period = p.payment_period;
        if (!period && p.received_date) {
          period = p.received_date;
        }
        return normalizePeriod(period) === normalizePeriod(selectedPeriod);
      });
    }

    if (useTimeRange) {
      const fromTime = fromDatetime ? new Date(fromDatetime).getTime() : -Infinity;
      const toTime = toDatetime ? new Date(toDatetime).getTime() : new Date().getTime();
      targetPayments = targetPayments.filter(p => {
        const pt = getPaymentTime(p);
        return pt && pt.getTime() >= fromTime && pt.getTime() <= toTime;
      });
    }

    // 2. Determine period for contract matching
    let selMonth, selYear;
    if (usePeriod) {
      const parts = selectedPeriod.split('/');
      selMonth = Number(parts[0]);
      selYear = Number(parts[1]);
    } else if (useTimeRange && fromDatetime) {
      const fd = new Date(fromDatetime);
      selMonth = fd.getMonth() + 1;
      selYear = fd.getFullYear();
    } else {
      selMonth = new Date().getMonth() + 1;
      selYear = new Date().getFullYear();
    }
    const selTime = selYear * 12 + selMonth;

    // Group by contract_id
    const grouped = new Map<string, any>();

    // 1. Initialize grouped with all contracts active in the period
    //    (skip for time range — chỉ hiện contract có payment trong khoảng)
    if (usePeriod) {
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
          notes: []
        });
      }
    });
    }

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
          total_revenue: 0,
          electric_old: p.old_electric || (contract ? contract.start_electric : 0) || 0,
          electric_new: 0,
          electric_usage: 0,
          notes: []
        });
      }

      const group = grouped.get(contractId);
      group.payments.push(p);
      
      const receiver = p.receiver || '';
      
      if (receiver !== 'Chưa nhận') {
        let baseRent = safeParseNumber(p.base_rent);
        const water = safeParseNumber(p.water_total);
        const surcharge = safeParseNumber(p.surcharge_total);
        const electric = safeParseNumber(p.electric_total);
        let deposit = safeParseNumber(p.deposit_fee);
        const actualAmount = safeParseNumber(p.amount);

        if (baseRent === 0 && actualAmount > 0) {
          baseRent = Math.max(0, actualAmount - water - surcharge - electric);
        }
        
        const typeStr = String(p.payment_type || '').toLowerCase();
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
      
      if (p.new_electric) {
        group.electric_old = p.old_electric || group.electric_old;
        group.electric_new = p.new_electric || group.electric_new;
        group.electric_usage = p.electric_usage || group.electric_usage;
      }

      const typeStr = String(p.payment_type || '').toLowerCase();
      if (typeStr.includes('cọc')) {
        if (!group.notes.includes('Tiền cọc')) {
          group.notes.push('Tiền cọc');
        }
      }
      if (p.note) {
        const noteClean = String(p.note).trim();
        if (noteClean && !group.notes.includes(noteClean)) {
          group.notes.push(noteClean);
        }
      }
    });

    const rows = Array.from(grouped.entries()).map(([contractId, group], index) => {
      const contract = group.contract || {};
      const roomId = contract.room_id || '';
      const roomStr = String(roomId);
      const floor = roomStr ? roomStr.charAt(0) : '';

      // Determine payment bucket
      // receiver === 'Chưa nhận' → có payment nhưng chưa thanh toán
      // ngược lại: status === 'Hoàn thành' → đã tới chủ nhà, else → chưa tới chủ nhà
      const paidPayments = group.payments.filter((p: any) => p.receiver && p.receiver !== 'Chưa nhận');
      const hasCompleted = paidPayments.some((p: any) => p.status === 'Hoàn thành');
      const hasPending = paidPayments.some((p: any) => p.status !== 'Hoàn thành');
      const bucket = hasCompleted ? 'completed' : hasPending ? 'pending_landlord' : 'unpaid';

      const noteStr = [contract.note, ...group.notes].filter(Boolean).join('; ');

      const isDepositOnly = group.payments.length > 0 && group.payments.every(
        (p: any) => String(p.payment_type || '').toLowerCase().includes('cọc')
      );

      return {
        stt: index + 1,
        contract_id: contractId,
        move_in_date: contract.move_in_date || '',
        floor: floor,
        room_id: roomId,
        duration: contract.duration || '',
        bucket,
        isDepositOnly,
        rent: safeParseNumber(contract.rent) + safeParseNumber(contract.extra_person_fee),
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

  }, [data, selectedPeriod, timeRangeId, fromDatetime, toDatetime]);
  const filteredReportData = useMemo(() => {
    if (!searchTerm) return reportData;
    const lower = searchTerm.toLowerCase();
    return reportData.filter(r => 
      String(r.room_id).toLowerCase().includes(lower) || 
      String(r.contract_id).toLowerCase().includes(lower)
    );
  }, [reportData, searchTerm]);

  const grandTotalRevenue = filteredReportData.reduce((sum, row) => sum + row.total_revenue, 0);
  const grandWater = filteredReportData.reduce((sum, row) => sum + row.water_total, 0);
  const grandSurcharge = filteredReportData.reduce((sum, row) => sum + row.surcharge_total, 0);
  const grandElectricUsage = filteredReportData.reduce((sum, row) => sum + row.electric_usage, 0);
  const grandElectric = filteredReportData.reduce((sum, row) => sum + row.electric_total, 0);

  const periodLabel = selectedPeriod ? ` cho kỳ ${selectedPeriod}` : timeRangeId > 0 && fromDatetime ? ' trong mốc thời gian đã chọn' : '';

  const periodExpenses = useMemo(() => {
    if (!data?.expenses || !selectedPeriod) return [];
    
    const target = normalizePeriod(selectedPeriod);

    return data.expenses.filter(e => {
      return normalizePeriod(e.period) === target;
    });
  }, [data, selectedPeriod]);

  const handleExportCSV = () => {
    const headers = [
      'STT', 'Ngày ký HĐ', 'Tầng', 'Phòng', 'TG thuê (Tháng)',
      'Giá cho thuê (VND)', 'Nước (k) (VND)', 'Phí DV (l) (VND)',
      'CSĐ đầu', 'CSĐ cuối', 'Tổng số điện', 'Điện (m) (VND)',
      'Thành tiền (VND)'
    ];

    const rows = filteredReportData.map(r => [
      r.stt, r.move_in_date, r.floor, r.room_id, r.duration,
      r.rent, r.water_total, r.surcharge_total,
      r.electric_old, r.electric_new, r.electric_usage, r.electric_total,
      r.total_revenue
    ]);

    // Add Column Totals row
    rows.push([
      'TỔNG CỘNG', '', '', '', '',
      '',
      grandWater,
      grandSurcharge,
      '', '',
      grandElectricUsage,
      grandElectric,
      grandTotalRevenue
    ]);



    const headerLines = [
      'Phương Nam Apartment',
      'Tòa nhà Căn hộ Dịch vụ & Cho thuê',
      '',
      'BÁO CÁO KINH DOANH',
      selectedPeriod ? `Kỳ thanh toán: ${selectedPeriod}` : (fromDatetime ? `Từ: ${new Date(fromDatetime).toLocaleString('vi-VN')} → Đến: ${toDatetime ? new Date(toDatetime).toLocaleString('vi-VN') : 'Hiện tại'}` : ''),
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
          csvContent += `${i + 1},${e.expense_date},${e.expense_type},${safeParseNumber(e.amount)},"${(e.note || '').replace(/"/g, '""')}"\n`;
        });
        const totalDirect = directExp.reduce((s, e) => s + safeParseNumber(e.amount), 0);
        csvContent += `,,TỔNG CHI TRỰC TIẾP,${totalDirect},\n`;
      }

      if (reimbExp.length > 0) {
        csvContent += '\n"Chi hộ chủ nhà (Cần hoàn trả)"\n';
        csvContent += 'STT,Ngày,Loại,Số tiền,Người chi hộ,Hoàn trả,Ngày hoàn trả,Ghi chú\n';
        reimbExp.forEach((e, i) => {
          const reimbursed = e.reimbursed === true || e.reimbursed === 'true';
          csvContent += `${i + 1},${e.expense_date},${e.expense_type},${safeParseNumber(e.amount)},${e.paid_by || ''},${reimbursed ? 'Đã trả' : 'Chưa trả'},${e.reimbursed_at || ''},"${(e.note || '').replace(/"/g, '""')}"\n`;
        });
        const totalReimb = reimbExp.reduce((s, e) => s + safeParseNumber(e.amount), 0);
        csvContent += `,,TỔNG CHI HỘ,${totalReimb},,,,\n`;
      }

      const grandExpense = periodExpenses.reduce((s, e) => s + safeParseNumber(e.amount), 0);
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
          <select id="select-report-period" name="period"
            value={selectedPeriod}
            onChange={e => { setSelectedPeriod(e.target.value); setTimeRangeId(0); }}
            className={`px-4 py-2 border rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none cursor-pointer ${fromDatetime ? 'opacity-50' : 'bg-white border-slate-200 text-slate-700'}`}
          >
            <option value="">-- Chọn Kỳ --</option>
            {availablePeriods.map(p => (
              <option key={p} value={p}>Kỳ: {p}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="font-medium whitespace-nowrap">Từ:</span>
            <input type="datetime-local" value={fromDatetime}
              onChange={e => { setFromDatetime(e.target.value); setSelectedPeriod(''); setTimeRangeId(0); setShowToCustom(false); }}
              className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            <span className="font-medium">Đến:</span>
            {showToCustom ? (
              <input type="datetime-local" value={toDatetime}
                onChange={e => setToDatetime(e.target.value)}
                className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
            ) : (
              <span className="text-slate-700 font-medium px-2">Hiện tại</span>
            )}
            <button onClick={() => setShowToCustom(!showToCustom)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 border border-indigo-200 rounded-lg hover:bg-indigo-50">
              {showToCustom ? 'Mặc định' : 'Chọn'}
            </button>
            {fromDatetime && (
              <button onClick={() => {
                setFromDatetime(''); setToDatetime(''); setTimeRangeId(0); setShowToCustom(false);
              }}
                className="text-xs text-red-500 hover:text-red-700 font-medium">Xoá</button>
            )}
            {fromDatetime && (
              <button onClick={() => setTimeRangeId(prev => prev + 1)}
                className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shadow-sm">
                ▶ Xuất báo cáo
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input id="input-report-search" name="search"
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
            <p className="text-lg mt-2">{selectedPeriod ? `Kỳ thanh toán: ${selectedPeriod}` : fromDatetime ? `Từ: ${new Date(fromDatetime).toLocaleString('vi-VN')}  →  Đến: ${toDatetime ? new Date(toDatetime).toLocaleString('vi-VN') : 'Hiện tại'}` : ''}</p>
          </div>
        </div>
        {/* ── 3 Tables by payment status ── */}
        {reportData.length > 0 ? (
          [
            { key: 'completed' as const, label: 'Đã thanh toán (đã tới chủ nhà)' },
            { key: 'pending_landlord' as const, label: 'Đã thanh toán (Chưa tới chủ nhà)' },
            { key: 'unpaid' as const, label: 'Chưa thanh toán' },
          ].map(({ key, label }) => {
            const bucketData = filteredReportData.filter(r => r.bucket === key);
            if (bucketData.length === 0) return null;

            const tTotalRevenue = bucketData.reduce((s, r) => s + r.total_revenue, 0);
            const tWater = bucketData.reduce((s, r) => s + r.water_total, 0);
            const tSurcharge = bucketData.reduce((s, r) => s + r.surcharge_total, 0);
            const tElectricUsage = bucketData.reduce((s, r) => s + r.electric_usage, 0);
            const tElectric = bucketData.reduce((s, r) => s + r.electric_total, 0);

            const headerClass = key === 'completed' ? 'text-emerald-700'
              : key === 'pending_landlord' ? 'text-amber-700'
              : 'text-red-700';

            return (
              <div key={key} className="mb-8 last:mb-0">
                <h3 className={`text-base font-bold px-4 pt-4 pb-2 ${headerClass} print:text-black`}>
                  {label}
                </h3>
                <div className="overflow-x-auto print:overflow-visible">
                  <table className="w-full print:w-full text-left text-sm border-separate border-spacing-0 print:border-collapse print:text-[11px]">
                    <thead className="bg-slate-50 text-slate-600 print:bg-white print:text-black">
                      <tr>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black whitespace-nowrap text-center">STT</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black whitespace-nowrap print:hidden">Ngày ký HĐ</th>
                        <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-center print:hidden">Tầng</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black">Phòng</th>
                        <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-center whitespace-nowrap">Thời hạn<br/><span className="text-[10px] font-normal">(tháng)</span></th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right">Giá cho thuê (VND)</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Nước (k) (VND)</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Phí DV (l) (VND)</th>
                        <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-right text-[10px]">CSĐ đầu</th>
                        <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-right text-[10px]">CSĐ cuối</th>
                        <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-right text-[10px]">Tiêu thụ</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap">Điện (m) (VND)</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black text-right whitespace-nowrap text-indigo-700 print:text-black">Thành tiền (VND)</th>
                        <th className="px-3 py-3 font-semibold border-b border-slate-200 print:border-black min-w-[150px]">Ghi chú</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 print:divide-black">
                      {bucketData.map((r, idx) => (
                        <motion.tr key={r.contract_id + idx} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 text-center text-slate-500 print:border-b print:border-slate-300">{idx + 1}</td>
                          <td className="px-3 py-2 whitespace-nowrap print:border-b print:border-slate-300 print:hidden">{r.move_in_date}</td>
                          <td className="px-2 py-2 text-center font-medium text-slate-500 print:border-b print:border-slate-300 print:hidden">{r.floor}</td>
                          <td className="px-3 py-2 font-bold text-slate-800 print:border-b print:border-slate-300">{r.room_id}</td>
                          <td className="px-2 py-2 text-center text-slate-600 print:border-b print:border-slate-300">{r.duration}</td>
                          <td className="px-3 py-2 text-right text-slate-600 print:border-b print:border-slate-300">{r.isDepositOnly ? '—' : formatVND(r.rent)}</td>
                          <td className="px-3 py-2 text-right text-blue-600 print:border-b print:border-slate-300 print:text-black">{r.isDepositOnly ? '—' : formatVND(r.water_total)}</td>
                          <td className="px-3 py-2 text-right text-amber-600 print:border-b print:border-slate-300 print:text-black">{r.isDepositOnly ? '—' : formatVND(r.surcharge_total)}</td>
                          <td className="px-2 py-2 text-right text-slate-500 text-xs print:border-b print:border-slate-300">{r.isDepositOnly ? '—' : r.electric_old}</td>
                          <td className="px-2 py-2 text-right text-slate-500 text-xs print:border-b print:border-slate-300">{r.isDepositOnly ? '—' : r.electric_new}</td>
                          <td className="px-2 py-2 text-right text-slate-700 font-medium text-xs print:border-b print:border-slate-300">{r.isDepositOnly ? '—' : r.electric_usage}</td>
                          <td className="px-3 py-2 text-right text-rose-600 print:border-b print:border-slate-300 print:text-black">{r.isDepositOnly ? '—' : formatVND(r.electric_total)}</td>
                          <td className="px-3 py-2 text-right font-bold text-indigo-600 print:border-b print:border-slate-300 print:text-black">{formatVND(r.total_revenue)}</td>
                          <td className="px-3 py-2 text-xs text-slate-500 max-w-[200px] truncate print:whitespace-normal print:border-b print:border-slate-300" title={r.note}>{r.note || '—'}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                    <tbody className="bg-slate-50 font-bold text-slate-800 print:bg-white print:border-t-2 print:border-black">
                      <tr className="border-t border-slate-200 print:border-black bg-slate-100/50 print:bg-white text-[11px] print:text-[10px]">
                        <td colSpan={5} className="px-3 py-3 text-right uppercase font-bold text-slate-600 print:hidden">
                          TỔNG CỘNG
                        </td>
                        <td colSpan={3} className="px-3 py-3 text-right uppercase font-bold text-slate-600 hidden print:table-cell">
                          TỔNG CỘNG
                        </td>
                        <td className="px-3 py-3 text-right text-slate-400 font-semibold whitespace-nowrap">—</td>
                        <td className="px-3 py-3 text-right font-bold text-blue-600 print:text-black whitespace-nowrap">{formatVND(tWater)}</td>
                        <td className="px-3 py-3 text-right font-bold text-amber-600 print:text-black whitespace-nowrap">{formatVND(tSurcharge)}</td>
                        <td className="px-2 py-3 text-right text-slate-400 font-semibold">—</td>
                        <td className="px-2 py-3 text-right text-slate-400 font-semibold">—</td>
                        <td className="px-2 py-3 text-right font-bold text-slate-700 print:text-black whitespace-nowrap">{tElectricUsage}</td>
                        <td className="px-3 py-3 text-right font-bold text-rose-600 print:text-black whitespace-nowrap">{formatVND(tElectric)}</td>
                        <td className="px-3 py-3 text-right font-black text-indigo-700 print:text-black whitespace-nowrap">{formatVND(tTotalRevenue)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-slate-400">
            {periodLabel ? `Không có dữ liệu${periodLabel}` : 'Chọn Kỳ hoặc mốc thời gian để xem báo cáo kinh doanh'}
          </div>
        )}
      </div>

      {/* ── Expense Report Table (Page 2 when printing) ── */}
      {selectedPeriod && (
        <ExpenseReportSection data={data} selectedPeriod={selectedPeriod} />
      )}

      {selectedPeriod && (
        <PayablesSection data={data} selectedPeriod={selectedPeriod} />
      )}

      <style>{`
        @media print {
          @page { size: portrait; margin: 0; }
          * { 
            color: #000 !important; 
          }
          body { 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
            background: white !important; 
            margin: 0 !important; 
            padding: 1.25cm !important;
            font-size: 23pt !important;
            line-height: 1.25 !important;
          }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          table { 
            width: 100% !important; 
            border-collapse: collapse !important; 
            border: 2px solid #000 !important;
            page-break-inside: auto !important;
          }
          tr {
            page-break-inside: avoid !important;
            page-break-after: auto !important;
          }
          thead {
            display: table-header-group !important;
          }
          th, td { 
            border: 2px solid #000 !important; 
            padding: 8px !important; 
            font-size: 22pt !important; 
            line-height: 1.25 !important;
            white-space: normal !important;
            word-break: break-word !important;
          }
          th { 
            background-color: #f3f4f6 !important; 
          }
          h1 { font-size: 34pt !important; font-weight: bold !important; line-height: 1.3 !important; }
          h2 { font-size: 29pt !important; font-weight: bold !important; line-height: 1.3 !important; }
          h3, h4 { font-size: 23pt !important; font-weight: bold !important; line-height: 1.3 !important; }
          .expense-report-page { page-break-before: auto !important; }
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
  const totalDirect = directExpenses.reduce((s, e) => s + safeParseNumber(e.amount), 0);
  const totalReimb = reimbExpenses.reduce((s, e) => s + safeParseNumber(e.amount), 0);
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
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-right">Số tiền (VND)</th>
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
              <tbody className="bg-slate-50 font-bold print:bg-white">
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 uppercase text-xs">Cộng chi phí trực tiếp</td>
                  <td className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 text-indigo-700 print:text-black">{formatVND(totalDirect)}</td>
                  <td className="border border-slate-200 print:border-slate-400"></td>
                </tr>
              </tbody>
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
              2. Các khoản chi hộ
            </h4>
            <table className="w-full text-left text-sm border-collapse print:text-[10pt]">
              <thead className="bg-slate-50 text-slate-600 print:bg-slate-100 print:text-black">
                <tr>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-center w-12">STT</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ngày chi</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Nội dung</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-right">Số tiền (VND)</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Người chi</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400 text-center">Tình trạng</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ngày trả</th>
                  <th className="px-4 py-2 font-semibold border border-slate-200 print:border-slate-400">Ghi chú</th>
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
                      <td className="px-4 py-2 text-xs text-slate-500 border border-slate-200 print:border-slate-400">{e.note || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tbody className="bg-slate-50 font-bold print:bg-white">
                <tr>
                  <td colSpan={3} className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 uppercase text-xs">Cộng chi hộ</td>
                  <td className="px-4 py-2 text-right border border-slate-200 print:border-slate-400 text-amber-700 print:text-black">{formatVND(totalReimb)}</td>
                  <td colSpan={4} className="border border-slate-200 print:border-slate-400"></td>
                </tr>
              </tbody>
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
        <div className="hidden print:grid grid-cols-3 mt-12 text-center gap-6">
          <div>
            <p className="font-bold">Người lập</p>
            <p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p>
          </div>
          <div>
            <p className="font-bold">Quản lý</p>
            <p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p>
          </div>
          <div>
            <p className="font-bold">Chủ đầu tư</p>
            <p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Payables Section ── */

function PayablesSection({ data, selectedPeriod }: { data: DashboardData | null; selectedPeriod: string }) {
  const periodPayables = useMemo(() => {
    if (!data?.payables || !selectedPeriod) return [];
    const [selMonth, selYear] = selectedPeriod.split('/').map(Number);
    return data.payables.filter((p: any) => {
      const createdAt = p.created_at || '';
      let pMonth = -1, pYear = -1;
      if (createdAt.includes('T')) {
        const datePart = createdAt.split('T')[0];
        const parts = datePart.split('-');
        if (parts.length === 3) { pYear = Number(parts[0]); pMonth = Number(parts[1]); }
      }
      if (pMonth === -1 && createdAt.includes('/')) {
        const parts = createdAt.split('/');
        if (parts.length === 3) { pMonth = Number(parts[1]); pYear = Number(parts[2]); }
      }
      return pMonth === selMonth && pYear === selYear;
    });
  }, [data, selectedPeriod]);

  if (periodPayables.length === 0) return null;

  const totalPayables = periodPayables.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:shadow-none print:border-none print:rounded-none mt-6">
      <div className="p-4 border-b border-slate-100 bg-red-50/30">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className="w-1.5 h-6 bg-red-500 rounded-full"></span>
          Khoản phải trả thực tế tháng {selectedPeriod}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold border-b border-slate-200">Phòng</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200">Khách thuê</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200 text-right">Số tiền (VND)</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200 text-center">Loại</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200 text-center">Trạng thái</th>
              <th className="px-4 py-3 font-semibold border-b border-slate-200">Ghi chú</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {periodPayables.map((p: any, idx: number) => {
              const isPaid = p.status === 'paid' || p.status === 'true';
              return (
                <tr key={p.id || idx} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-bold text-slate-800">{p.room_id}</td>
                  <td className="px-4 py-3 text-slate-700">{p.tenant}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">
                    {new Intl.NumberFormat('en-US').format(Number(p.amount) || 0)} VND
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                      {p.payable_type || 'Trả cọc'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {isPaid ? 'Đã trả' : 'Chưa trả'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate" title={p.note}>{p.note || '—'}</td>
                </tr>
              );
            })}
          </tbody>
          <tbody className="bg-red-50/50 font-bold">
            <tr>
              <td colSpan={2} className="px-4 py-3 text-right uppercase text-xs text-slate-600">Tổng khoản phải trả</td>
              <td className="px-4 py-3 text-right text-red-700">
                {new Intl.NumberFormat('en-US').format(totalPayables)} VND
              </td>
              <td colSpan={3}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
