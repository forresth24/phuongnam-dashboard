// Shared payment calculation logic & form types
// Used by both RoomsTab (quick pay) and PaymentsTab (full payment CRUD)

import type { DashboardData } from './api';

// ─── Utilities ────────────────────────────────────────────

export const formatVND = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

export const todayStr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export function getCurrentMonthYear() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function isPaymentInCurrentMonth(dateStr: string) {
  if (!dateStr) return false;
  const { month, year } = getCurrentMonthYear();
  const parts = String(dateStr).split('/');
  if (parts.length === 3) return Number(parts[1]) === month && Number(parts[2]) === year;
  const d = new Date(dateStr);
  return d.getMonth() + 1 === month && d.getFullYear() === year;
}

// ─── Form Types ───────────────────────────────────────────

export interface PaymentFormData {
  room_id: string;
  contract_id: string;
  payment_type: string;
  amount: number;
  date: string;
  receiver: string;
  method: string;
  status: string;
  is_partial: boolean;
  note: string;
  // Contract fields (used when creating a new contract)
  tenant: string;
  phone: string;
  cccd: string;
  issue_date: string;
  issue_place: string;
  address: string;
  dob: string;
  duration: number;
  start_date: string;
  people_count: number;
  // Breakdown fields
  discount: number;
  base_rent: number;
  extra_person_fee: number;
  living_fee: number;
  water_fee: number;
  deposit_fee: number;
}

export interface PaymentFieldError {
  room_id?: string;
  amount?: string;
  receiver?: string;
  tenant?: string;
  phone?: string;
  cccd?: string;
  note?: string;
  start_date?: string;
}

export const makeEmptyPaymentForm = (defaultDuration: number = 12): PaymentFormData => ({
  room_id: '', contract_id: '', payment_type: 'Tiền phòng', amount: 0,
  date: todayStr(), receiver: 'Chưa nhận', method: 'Tiền mặt',
  status: 'Chưa tới chủ nhà', is_partial: false, note: '',
  tenant: '', phone: '', cccd: '', issue_date: '', issue_place: '', address: '', dob: '',
  duration: defaultDuration, start_date: todayStr(),
  people_count: 1,
  discount: 0,
  base_rent: 0, extra_person_fee: 0, living_fee: 0, water_fee: 0, deposit_fee: 0,
});

// ─── Expected Amount Calculation ──────────────────────────

export interface ExpectedAmountResult {
  total: number;
  rawTotal: number;
  basePrice: number;
  extraPersonFee: number;
  internetSurcharge: number;
  livingFee: number;
  deposit: number;
  daysStayed: number;
  daysInMonth: number;
}

/**
 * Calculate expected payment amount for a room.
 * 
 * Price priority:
 * 1. If there's an active contract → use contract.rent
 * 2. If no contract → use room.price (NOT room.original_price)
 * 
 * @param type - Payment type string
 * @param roomId - Room ID
 * @param data - Full dashboard data
 * @param getActiveContract - Function to look up active contract for a room
 * @param isNewContract - Whether this is for a new contract (prorate)
 * @param startDate - Start date for proration (dd/MM/yyyy)
 * @param peopleCountOverride - Override people count
 */
