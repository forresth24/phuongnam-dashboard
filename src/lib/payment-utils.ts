// Shared payment calculation logic & form types
// Used by both RoomsTab (quick pay) and PaymentsTab (full payment CRUD)

import type { DashboardData } from './api';

// ─── Utilities ────────────────────────────────────────────

export const formatVND = (amount: number, showSuffix: boolean = true) =>
  new Intl.NumberFormat('en-US').format(amount) + (showSuffix ? ' VND' : '');

export const roundUp1k = (amount: number) => Math.ceil(amount / 1000) * 1000;

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
  received_date: string;
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
  stayed_days: number;
  period_days: number;
  old_electric: number;
  new_electric: number;
  electric_usage: number;
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
  received_date: todayStr(), receiver: 'Chưa nhận', method: 'Tiền mặt',
  status: 'Chưa tới chủ nhà', is_partial: false, note: '',
  tenant: '', phone: '', cccd: '', issue_date: '', issue_place: 'Cục Cảnh Sát', address: '', dob: '',
  duration: defaultDuration, start_date: firstDayOfMonthStr(),
  people_count: 1,
  discount: 0,
  base_rent: 0, extra_person_fee: 0, living_fee: 0, water_fee: 0, electric_fee: 0, deposit_fee: 0,
  included_fields: ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'],
  stayed_days: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(), 
  period_days: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate(),
  old_electric: 0, new_electric: 0, electric_usage: 0,
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
  stayed_days: number;
  period_days: number;
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

  let discount = 0;
  if (contract) {
    discount = Number(contract.discount);
  }
  const livingFee = waterPrice * peopleCount;
  const totalInternetSurcharge = internetSurcharge * peopleCount - discount;
  const totalElectricFee = electricPrice * peopleCount;

  // Tiền cọc = Giá phòng + Phụ thu quá người
  const deposit = basePrice + extraPersonFee;

  let stayed_days = 0;
  let period_days = 30;

  // Determine proration
  const calcDate = targetDate || todayStr();
  const parts = calcDate.split('/');
  if (parts.length === 3) {
    const m = Number(parts[1]);
    const y = Number(parts[2]);
    period_days = new Date(y, m, 0).getDate();
    
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

    const targetDay = targetDate ? (Number(targetDate.split('/')[0]) || 1) : 1;
    if (isMoveInMonth) {
      // In move-in month, stay starts from the later of move-in date or target start date
      const actualStartDay = Math.max(moveInDay, targetDay);
      stayed_days = period_days - actualStartDay + 1;
    } else {
      // Normal month, stay starts from target start date
      stayed_days = period_days - targetDay + 1;
    }
  } else {
    const now = new Date();
    period_days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    stayed_days = period_days;
  }

  // Calculate prorated fees
  const prorateRatio = stayed_days >= period_days ? 1 : Math.min(1, stayed_days / 30);
  
  // Find most recent payment with a valid electric reading (sorted by date desc)
  // Includes: all statuses (Chưa tới chủ nhà, Hoàn thành, etc.), all periods
  let oldElectric = 0;
  if (contract) {
    const contractPayments = data.payments
      .filter((p: any) => String(p.contract_id) === String(contract.id))
      .sort((a: any, b: any) => {
        const dateStrA = a.received_date || a.date || '';
        const dateStrB = b.received_date || b.date || '';
        const dateA = dateStrA ? new Date(dateStrA.split('/').reverse().join('-')) : new Date(0);
        const dateB = dateStrB ? new Date(dateStrB.split('/').reverse().join('-')) : new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

    // find from end (newest first after sort desc), return the first with valid new_electric
    const lastWithReading = contractPayments.find((p: any) => {
      const val = p.new_electric;
      return val !== undefined && val !== null && val !== '' && !isNaN(Number(val)) && Number(val) > 0;
    });

    oldElectric = lastWithReading ? Number(lastWithReading.new_electric) || 0 : (Number(contract.start_electric) || 0);
  }

  const res = {
    basePrice: roundUp1k(basePrice * prorateRatio),
    extraPersonFee: roundUp1k(extraPersonFee),
    internetSurcharge: roundUp1k(totalInternetSurcharge * prorateRatio),
    livingFee: roundUp1k(waterPrice * peopleCount * prorateRatio),
    // If old electric is 0, it means it's a new contract or reading not yet recorded
    electricFee: oldElectric === 0 ? 0 : roundUp1k(totalElectricFee),
    deposit: deposit,
    fullBasePrice: basePrice,
    fullExtraFee: extraPersonFee,
    fullSurcharge: totalInternetSurcharge,
    fullLivingFee: waterPrice * peopleCount,
    fullElectric: totalElectricFee,
    stayed_days,
    period_days,
    oldElectric,
	discount: contract ? (Number(contract.discount) || 0) : 0,
  };

  // Recommended total: only include deposit if it's a new contract (Thu cọc)
  const recommendedDeposit = isNewContract ? deposit : 0;
  const total = res.basePrice + res.extraPersonFee + res.livingFee + res.internetSurcharge + res.electricFee + recommendedDeposit;
  const roundedTotal = total > 0 ? roundUp1k(total) : 0;

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
    stayed_days,
    period_days,
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
  if (fields.includes('living_fee')) sum += roundUp1k(Number(form.living_fee) || 0);
  if (fields.includes('water_fee')) sum += roundUp1k(Number(form.water_fee) || 0);
  if (fields.includes('electric_fee')) sum += roundUp1k(Number(form.electric_fee) || 0);
  if (fields.includes('deposit_fee')) {
    sum += (Number(form.deposit_fee) || 0);
  }
  sum += (Number(form.previous_debt) || 0);
  
  return Math.max(0, roundUp1k(sum));
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
    electric_usage: 0,
    included_fields: included,
    stayed_days: exp.stayed_days,
    period_days: exp.period_days,
  };
  
  return {
    ...newForm,
    amount: sumBreakdown(newForm),
  };
}
