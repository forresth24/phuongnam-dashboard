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
    const m = parts[1].padStart(2, '0');
    return `${m}/${parts[2]}`;
  } else if (parts.length === 2) {
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

// ── Helper: classify payment bucket ──
function classifyBucket(payments: any[]): 'completed' | 'pending_landlord' | 'unpaid' {
  const paid = payments.filter(p => p.receiver && p.receiver !== 'Chưa nhận');
  const hasCompleted = paid.some(p => p.status === 'Hoàn thành');
  const hasPending = paid.some(p => p.status !== 'Hoàn thành');
  return hasCompleted ? 'completed' : hasPending ? 'pending_landlord' : 'unpaid';
}

// ── Helper: parse payment datetime for time range filter ──
function getPaymentTime(p: any): Date | null {
  for (const field of ['updated_at', 'completed_date', 'received_date', 'date']) {
    const v = p[field];
    if (!v) continue;
    // ISO format (YYYY-MM-DD...) — parse directly
    if (typeof v === 'string' && !v.includes('/')) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d;
      continue;
    }
    // Vietnamese DD/MM/YYYY HH:mm:ss — parse via regex
    if (typeof v === 'string' && v.includes('/')) {
      const m = v.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
      if (m) {
        const d2 = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
        if (!isNaN(d2.getTime())) return d2;
      }
    }
  }
  return null;
}

// ── Helper: check if contract was active in a given month ──
function isContractActiveInMonth(c: any, year: number, month: number): boolean {
  const d = c.move_in_date || c.start_date;
  if (!d) return false;
  const parts = d.split('/');
  if (parts.length !== 3) return false;
  const moveInMonth = Number(parts[1]);
  const moveInYear = Number(parts[2]);
  if (isNaN(moveInMonth) || isNaN(moveInYear)) return false;
  const moveInTime = moveInYear * 12 + moveInMonth;
  const selTime = year * 12 + month;
  return moveInTime <= selTime;
}