export function calculateExpectedAmount(
  type: string,
  roomId: string,
  data: DashboardData,
  getActiveContract: (roomId: string) => any,
  isNewContract?: boolean,
  startDate?: string,
  peopleCountOverride?: number,
): ExpectedAmountResult {
  const room = data.rooms.find((r: any) => String(r.id) === String(roomId));
  // BUG FIX: Always use room.price, never room.original_price
  // original_price is only for display purposes (strikethrough price)
  const price = room ? Number(room.price) || 0 : 0;
  const contract = getActiveContract(roomId);

  // For existing contract, use its rent; for new rooms, use room.price
  const basePrice = contract ? (Number(contract.rent) || price) : price;

  const peopleCount = peopleCountOverride !== undefined
    ? peopleCountOverride
    : (contract ? Number(contract.people_count) || 1 : 1);
  const waterPrice = Number(data.settings.WATER_PRICE_PER_PERSON) || 0;
  const internetSurcharge = Number(data.settings.SURCHARGE_PER_PERSON) || 0;
  const extraFeeSingle = Number(data.settings.EXTRA_FEE_SINGLE) || 0;
  const extraFeeDouble = Number(data.settings.EXTRA_FEE_DOUBLE) || 0;

  const roomType = (room ? room.type : 'Phòng đơn').toLowerCase();
  let extraPersonFee = 0;
  if (contract && contract.extra_person_fee !== undefined && peopleCount === Number(contract.people_count)) {
    extraPersonFee = Number(contract.extra_person_fee) || 0;
  } else {
    if (roomType === 'phòng đơn' && peopleCount > 1) {
      extraPersonFee = extraFeeSingle * (peopleCount - 1);
    } else if (roomType === 'phòng đôi' && peopleCount > 2) {
      extraPersonFee = extraFeeDouble * (peopleCount - 2);
    }
  }

  let totalInternetSurcharge = internetSurcharge * peopleCount;
  let livingFee = waterPrice * peopleCount;
  const unproratedPrice = basePrice;
  const deposit = contract
    ? Number(contract.deposit) || (unproratedPrice + totalInternetSurcharge + extraPersonFee)
    : (unproratedPrice + totalInternetSurcharge + extraPersonFee);

  let currentPrice = unproratedPrice;
  let currentLivingFee = livingFee;
  let daysStayed = 0;
  let daysInMonth = 30; // default

  if (startDate) {
    const parts = startDate.split('/');
    if (parts.length === 3) {
      const d = Number(parts[0]);
      const m = Number(parts[1]);
      const y = Number(parts[2]);
      daysInMonth = new Date(y, m, 0).getDate();
      if (isNewContract) {
        daysStayed = daysInMonth - d + 1;
      } else {
        daysStayed = daysInMonth;
      }
    }
  } else {
    const now = new Date();
    daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    daysStayed = daysInMonth;
  }

  if (isNewContract && startDate) {
    currentPrice = Math.round((basePrice / 30) * daysStayed);
    let proratedExtra = Math.round((extraPersonFee / 30) * daysStayed);
    let proratedInternet = Math.round((totalInternetSurcharge / 30) * daysStayed);
    currentLivingFee = Math.round((livingFee / 30) * daysStayed);
    extraPersonFee = proratedExtra;
    totalInternetSurcharge = proratedInternet;
  }

  let total = 0;
  if (type === 'Tiền phòng') total = currentPrice + totalInternetSurcharge + extraPersonFee;
  if (type === 'Tiền nước') total = currentLivingFee;
  if (type === 'Tiền phòng + Tiền nước') total = currentPrice + totalInternetSurcharge + extraPersonFee + currentLivingFee;
  if (type === 'Tiền phòng + Tiền nước + Tiền cọc') total = currentPrice + totalInternetSurcharge + extraPersonFee + currentLivingFee + deposit;
  if (type === 'Tiền cọc') total = deposit;

  const roundedTotal = total > 0 ? Math.ceil(total / 10000) * 10000 : 0;

  return {
    total: roundedTotal,
    rawTotal: total,
    basePrice: currentPrice,
    extraPersonFee,
    internetSurcharge: totalInternetSurcharge,
    livingFee: currentLivingFee,
    deposit: type.includes('cọc') ? deposit : 0,
    daysStayed,
    daysInMonth,
  };
}

// ─── Validation ───────────────────────────────────────────

export function validatePaymentForm(
  form: PaymentFormData,
  needsNewContract: boolean,
): PaymentFieldError {
  const e: PaymentFieldError = {};
  if (!form.room_id) e.room_id = 'Vui lòng chọn phòng';
  if (!form.amount || form.amount <= 0) e.amount = 'Vui lòng nhập số tiền';
  if (!form.receiver.trim()) e.receiver = 'Vui lòng chọn người nhận';
  if (form.payment_type === 'Khác' && !form.note.trim()) {
    e.note = 'Bắt buộc nhập Ghi chú';
  }
  if (needsNewContract) {
    if (!form.tenant.trim()) e.tenant = 'Vui lòng nhập tên khách thuê';
    if (form.phone && !/^(0|84)(3|5|7|8|9)[0-9]{8}$/.test(form.phone)) {
      e.phone = 'SĐT không hợp lệ';
    }
    if (form.cccd && !/^0[0-9]{11}$/.test(form.cccd)) {
      e.cccd = 'CCCD gồm 12 số bắt đầu bằng 0';
    }
  }
  return e;
}

// ─── Form Update Helpers ──────────────────────────────────

/** Recalculate the total amount from breakdown fields */
export function sumBreakdown(form: PaymentFormData): number {
  return form.base_rent + form.extra_person_fee + form.living_fee + form.water_fee + form.deposit_fee - form.discount;
}

/** Update form with new expected amounts from calculateExpectedAmount */
export function applyExpectedToForm(form: PaymentFormData, exp: ExpectedAmountResult): PaymentFormData {
  return {
    ...form,
    amount: exp.total,
    base_rent: exp.basePrice,
    extra_person_fee: exp.extraPersonFee,
    living_fee: exp.internetSurcharge,
    water_fee: exp.livingFee,
    deposit_fee: exp.deposit,
  };
}
