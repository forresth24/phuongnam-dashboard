// Shared payment calculation logic & form types
// Used by both RoomsTab (quick pay) and PaymentsTab (full payment CRUD)

import type { DashboardData } from './api';

// ─── Utilities ────────────────────────────────────────────

export const formatVND = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

export const roundUp10k = (amount: number) => Math.ceil(amount / 10000) * 10000;
export const roundUp5k = (amount: number) => Math.ceil(amount / 5000) * 5000;

export const todayStr = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

export const firstDayOfMonthStr = () => {
  const d = new Date();
  return `01/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
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
  electric_fee: number;
  deposit_fee: number;
  included_fields: string[]; // e.g. ['base_rent', 'water_fee']
  days_stayed: number;
  days_in_month: number;
  old_electric: number;
  new_electric: number;
  previous_debt: number;
  deposit_paid: number;
  payment_period?: string;
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
  room_id: '', contract_id: '', amount: 0,
  date: todayStr(), receiver: 'Chưa nhận', method: 'Tiền mặt',
  status: 'Chưa tới chủ nhà', is_partial: false, note: '',
  tenant: '', phone: '', cccd: '', issue_date: '', issue_place: '', address: '', dob: '',
  duration: defaultDuration, start_date: firstDayOfMonthStr(),
  people_count: 1,
  discount: 0,
  base_rent: 0, extra_person_fee: 0, living_fee: 0, water_fee: 0, electric_fee: 0, deposit_fee: 0,
  included_fields: ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'],
  days_stayed: 30, days_in_month: 30,
  old_electric: 0, new_electric: 0,
  previous_debt: 0,
  deposit_paid: 0,
  payment_period: firstDayOfMonthStr().split('/').slice(1).join('/'),
});

// ─── Expected Amount Calculation ──────────────────────────

export interface ExpectedAmountResult {
  total: number;
  rawTotal: number;
  basePrice: number;
  extraPersonFee: number;
  internetSurcharge: number;
  livingFee: number;
  electricFee: number;
  deposit: number;
  discount: number;
  daysStayed: number;
  daysInMonth: number;
  oldElectric: number;
  // Full month values (unprorated)
  fullBasePrice: number;
  fullExtraFee: number;
  fullLivingFee: number;
  fullSurcharge: number;
  fullElectric: number;
}

/**
 * Calculate expected payment amount for a room.
 * Always calculates all components: Room, Water, Service, Electricity, Deposit.
 * 
 * Logic:
 * - Tiền cọc = full base price.
 * - Others = prorated if target month is move-in month.
 * 
 * @param roomId - Room ID
 * @param data - Full dashboard data
 * @param getActiveContract - Function to look up active contract for a room
 * @param isNewContract - Whether this is for a new contract (treats start_date as move-in date)
 * @param targetDate - Date of calculation (default today)
 * @param peopleCountOverride - Override people count
 */
export function calculateExpectedAmount(
  roomId: string,
  data: DashboardData,
  getActiveContract: (roomId: string) => any,
  isNewContract?: boolean,
  targetDate?: string,
  peopleCountOverride?: number,
): ExpectedAmountResult {
  const room = data.rooms.find((r: any) => String(r.id) === String(roomId));
  const price = room ? Number(room.price) || 0 : 0;
  const contract = getActiveContract(roomId);

  const basePrice = contract ? (Number(contract.rent) || price) : price;

  const peopleCount = peopleCountOverride !== undefined
    ? peopleCountOverride
    : (contract ? Number(contract.people_count) || 1 : 1);
  
  const waterPrice = Number(data.settings.WATER_PRICE_PER_PERSON) || 0;
  const internetSurcharge = Number(data.settings.SURCHARGE_PER_PERSON) || 0;
  const electricPrice = Number(data.settings.ELECTRIC_PRICE_PER_MONTH) || 0;
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

  const livingFee = waterPrice * peopleCount;
  const totalInternetSurcharge = internetSurcharge * peopleCount;
  const totalElectricFee = electricPrice * peopleCount;
  let discount = 0;
  if (contract) {
    discount = Number(contract.discount);
  }

  // Tiền cọc = Giá phòng + Phụ thu quá người - Giảm giá
  const deposit = basePrice + extraPersonFee - discount;

  let daysStayed = 0;
  let daysInMonth = 30;

  // Determine proration
  const calcDate = targetDate || todayStr();
  const parts = calcDate.split('/');
  if (parts.length === 3) {
    const m = Number(parts[1]);
    const y = Number(parts[2]);
    daysInMonth = new Date(y, m, 0).getDate();
    
    // Check if move-in date is in this month
    const moveInDateStr = contract ? contract.move_in_date || contract.start_date : (isNewContract ? targetDate : '');
    let isMoveInMonth = false;
    let moveInDay = 1;

    if (moveInDateStr) {
      const mParts = moveInDateStr.split('/');
      if (mParts.length === 3) {
        const mm = Number(mParts[1]);
        const my = Number(mParts[2]);
        const md = Number(mParts[0]);
        if (mm === m && my === y) {
          isMoveInMonth = true;
          moveInDay = md;
        }
      }
    }

    if (targetDate) {
      const parts = targetDate.split('/');
      const d = Number(parts[0]) || 1;
      daysStayed = daysInMonth - d + 1;
    } else if (isMoveInMonth && moveInDay > 1) {
      daysStayed = daysInMonth - moveInDay + 1;
    } else {
      daysStayed = daysInMonth;
    }
  } else {
    const now = new Date();
    daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    daysStayed = daysInMonth;
  }

  // Calculate prorated fees
  const prorateRatio = daysStayed >= daysInMonth ? 1 : Math.min(1, daysStayed / 30);
  
  // Find last payment to get electric reading
  let oldElectric = 0;
  if (contract) {
    const validPayments = data.payments
      .filter((p: any) => String(p.contract_id) === String(contract.id) && (Number(p.new_electric) || 0) > 0);
    
    if (validPayments.length > 0) {
      // Get the one with highest ID or last in list if already ordered
      const last = validPayments[validPayments.length - 1];
      oldElectric = Number(last.new_electric) || 0;
    } else if (contract) {
      oldElectric = Number(contract.start_electric) || 0;
    }
  }

  const res = {
    basePrice: roundUp10k(deposit * prorateRatio),
    // extraPersonFee: roundUp10k(extraPersonFee * prorateRatio),
    extraPersonFee: roundUp10k(extraPersonFee),
    internetSurcharge: roundUp5k(totalInternetSurcharge * prorateRatio),
    livingFee: roundUp5k(waterPrice * peopleCount * prorateRatio),
    // If old electric is 0, it means it's a new contract or reading not yet recorded
    electricFee: oldElectric === 0 ? 0 : roundUp10k(totalElectricFee),
    deposit: deposit,
    discount: contract ? (() => {
      const parseVal = (v: any) => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return Number(v.replace(/[^0-9.-]+/g, '')) || 0;
        return 0;
      };
      return (
        parseVal(contract.discount_applied) || 
        parseVal(contract['chiết khấu']) || 
        parseVal(contract['giảm giá']) || 
        parseVal(contract['chiết khấu/tháng']) || 
        parseVal(contract['giảm giá/tháng']) || 
        parseVal(contract['giam gia']) || 
        parseVal(contract['chiet khau']) || 
        parseVal(contract.discount) || 0
      );
    })() : 0,
  };

  // Recommended total: only include deposit if it's a new contract (Thu cọc)
  const recommendedDeposit = isNewContract ? deposit : 0;
  const total = res.basePrice + res.extraPersonFee + res.livingFee + res.internetSurcharge + res.electricFee + recommendedDeposit - res.discount;
  const roundedTotal = total > 0 ? roundUp10k(total) : 0;

  return {
    total: roundedTotal,
    rawTotal: total,
    basePrice: res.basePrice,
    extraPersonFee: res.extraPersonFee,
    internetSurcharge: res.internetSurcharge,
    livingFee: res.livingFee,
    electricFee: res.electricFee,
    deposit: res.deposit,
    discount: res.discount,
    daysStayed,
    daysInMonth,
    oldElectric: oldElectric,
    fullBasePrice: deposit,
    fullExtraFee: extraPersonFee,
    fullLivingFee: livingFee,
    fullSurcharge: totalInternetSurcharge,
    fullElectric: totalElectricFee,
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
  if (form.note.trim().length === 0 && form.amount > 0 && sumBreakdown(form) === 0) {
    // Only require note if it's an "Other" type payment where breakdown is empty
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
  const fields = form.included_fields || [];
  let sum = 0;
  if (fields.includes('base_rent')) sum += (Number(form.base_rent) || 0);
  if (fields.includes('extra_person_fee')) sum += (Number(form.extra_person_fee) || 0);
  if (fields.includes('living_fee')) sum += (Number(form.living_fee) || 0);
  if (fields.includes('water_fee')) sum += (Number(form.water_fee) || 0);
  if (fields.includes('electric_fee')) sum += (Number(form.electric_fee) || 0);
  if (fields.includes('deposit_fee')) {
    const totalDepositNeeded = Number(form.deposit_fee) || 0;
    const alreadyPaid = Number(form.deposit_paid) || 0;
    sum += Math.max(0, totalDepositNeeded - alreadyPaid);
  }
  sum += (Number(form.previous_debt) || 0);
  
  let finalSum = sum;
  if (fields.includes('base_rent')) {
    finalSum -= (Number(form.discount) || 0);
  }
  
  return Math.max(0, roundUp10k(finalSum));
}

/** Determine the payment type label based on included fields */
export function getPaymentTypeLabel(includedFields: string[]): string {
  const inc = includedFields || [];
  const hasDeposit = inc.includes('deposit_fee');
  const hasMonthly = inc.some(f => ['base_rent', 'water_fee', 'living_fee', 'electric_fee', 'extra_person_fee'].includes(f));
  
  if (hasDeposit && hasMonthly) return 'Thu tiền tháng + Cọc';
  if (hasDeposit) return 'Tiền cọc';
  return 'Thu tiền tháng';
}

/** Update form with new expected amounts from calculateExpectedAmount */
export function applyExpectedToForm(form: PaymentFormData, exp: ExpectedAmountResult): PaymentFormData {
  let included = form.included_fields && form.included_fields.length > 0
    ? form.included_fields
    : ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'];
  
  if (!form.included_fields && exp.deposit > 0) {
    included = [...included, 'deposit_fee'];
  }
  
  const newForm = {
    ...form,
    base_rent: exp.basePrice,
    extra_person_fee: exp.extraPersonFee,
    living_fee: exp.internetSurcharge,
    water_fee: exp.livingFee,
    electric_fee: exp.electricFee,
    deposit_fee: exp.deposit,
    discount: exp.discount,
    old_electric: exp.oldElectric,
    new_electric: exp.oldElectric, // Default same as old
    included_fields: included,
    days_stayed: exp.daysStayed,
    days_in_month: exp.daysInMonth,
  };
  
  return {
    ...newForm,
    amount: sumBreakdown(newForm),
  };
}