export function ReportsTab({ data, loading }: Props) {
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const defaultPeriod = `${currentMonth.toString().padStart(2, '0')}/${currentYear}`;

  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const defaultFrom = `${currentYear}-01-01T00:00`;
  const [fromDatetime, setFromDatetime] = useState(defaultFrom);
  const [toDatetime, setToDatetime] = useState('');
  const [showToCustom, setShowToCustom] = useState(false);
  const [timeRangeId, setTimeRangeId] = useState(0); // >0 = trigger time range report

  // ── Available periods from payments ──
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

  // ── Compute report data ──
  const reportData = useMemo(() => {
    if (!data) return [];
    const usePeriod = !!selectedPeriod;
    const useTimeRange = timeRangeId > 0 && !!fromDatetime;
    if (!usePeriod && !useTimeRange) return [];

    // 1. Determine target month/year
    let selMonth: number, selYear: number;
    if (usePeriod) {
      const parts = selectedPeriod.split('/');
      selMonth = Number(parts[0]);
      selYear = Number(parts[1]);
    } else {
      const fd = new Date(fromDatetime);
      selMonth = fd.getMonth() + 1;
      selYear = fd.getFullYear();
    }

    // 2. Filter payments
    let targetPayments = data.payments;
    if (usePeriod) {
      targetPayments = targetPayments.filter(p => {
        let period = p.payment_period;
        if (!period && p.received_date) period = p.received_date;
        return normalizePeriod(period) === normalizePeriod(selectedPeriod);
      });
    } else {
      // time range
      const fromTime = fromDatetime ? new Date(fromDatetime).getTime() : -Infinity;
      const toTime = toDatetime ? new Date(toDatetime).getTime() : new Date().getTime();
      targetPayments = targetPayments.filter(p => {
        const pt = getPaymentTime(p);
        return pt && pt.getTime() >= fromTime && pt.getTime() <= toTime;
      });
    }

    // 3. Group by contract_id
    const grouped = new Map<string, any>();

    // For period mode: pre-populate with active contracts in the month
    if (usePeriod) {
      (data.contracts_all || []).forEach(c => {
        if (c.status === 'active' && isContractActiveInMonth(c, selYear, selMonth)) {
          const room = data.rooms.find(r => String(r.id) === String(c.room_id));
          if (room && room.status === 'occupied') {
            grouped.set(c.id, {
              contract: c,
              payments: [],
              water_total: 0,
              surcharge_total: 0,
              electric_total: 0,
              total_revenue: 0,
              electric_old: c.start_electric || 0,
              electric_new: 0,
              electric_usage: 0,
              notes: [],
            });
          }
        }
      });
    }

    // Process each payment into its group
    targetPayments.forEach(p => {
      const cid = p.contract_id || '';
      if (!grouped.has(cid)) {
        const contract = data.contracts_all.find(c => c.id === cid);
        grouped.set(cid, {
          contract: contract || {},
          payments: [],
          water_total: 0,
          surcharge_total: 0,
          electric_total: 0,
          total_revenue: 0,
          electric_old: p.old_electric || (contract ? contract.start_electric : 0) || 0,
          electric_new: 0,
          electric_usage: 0,
          notes: [],
        });
      }

      const g = grouped.get(cid);
      g.payments.push(p);

      // Sum revenue from all payments not marked 'Chưa nhận'
      if (p.receiver && p.receiver !== 'Chưa nhận') {
        g.water_total += safeParseNumber(p.water_total);
        g.surcharge_total += safeParseNumber(p.surcharge_total);
        g.electric_total += safeParseNumber(p.electric_total);
        g.total_revenue += safeParseNumber(p.amount);
      }

      // Electric readings
      if (p.new_electric) {
        g.electric_old = p.old_electric || g.electric_old;
        g.electric_new = p.new_electric || g.electric_new;
        g.electric_usage = p.electric_usage || g.electric_usage;
      }

      // Notes
      const pt = String(p.payment_type || '').toLowerCase();
      if (pt.includes('cọc') && !g.notes.includes('Tiền cọc')) {
        g.notes.push('Tiền cọc');
      }
      if (p.note) {
        const n = String(p.note).trim();
        if (n && !g.notes.includes(n)) g.notes.push(n);
      }
    });

    // 4. Convert groups to rows
    const rows = Array.from(grouped.entries()).map(([cid, g]) => {
      const contract = g.contract || {};
      const floor = String(contract.room_id || '').charAt(0);
      const noteStr = [contract.note, ...g.notes].filter(Boolean).join('; ');

      return {
        contract_id: cid,
        move_in_date: contract.move_in_date || '',
        floor,
        room_id: contract.room_id || '',
        duration: contract.duration || '',
        bucket: classifyBucket(g.payments),
        rent: safeParseNumber(contract.rent) + safeParseNumber(contract.extra_person_fee),
        water_total: g.water_total,
        surcharge_total: g.surcharge_total,
        electric_total: g.electric_total,
        electric_old: g.electric_old,
        electric_new: g.electric_new,
        electric_usage: g.electric_usage,
        total_revenue: g.total_revenue,
        note: noteStr,
      };
    });

    // 5. Sort by floor → room_id
    rows.sort((a, b) => {
      if (a.floor !== b.floor) return a.floor.localeCompare(b.floor);
      return String(a.room_id).localeCompare(String(b.room_id));
    });

    return rows.map((r, i) => ({ ...r, stt: i + 1 }));
  }, [data, selectedPeriod, timeRangeId, fromDatetime, toDatetime]);

  // ── Search filter ──
  const filteredReportData = useMemo(() => {
    if (!searchTerm) return reportData;
    const lower = searchTerm.toLowerCase();
    return reportData.filter(r =>
      String(r.room_id).toLowerCase().includes(lower) ||
      String(r.contract_id).toLowerCase().includes(lower)
    );
  }, [reportData, searchTerm]);

  // ── Grand totals ──
  const grandTotalRevenue = filteredReportData.reduce((s, r) => s + r.total_revenue, 0);
  const grandWater = filteredReportData.reduce((s, r) => s + r.water_total, 0);
  const grandSurcharge = filteredReportData.reduce((s, r) => s + r.surcharge_total, 0);
  const grandElectricUsage = filteredReportData.reduce((s, r) => s + r.electric_usage, 0);
  const grandElectric = filteredReportData.reduce((s, r) => s + r.electric_total, 0);

  const periodLabel = selectedPeriod
    ? ` cho kỳ ${selectedPeriod}`
    : timeRangeId > 0 && fromDatetime
    ? ' trong mốc thời gian đã chọn'
    : '';

  // ── Period expenses (for CSV) ──
  const periodExpenses = useMemo(() => {
    if (!data?.expenses || !selectedPeriod) return [];
    const target = normalizePeriod(selectedPeriod);
    return data.expenses.filter(e => normalizePeriod(e.period) === target);
  }, [data, selectedPeriod]);

  // ── CSV Export ──
  const handleExportCSV = () => {
    const headers = [
      'STT', 'Ngày ký HĐ', 'Tầng', 'Phòng', 'TG thuê (Tháng)',
      'Giá cho thuê (VND)', 'Nước (k) (VND)', 'Phí DV (l) (VND)',
      'CSĐ đầu', 'CSĐ cuối', 'Tổng số điện', 'Điện (m) (VND)',
      'Thành tiền (VND)',
    ];

    const csvRows = filteredReportData.map(r => [
      r.stt, r.move_in_date, r.floor, r.room_id, r.duration,
      r.rent, r.water_total, r.surcharge_total,
      r.electric_old, r.electric_new, r.electric_usage, r.electric_total,
      r.total_revenue,
    ]);

    csvRows.push([
      'TỔNG CỘNG', '', '', '', '', '',
      grandWater, grandSurcharge, '', '',
      grandElectricUsage, grandElectric, grandTotalRevenue,
    ]);

    const headerLines = [
      'Phương Nam Apartment',
      'Tòa nhà Căn hộ Dịch vụ & Cho thuê',
      '',
      'BÁO CÁO KINH DOANH',
      selectedPeriod
        ? `Kỳ thanh toán: ${selectedPeriod}`
        : fromDatetime
        ? `Từ: ${new Date(fromDatetime).toLocaleString('vi-VN')} → Đến: ${toDatetime ? new Date(toDatetime).toLocaleString('vi-VN') : 'Hiện tại'}`
        : '',
      '',
    ].map(line => `"${line}"`);

    let csvContent = "﻿" + headerLines.join('\n') + '\n'
      + [headers.join(','), ...csvRows.map(e => e.join(','))].join('\n');

    // Append expenses section
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
        csvContent += `,,TỔNG CHI TRỰC TIẾP,${directExp.reduce((s, e) => s + safeParseNumber(e.amount), 0)},\n`;
      }

      if (reimbExp.length > 0) {
        csvContent += '\n"Chi hộ chủ nhà (Cần hoàn trả)"\n';
        csvContent += 'STT,Ngày,Loại,Số tiền,Người chi hộ,Hoàn trả,Ngày hoàn trả,Ghi chú\n';
        reimbExp.forEach((e, i) => {
          const reimbursed = e.reimbursed === true || e.reimbursed === 'true';
          csvContent += `${i + 1},${e.expense_date},${e.expense_type},${safeParseNumber(e.amount)},${e.paid_by || ''},${reimbursed ? 'Đã trả' : 'Chưa trả'},${e.reimbursed_at || ''},"${(e.note || '').replace(/"/g, '""')}"\n`;
        });
        csvContent += `,,TỔNG CHI HỘ,${reimbExp.reduce((s, e) => s + safeParseNumber(e.amount), 0)},,,,\n`;
      }

      csvContent += `\n,,TỔNG CHI PHÍ THÁNG ${selectedPeriod.split('/')[0]},${periodExpenses.reduce((s, e) => s + safeParseNumber(e.amount), 0)},,,,\n`;
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

  // ── PDF Print ──
  const handlePrintPDF = () => {
    window.print();
  };

  // ── Loading state ──
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // ── Tables config ──
  const tableConfigs = [
    { key: 'completed' as const, label: 'Đã thanh toán (đã tới chủ nhà)', headerClass: 'text-emerald-700' },
    { key: 'pending_landlord' as const, label: 'Đã thanh toán (Chưa tới chủ nhà)', headerClass: 'text-amber-700' },
    { key: 'unpaid' as const, label: 'Chưa thanh toán', headerClass: 'text-red-700' },
  ];

  // ── Render a report table for a given bucket ──
  const renderTable = (key: typeof tableConfigs[number]['key'], label: string, headerClass: string) => {
    const bucketData = filteredReportData.filter(r => r.bucket === key);
    if (bucketData.length === 0) return null;

    const tTotalRevenue = bucketData.reduce((s, r) => s + r.total_revenue, 0);
    const tWater = bucketData.reduce((s, r) => s + r.water_total, 0);
    const tSurcharge = bucketData.reduce((s, r) => s + r.surcharge_total, 0);
    const tElectricUsage = bucketData.reduce((s, r) => s + r.electric_usage, 0);
    const tElectric = bucketData.reduce((s, r) => s + r.electric_total, 0);

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
                <th className="px-2 py-3 font-semibold border-b border-slate-200 print:border-black text-center whitespace-nowrap">Thời hạn<br /><span className="text-[10px] font-normal">(tháng)</span></th>
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
                  <td className="px-3 py-2 text-right text-slate-600 print:border-b print:border-slate-300">{formatVND(r.rent)}</td>
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
            </tbody>
            <tbody className="bg-slate-50 font-bold text-slate-800 print:bg-white print:border-t-2 print:border-black">
              <tr className="border-t border-slate-200 print:border-black bg-slate-100/50 print:bg-white text-[11px] print:text-[10px]">
                <td colSpan={5} className="px-3 py-3 text-right uppercase font-bold text-slate-600 print:hidden">TỔNG CỘNG</td>
                <td colSpan={3} className="px-3 py-3 text-right uppercase font-bold text-slate-600 hidden print:table-cell">TỔNG CỘNG</td>
                <td className="px-3 py-3 text-right text-slate-400 font-semibold whitespace-nowrap">—</td>
                <td className="px-3 py-3 text-right font-bold text-blue-600 print:text-black whitespace-nowrap">{formatVND(tWater)}</td>
                <td className="px-3 py-3 text-right font-bold text-amber-600 print:text-black whitespace-nowrap">{formatVND(tSurcharge)}</td>
                <td className="px-2 py-3 text-right text-slate-400 font-semibold">—</td>
                <td className="px-2 py-3 text-right text-slate-400 font-semibold">—</td>
                <td className="px-2 py-3 text-right font-bold text-slate-700 print:text-black whitespace-nowrap">{tElectricUsage}</td>
                <td className="px-3 py-3 text-right font-bold text-rose-600 print:text-black whitespace-nowrap">{formatVND(tElectric)}</td>
                <td className="px-3 py-3 text-right font-black text-indigo-700 print:text-black whitespace-nowrap">{formatVND(tTotalRevenue)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Render ──
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 print:hidden">
        <h2 className="text-xl font-bold text-slate-800">Báo cáo kinh doanh</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedPeriod}
            onChange={e => { setSelectedPeriod(e.target.value); setTimeRangeId(0); }}
            className={`px-4 py-2 border rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-400 focus:outline-none appearance-none cursor-pointer ${fromDatetime ? 'opacity-50' : 'bg-white border-slate-200 text-slate-700'}`}
          >
            <option value="">-- Chọn Kỳ --</option>
            {availablePeriods.map(p => (
              <option key={p} value={p}>Kỳ: {p}</option>
            ))}
          </select>

          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-medium whitespace-nowrap">Từ:</span>
            <input type="date"
              value={fromDatetime.split('T')[0] || ''}
              onChange={e => { setFromDatetime(e.target.value + 'T' + (fromDatetime.split('T')[1] || '00:00')); setSelectedPeriod(''); setTimeRangeId(0); setShowToCustom(false); }}
              className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none w-36" />
            <input type="time"
              value={fromDatetime.split('T')[1] || ''}
              onChange={e => { setFromDatetime((fromDatetime.split('T')[0] || '') + 'T' + e.target.value); }}
              className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none w-24" />

            <span className="font-medium">Đến:</span>
            {showToCustom ? (
              <>
                <input type="date"
                  value={toDatetime.split('T')[0] || ''}
                  onChange={e => setToDatetime(e.target.value + 'T' + (toDatetime.split('T')[1] || '23:59'))}
                  className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none w-36" />
                <input type="time"
                  value={toDatetime.split('T')[1] || ''}
                  onChange={e => setToDatetime((toDatetime.split('T')[0] || '') + 'T' + e.target.value)}
                  className="px-2 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none w-24" />
              </>
            ) : (
              <span className="text-slate-700 font-medium px-2">Hiện tại</span>
            )}
            <button onClick={() => setShowToCustom(!showToCustom)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 border border-indigo-200 rounded-lg hover:bg-indigo-50">
              {showToCustom ? 'Mặc định' : 'Chọn'}
            </button>
            {fromDatetime && (
              <button onClick={() => { setFromDatetime(''); setToDatetime(''); setTimeRangeId(0); setShowToCustom(false); }}
                className="text-xs text-red-500 hover:text-red-700 font-medium">Xoá</button>
            )}
            {fromDatetime && (
              <button onClick={() => setTimeRangeId(prev => prev + 1)}
                className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shadow-sm">▶ Xuất báo cáo</button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input type="text" placeholder="Tìm phòng..." value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-48 pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
          </div>
          <button onClick={handleExportCSV}
            className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors">
            <FileDown size={18} /> Excel/CSV
          </button>
          <button onClick={handlePrintPDF}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-colors shadow-sm shadow-indigo-100">
            <Printer size={18} /> Xuất PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        {/* Print header */}
        <div className="p-4 border-b border-slate-100 hidden print:block mb-6 relative">
          <div className="absolute top-4 left-4 text-left">
            <h2 className="font-bold uppercase text-sm">Phương Nam Apartment</h2>
          </div>
          <div className="text-center pt-8">
            <h1 className="text-2xl font-bold uppercase">Báo Cáo Kinh Doanh</h1>
            <p className="text-lg mt-2">
              {selectedPeriod
                ? `Kỳ thanh toán: ${selectedPeriod}`
                : fromDatetime
                ? `Từ: ${new Date(fromDatetime).toLocaleString('vi-VN')}  →  Đến: ${toDatetime ? new Date(toDatetime).toLocaleString('vi-VN') : 'Hiện tại'}`
                : ''}
            </p>
          </div>
        </div>

        {/* 3 tables */}
        {reportData.length > 0
          ? tableConfigs.map(t => renderTable(t.key, t.label, t.headerClass))
          : (
            <div className="p-8 text-center text-slate-400">
              {periodLabel ? `Không có dữ liệu${periodLabel}` : 'Chọn Kỳ hoặc mốc thời gian để xem báo cáo kinh doanh'}
            </div>
          )
        }
      </div>

      {/* Expense + Payables sections */}
      {selectedPeriod && <ExpenseReportSection data={data} selectedPeriod={selectedPeriod} />}
      {selectedPeriod && <PayablesSection data={data} selectedPeriod={selectedPeriod} />}

      <style>{`
        @media print {
          @page { size: portrait; margin: 0; }
          * { color: #000 !important; }
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
          tr { page-break-inside: avoid !important; page-break-after: auto !important; }
          thead { display: table-header-group !important; }
          th, td {
            border: 2px solid #000 !important;
            padding: 8px !important;
            font-size: 22pt !important;
            line-height: 1.25 !important;
            white-space: normal !important;
            word-break: break-word !important;
          }
          th { background-color: #f3f4f6 !important; }
          h1 { font-size: 34pt !important; font-weight: bold !important; line-height: 1.3 !important; }
          h2 { font-size: 29pt !important; font-weight: bold !important; line-height: 1.3 !important; }
          h3, h4 { font-size: 23pt !important; font-weight: bold !important; line-height: 1.3 !important; }
          .expense-report-page { page-break-before: auto !important; }
        }
      `}</style>
    </div>
  );
}

// ── Expense Report Sub-component ──

function ExpenseReportSection({ data, selectedPeriod }: { data: DashboardData | null; selectedPeriod: string }) {
  const expenses = useMemo(() => {
    if (!data?.expenses || !selectedPeriod) return [];
    const target = normalizePeriod(selectedPeriod);
    return data.expenses.filter(e => normalizePeriod(e.period) === target);
  }, [data, selectedPeriod]);

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
      <div className="p-4 border-b border-slate-100 hidden print:block mb-4 relative">
        <div className="absolute top-4 left-4 text-left">
          <h2 className="font-bold uppercase text-xs">Phương Nam Apartment</h2>
        </div>
        <div className="text-center pt-6">
          <h1 className="text-xl font-bold uppercase">Bảng Kê Chi Phí Phát Sinh</h1>
          <p className="text-sm mt-1">Kỳ thanh toán: {selectedPeriod}</p>
        </div>
      </div>

      <div className="p-4 border-b border-slate-100 print:hidden bg-slate-50/50">
        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <span className="w-1.5 h-6 bg-indigo-500 rounded-full" />
          Chi phí phát sinh tháng {selectedPeriod}
          <span className="ml-2 text-xs font-normal text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-200 shadow-sm">Trang 2 khi in PDF</span>
        </h3>
      </div>

      <div className="overflow-x-auto print:overflow-visible p-4">
        {directExpenses.length > 0 ? (
          <div className="mb-8">
            <h4 className="mb-3 text-sm font-bold text-slate-700 uppercase print:text-black flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 print:hidden" />
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
                  <td className="border border-slate-200 print:border-slate-400" />
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-slate-50 rounded-xl text-slate-400 text-sm italic print:hidden">Không có chi phí trực tiếp.</div>
        )}

        {reimbExpenses.length > 0 ? (
          <div className="mb-8">
            <h4 className="mb-3 text-sm font-bold text-slate-700 uppercase print:text-black flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 print:hidden" />
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
                  <td colSpan={4} className="border border-slate-200 print:border-slate-400" />
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mb-6 p-4 bg-slate-50 rounded-xl text-slate-400 text-sm italic print:hidden">Không có khoản chi hộ.</div>
        )}

        <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl flex justify-between items-center print:bg-white print:border-slate-400 print:rounded-none print:mt-2">
          <span className="text-sm font-bold uppercase text-indigo-900 print:text-black">Tổng cộng chi phí phát sinh tháng {selectedPeriod.split('/')[0]}</span>
          <span className="text-xl font-black text-indigo-700 print:text-black">{formatVND(grandExpense)}</span>
        </div>

        <div className="hidden print:grid grid-cols-3 mt-12 text-center gap-6">
          <div><p className="font-bold">Người lập</p><p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p></div>
          <div><p className="font-bold">Quản lý</p><p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p></div>
          <div><p className="font-bold">Chủ đầu tư</p><p className="text-xs text-slate-500 italic mt-1">(Ký và ghi rõ họ tên)</p></div>
        </div>
      </div>
    </div>
  );
}

// ── Payables Section ──

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
          <span className="w-1.5 h-6 bg-red-500 rounded-full" />
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
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
