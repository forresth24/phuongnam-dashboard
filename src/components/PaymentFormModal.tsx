// Shared Payment Form Modal — used by both RoomsTab and PaymentsTab
import { useState, useEffect, useRef } from 'react';
import { Loader2, Banknote, ScrollText, FileText } from 'lucide-react';
import type { AppConfig, DashboardData } from '../lib/api';
import { API } from '../lib/api';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { DatePickerInput } from './ui/DatePickerInput';
import { getReceivers, autoPaymentStatus, getContractMonthRange } from '../lib/settings-helpers';
import {
  formatVND, todayStr, firstDayOfMonthStr, roundUp1k,
  calculateExpectedAmount, validatePaymentForm, sumBreakdown,
  makeEmptyPaymentForm, getPaymentTypeLabel,
  type PaymentFormData, type PaymentFieldError,
} from '../lib/payment-utils';
import { findContractTenant } from '../lib/tenant-utils';

// ─── Props ────────────────────────────────────────────────

interface PaymentFormModalProps {
  config: AppConfig;
  data: DashboardData;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Pre-filled form values (e.g. from room click or edit) */
  initialForm?: PaymentFormData;
  /** If editing an existing payment */
  editItem?: any;
  /** Modal title override */
  title?: string;
  /** Whether to show room selector (PaymentsTab) vs pre-selected room (RoomsTab) */
  showRoomSelector?: boolean;
  /** Whether to show extended tenant fields (issue_date, issue_place, dob, address) */
  showExtendedTenantFields?: boolean;
  /** Mode for exporting monthly notifications */
  isNoticeMode?: boolean;
}

export function PaymentFormModal({
  config, data, open, onClose, onSuccess,
  initialForm, editItem, title,
  showRoomSelector = false,
  showExtendedTenantFields = false,
  isNoticeMode = false,
}: PaymentFormModalProps) {
  const [form, setForm] = useState<PaymentFormData>(initialForm || makeEmptyPaymentForm());
  const [errors, setErrors] = useState<PaymentFieldError>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [partialConfirm, setPartialConfirm] = useState(false);
  const [isContractEditable, setIsContractEditable] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [isNextMonth, setIsNextMonth] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>(initialForm?.room_id ? [initialForm.room_id] : []);
  const [selectedContractId, setSelectedContractId] = useState<string>(initialForm?.contract_id || '');
  const pendingPrintPdfRef = useRef(false);

  const receivers = getReceivers(data.settings);
  const { min: minMonths, max: maxMonths } = getContractMonthRange(data.settings);

  // Sync form when modal opens with new initialForm
  useEffect(() => {
    if (open && initialForm) {
      // Normalize deposit fields from sheet data to form state
      const normalizedForm = {
        ...initialForm,
        // If editing an existing payment, p.deposit_amount (from sheet) is our deposit_fee (in form)
        deposit_fee: initialForm.deposit_fee || (initialForm as any).deposit_amount || 0,
      };
      setForm(normalizedForm);
      setErrors({});
      setSaveError('');
      setSelectedRoomIds(initialForm.room_id ? [initialForm.room_id] : []);
      // Sync selected contract: from initialForm, or derive from room
      if (initialForm.contract_id) {
        setSelectedContractId(initialForm.contract_id);
      } else if (initialForm.room_id) {
        const contracts = getActiveContracts(initialForm.room_id);
        if (contracts.length === 1) {
          setSelectedContractId(contracts[0].id);
        } else if (contracts.length > 1) {
          const sorted = [...contracts].sort((a: any, b: any) => String(b.id || '').localeCompare(String(a.id || '')));
          setSelectedContractId(sorted[0].id);
        } else {
          setSelectedContractId('');
        }
      } else {
        setSelectedContractId('');
      }

      // If exporting notices late in the month, default to next month
      if (isNoticeMode && new Date().getDate() >= 20) {
        setIsNextMonth(true);
        const d = new Date();
        const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const nextStr = `01/${String(nextMonth.getMonth() + 1).padStart(2, '0')}/${nextMonth.getFullYear()}`;
        const period = `${String(nextMonth.getMonth() + 1).padStart(2, '0')}/${nextMonth.getFullYear()}`;
        
        // Recalculate expected fields for next month
        // (Simplified here, the user can still toggle or change date)
        setForm(prev => ({ 
          ...prev, 
          start_date: nextStr,
          payment_period: period,
        }));
      } else {
        setIsNextMonth(false);
      }
    }
  }, [open, initialForm, isNoticeMode]);

  const getActiveContracts = (roomId: string) =>
    data.contracts.filter((c: any) => String(c.room_id).trim() === String(roomId).trim());

  const getActiveContract = (roomId: string) => {
    const contracts = getActiveContracts(roomId);
    if (contracts.length === 0) return null;
    if (contracts.length === 1) return contracts[0];
    // Multiple contracts: use selectedContractId, or default to newest
    if (selectedContractId) {
      const found = contracts.find((c: any) => String(c.id) === String(selectedContractId));
      if (found) return found;
    }
    // Default to newest by id
    return [...contracts].sort((a: any, b: any) => String(b.id || '').localeCompare(String(a.id || '')))[0];
  };

  const getContractTenantName = (contract: any) => {
    if (!contract) return '';
    const t = findContractTenant(contract, data.tenants);
    return t ? t.name : '';
  };
  const getContractTenantPhone = (contract: any) => {
    if (!contract) return '';
    const t = findContractTenant(contract, data.tenants);
    return t ? t.phone : '';
  };

  const needsNewContract = !!(form.room_id && getActiveContracts(form.room_id).length === 0);
  const roomActiveContracts = form.room_id ? getActiveContracts(form.room_id) : [];

  const calcExpected = (roomId?: string, startDate?: string, peopleCount?: number) => {
    const r = roomId || form.room_id;
    const isNew = r ? !getActiveContract(r) : false;
    const pc = peopleCount ?? form.people_count;
    
    let sd = startDate || form.start_date;
    if (isNextMonth && !startDate) {
      const parts = sd.split('/');
      if (parts.length === 3) {
        const d = new Date(Number(parts[2]), Number(parts[1]), 1); // 1st of next month
        sd = `01/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
    }
    
    return calculateExpectedAmount(r, data, getActiveContract, isNew, sd, pc);
  };

  const getExpected = () => sumBreakdown(form);

  // ─── Field Helpers ────────────────────────────────────────

  const F = (k: string, v: any) => {
    setForm(prev => ({ ...prev, [k]: v }));
    if ((errors as any)[k]) setErrors(prev => ({ ...prev, [k]: undefined }));
  };

  const onReceiverChange = (receiver: string) => {
    setForm(prev => ({ ...prev, receiver, status: autoPaymentStatus(receiver, data.settings) }));
    if (errors.receiver) setErrors(prev => ({ ...prev, receiver: undefined }));
  };

  const applyExpectedFields = (exp: ReturnType<typeof calculateExpectedAmount>, roomId?: string) => {
    const rid = roomId || form.room_id;
    const contract = getActiveContract(rid);
    const needsContract = !!(rid && !contract);

    // Calculate already paid deposit for this contract
    let depositPaid = 0;
    let rentPaid = 0;
    let extraPaid = 0;
    const period = form.payment_period || (form.start_date ? form.start_date.split('/').slice(1).join('/') : '');

    if (contract) {
      const contractPayments = data.payments.filter((p: any) => 
        String(p.contract_id) === String(contract.id) && 
        (!editItem || String(p.id) !== String(editItem.id))
      );
      
      // Sum up only the ACTUAL amounts paid in each transaction (not the cumulative total)
      depositPaid = contractPayments.reduce((sum, p) => sum + (Number(p.deposit_amount || p.deposit_fee || 0)), 0);
      
      // Calculate rent already paid for this period
      if (period) {
        rentPaid = contractPayments
          .filter((p: any) => p.payment_period === period)
          .reduce((sum, p) => sum + (Number(p.base_rent) || 0), 0);
        extraPaid = contractPayments
          .filter((p: any) => p.payment_period === period)
          .reduce((sum, p) => sum + (Number(p.extra_fee_total) || Number(p.extra_person_fee) || 0), 0);
      }
    }

    let included = ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'];
    const remainingDeposit = Math.max(0, exp.deposit - depositPaid);
    
    if (needsContract) {
      included = ['deposit_fee']; // Default only deposit for new contracts
    } else if (remainingDeposit > 0) {
      // If there's still deposit to pay, include it in the default fields
      included.push('deposit_fee');
    }
    
    const partialForm: any = {
      base_rent: Math.max(0, exp.basePrice - rentPaid),
      extra_person_fee: Math.max(0, exp.extraPersonFee - extraPaid),
      living_fee: exp.internetSurcharge,
      water_fee: exp.livingFee,
      electric_fee: exp.electricFee,
      deposit_fee: remainingDeposit,
      deposit_paid: depositPaid,
      discount: exp.discount,
      included_fields: included,
      stayed_days: exp.stayed_days,
      period_days: exp.period_days,
      old_electric: exp.oldElectric,
      new_electric: exp.oldElectric, 
    };
    partialForm.amount = sumBreakdown(partialForm as any);
    return partialForm;
  };

  const handleAmountChange = (val: number) => {
    F('amount', val);
  };

  const onRoomChange = (roomId: string) => {
    const contracts = getActiveContracts(roomId);
    // Auto-select: if 1 contract, use it; if multiple, default to newest
    const targetContract = contracts.length === 1 ? contracts[0]
      : contracts.length > 1 ? [...contracts].sort((a: any, b: any) => String(b.id || '').localeCompare(String(a.id || '')))[0]
      : null;
    setSelectedContractId(targetContract ? targetContract.id : '');

    const contract = targetContract;
    const startDate = firstDayOfMonthStr();
    const exp = calculateExpectedAmount(roomId, data, () => contract, !contract, startDate);
    
    // We need to pass roomId to applyExpectedFields because form.room_id hasn't updated yet
    const fields = applyExpectedFields(exp, roomId);
    
    setForm(prev => ({
      ...prev,
      room_id: roomId, contract_id: contract ? contract.id : '',
      tenant: getContractTenantName(contract), phone: getContractTenantPhone(contract),
      cccd: '', issue_date: '', issue_place: 'Cục Cảnh Sát', address: '', dob: '',
      start_date: startDate,
      people_count: contract ? Number(contract.people_count) || 1 : 1,
      ...fields,
      new_electric: fields.new_electric, // Use the one from fields for initial load
    }));
    if (errors.room_id) setErrors(prev => ({ ...prev, room_id: undefined }));
  };

  const handleStartDateChange = async (val: string) => {
    const exp = calcExpected(undefined, val);
    const fields = applyExpectedFields(exp);
    // Don't overwrite new_electric during recalculation
    delete (fields as any).new_electric;

    // Logic: If user changes start_date and it's different from move_in_date in contract, ask to update contract
    // ONLY if deposit is not yet fully paid
    const currentContract = getActiveContract(form.room_id || '');
    if (currentContract && val && val !== currentContract.move_in_date) {
      const targetDeposit = (Number(currentContract.rent) || 0) + (Number(currentContract.extra_person_fee) || 0);
      const paidDeposit = Number(currentContract.deposit_paid) || 0;
      const isDepositPending = paidDeposit < targetDeposit;

      if (isDepositPending) {
        const confirmUpdate = window.confirm(
          `Ngày bắt đầu tính tiền (${val}) khác với ngày dọn vào trong hợp đồng (${currentContract.move_in_date}). \n\nBạn có muốn cập nhật ngày dọn vào của hợp đồng thành ${val} không để các lần thu sau được chính xác?`
        );
        if (confirmUpdate) {
          try {
            await API.updateContract(config, currentContract.id, { move_in_date: val });
          } catch (err: any) {
            console.error("Lỗi cập nhật hợp đồng:", err);
            alert("Không thể cập nhật ngày dọn vào của hợp đồng: " + err.message);
          }
        }
      }
    }

    setForm(prev => ({ 
      ...prev, 
      start_date: val, 
      payment_period: val.split('/').slice(1).join('/'),
      ...fields 
    }));
  };

  const handlePeopleCountChange = (val: number) => {
    const exp = calcExpected(undefined, undefined, val);
    const fields = applyExpectedFields(exp);
    delete (fields as any).new_electric;
    setForm(prev => ({ ...prev, people_count: val, ...fields }));
  };

  const toggleNextMonth = () => {
    const next = !isNextMonth;
    setIsNextMonth(next);
    
    const d = new Date();
    let newStartDate = firstDayOfMonthStr();
    
    if (next) {
      const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      newStartDate = `01/${String(nextMonth.getMonth() + 1).padStart(2, '0')}/${nextMonth.getFullYear()}`;
    }
    
    const exp = calculateExpectedAmount(form.room_id, data, getActiveContract, needsNewContract, newStartDate, form.people_count);
    setForm(prev => ({ 
      ...prev, 
      start_date: newStartDate, 
      payment_period: newStartDate.split('/').slice(1).join('/'),
      ...applyExpectedFields(exp) 
    }));
  };

  const handleDaysChange = (days: number) => {
    const exp = calcExpected();
    const ratio = days >= exp.period_days ? 1 : days / 30;
    const newForm = {
      ...form,
      stayed_days: days,
      base_rent: roundUp1k(exp.fullBasePrice * ratio),
      // extra_person_fee: roundUp1k(exp.fullExtraFee * ratio),
      extra_person_fee: roundUp1k(exp.fullExtraFee),
      living_fee: roundUp1k(exp.fullSurcharge * ratio),
      water_fee: roundUp1k(exp.fullLivingFee * ratio),
      electric_fee: roundUp1k(exp.fullElectric * ratio),
    };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
  };

  const handleElectricReadingChange = (field: 'old_electric' | 'new_electric', val: number) => {
    const nextForm = { ...form, [field]: val };
    const diff = Math.max(0, nextForm.new_electric - nextForm.old_electric);
    const unitPrice = Number(data.settings.ELECTRIC_PRICE) || 0;
    // If old electric is 0, it means it's a new contract or reading not yet recorded
    const fee = nextForm.old_electric === 0 ? 0 : roundUp1k(diff * unitPrice);
    
    const finalForm = { ...nextForm, electric_fee: fee, electric_usage: diff };
    setForm({ ...finalForm, amount: sumBreakdown(finalForm) });
  };

  const handleBreakdownChange = (key: string, val: number) => {
    const newForm = { ...form, [key]: val };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
  };

  const toggleMonthlyGroup = () => {
    const group = ['base_rent', 'water_fee', 'living_fee', 'electric_fee', 'extra_person_fee'];
    const allChecked = group.every(k => form.included_fields?.includes(k));
    let next;
    if (allChecked) {
      next = form.included_fields?.filter(k => !group.includes(k)) || [];
    } else {
      next = Array.from(new Set([...(form.included_fields || []), ...group]));
    }
    const newForm = { ...form, included_fields: next };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
  };

  const toggleField = (key: string) => {
    const current = form.included_fields || [];
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    const newForm = { ...form, included_fields: next };
    setForm({ ...newForm, amount: sumBreakdown(newForm) });
  };

  // ─── Submit ─────────────────────────────────────────────

  const doSubmit = async () => {
    setSaving(true);
    setSaveError('');
    try {
      let contractId = form.contract_id;
      if (!contractId && needsNewContract) {
        const res = await API.createContract(config, {
          room_id: form.room_id, tenant: form.tenant,
          phone: form.phone, cccd: form.cccd,
          issue_date: form.issue_date, issue_place: form.issue_place,
          address: form.address, dob: form.dob,
          duration: form.duration, move_in_date: form.start_date,
          people_count: form.people_count,
        });
        contractId = res.id;
      }
      if (!contractId) { setSaveError('Không tìm thấy hợp đồng'); setSaving(false); return; }

      const expected = getExpected();
      const isPartial = form.amount < expected;
      const expResult = calcExpected();

      // Data Integrity: Ensure the breakdown doesn't exceed the actual amount paid
      let finalBreakdown = {
        base_rent: form.included_fields?.includes('base_rent') ? form.base_rent : 0,
        extra_person_fee: form.included_fields?.includes('extra_person_fee') ? form.extra_person_fee : 0,
        living_fee: form.included_fields?.includes('living_fee') ? form.living_fee : 0,
        water_fee: form.included_fields?.includes('water_fee') ? form.water_fee : 0,
        electric_fee: form.included_fields?.includes('electric_fee') ? form.electric_fee : 0,
        deposit_fee: form.included_fields?.includes('deposit_fee') ? form.deposit_fee : 0,
      };
      
      const breakdownSum = Object.values(finalBreakdown).reduce((a, b) => a + b, 0);
      if (breakdownSum > form.amount) {
        let remainingDiff = breakdownSum - form.amount;
        // Reduce deposit first, then rent, then services
        const order: (keyof typeof finalBreakdown)[] = ['deposit_fee', 'base_rent', 'living_fee', 'water_fee', 'electric_fee', 'extra_person_fee'];
        for (const key of order) {
          if (remainingDiff <= 0) break;
          const currentVal = finalBreakdown[key];
          if (currentVal > 0) {
            const reduceAmount = Math.min(currentVal, remainingDiff);
            finalBreakdown[key] -= reduceAmount;
            remainingDiff -= reduceAmount;
          }
        }
      }

      const isPaidStatus = form.status === 'Hoàn thành' || form.status === 'Đã hoàn thành';
      const actualDepositPaidTotal = (form.deposit_paid || 0) + (isPaidStatus ? finalBreakdown.deposit_fee : 0);
      const actualDepositRemaining = Math.max(0, (expResult.deposit || 0) - actualDepositPaidTotal);

      const commonPayload = {
        amount: form.amount, received_date: form.received_date || todayStr(),
        note: form.note, receiver: form.receiver, method: form.method,
        status: form.status, is_partial: isPartial,
        total_amount_calculated: expected,
        discount_applied: form.discount,
        base_rent: finalBreakdown.base_rent,
        extra_fee_total: finalBreakdown.extra_person_fee,
        surcharge_total: finalBreakdown.living_fee,
        water_total: finalBreakdown.water_fee,
        electric_total: finalBreakdown.electric_fee,
        previous_debt: form.previous_debt || 0,
        old_electric: form.old_electric,
        new_electric: form.new_electric,
        electric_usage: Math.max(0, form.new_electric - form.old_electric),
        deposit_fee: finalBreakdown.deposit_fee, 
        deposit_amount: finalBreakdown.deposit_fee,
        deposit_remaining: actualDepositRemaining,
        deposit_paid_total: actualDepositPaidTotal,
        stayed_days: form.stayed_days || expResult.stayed_days,
        period_days: expResult.period_days,
        deposit_paid: form.deposit_paid,
        payment_period: form.payment_period || (form.start_date ? form.start_date.split('/').slice(1).join('/') : ''),
        payment_type: getPaymentTypeLabel(form.included_fields || []),
      };

      if (editItem) {
        let finalNote = form.note;
        if (form.amount !== editItem.amount) {
          finalNote += ` [Sửa ${todayStr()}]`;
        }
        await API.updatePayment(config, editItem.id, {
          ...commonPayload,
          note: finalNote.trim(),
        });
        // Generate PDF after update if requested
        if (pendingPrintPdfRef.current) {
          try {
            const pdfRes = await API.getReceiptPdf(config, editItem.id);
            const link = document.createElement('a');
            link.href = `data:application/pdf;base64,${pdfRes.base64}`;
            link.download = pdfRes.filename;
            link.click();
          } catch (_) {}
        }
      } else {
        const payment = await API.createPayment(config, {
          contract_id: contractId,
          ...commonPayload,
        });
        // Generate PDF after create if requested
        if (pendingPrintPdfRef.current) {
          try {
            const pdfRes = await API.getReceiptPdf(config, payment.id);
            const link = document.createElement('a');
            link.href = `data:application/pdf;base64,${pdfRes.base64}`;
            link.download = pdfRes.filename;
            link.click();
          } catch (_) {}
        }
      }
      onClose();
      onSuccess();
    } catch (e: any) { setSaveError(e.message || 'Lỗi không xác định'); }
    setSaving(false);
    setPendingSubmit(false);
    pendingPrintPdfRef.current = false;
  };

  const handleBatchExport = async () => {
    setSaving(true);
    setSaveError('');
    try {
      const results = [];
      for (const rid of selectedRoomIds) {
        const contract = getActiveContract(rid);
        if (!contract) continue;

        // Calculate for each room based on current toggle
        const exp = calculateExpectedAmount(rid, data, getActiveContract, false, form.start_date, Number(contract.people_count) || 1);
        
        // Calculate already paid deposit and rent for this room
        const contractPayments = data.payments.filter((p: any) => String(p.contract_id) === String(contract.id));
        const depositPaid = contractPayments.reduce((sum, p) => sum + (Number(p.deposit_amount || p.deposit_fee || 0)), 0);
        
        const period = form.payment_period || (form.start_date ? form.start_date.split('/').slice(1).join('/') : '');
        const rentPaid = contractPayments
          .filter((p: any) => p.payment_period === period)
          .reduce((sum, p) => sum + (Number(p.base_rent) || 0), 0);

        // Build a temporary form for this room
        const roomForm: PaymentFormData = {
          ...form,
          room_id: rid,
          contract_id: contract.id,
          tenant: getContractTenantName(contract),
          phone: getContractTenantPhone(contract),
          people_count: Number(contract.people_count) || 1,
          base_rent: Math.max(0, exp.basePrice - rentPaid),
          extra_person_fee: exp.extraPersonFee,
          living_fee: exp.internetSurcharge,
          water_fee: exp.livingFee,
          electric_fee: exp.electricFee,
          deposit_fee: Math.max(0, exp.deposit - depositPaid),
          deposit_paid: depositPaid, // But show how much is paid
          payment_period: form.payment_period || (form.start_date ? form.start_date.split('/').slice(1).join('/') : ''),
          old_electric: exp.oldElectric,
          new_electric: exp.oldElectric,
          electric_usage: 0,
          discount: exp.discount,
          amount: 0, // Not needed for notice
          receiver: 'Chưa nhận',
          received_date: todayStr(),
          note: isNextMonth ? `Tháng ${form.start_date.split('/')[1]}/${form.start_date.split('/')[2]}` : form.note,
          included_fields: ['base_rent', 'extra_person_fee', 'living_fee', 'water_fee', 'electric_fee'],
          stayed_days: exp.stayed_days,
          period_days: exp.period_days,
        };

        // We don't save payments here, we just need to generate the PDF.
        // But the current API doesn't have a "preview only" PDF for room.
        // It uses `generateReceiptPdf` which needs a payment_id or `generatePaymentPdf` for contract.
        // Let's create a temporary payment or use an API that can handle this.
        // For now, let's create a "Chưa nhận" payment to get an ID.
        
        const dynamicType = getPaymentTypeLabel(roomForm.included_fields || []);

        const res = await API.createPayment(config, {
          ...roomForm,
          payment_type: dynamicType,
          status: 'Chưa đóng',
          amount: sumBreakdown(roomForm),
        });
        
        // Trigger PDF generation (this part depends on how the user wants to download them)
        // Usually, we just open them in new tabs or combine them.
        const pdfRes = await API.getReceiptPdf(config, res.id);
        results.push({ roomName: rid, pdf: pdfRes.base64 });
      }
      
      if (results.length > 0) {
        // Just open the first one for now or provide links
        const link = document.createElement('a');
        link.href = `data:application/pdf;base64,${results[0].pdf}`;
        link.download = `Thong_bao_thu_tien_${results[0].roomName}.pdf`;
        link.click();
        
        if (results.length > 1) {
          alert(`Đã tạo ${results.length} thông báo. Trình duyệt sẽ tải xuống file đầu tiên.`);
        }
      }
      
      onClose();
    } catch (e: any) {
      setSaveError(e.message || 'Lỗi khi xuất thông báo');
    }
    setSaving(false);
  };

  const handleSubmit = async () => {
    const e = validatePaymentForm(form, needsNewContract);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const expected = getExpected();
    if (form.amount < expected && expected > 0) {
      setPartialConfirm(true);
      return;
    }
    await doSubmit();
  };

  const handlePartialConfirm = async () => {
    setPartialConfirm(false);
    setPendingSubmit(true);
    await doSubmit();
  };

  const handleSubmitWithPdf = async () => {
    pendingPrintPdfRef.current = true;
    const e = validatePaymentForm(form, needsNewContract);
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    const expected = getExpected();
    if (form.amount < expected && expected > 0) {
      setPartialConfirm(true);
      return;
    }
    await doSubmit();
  };

  // ─── Sub-components ─────────────────────────────────────

  const RequiredStar = () => <span className="text-rose-500 ml-0.5">*</span>;
  const FieldErr = ({ msg }: { msg?: string }) => msg && msg.trim() ? <p className="text-rose-500 text-[11px] mt-0.5">{msg}</p> : null;

  const payRoomObj = form.room_id ? data.rooms.find((r: any) => String(r.id) === String(form.room_id)) : null;
  const expResult = form.room_id ? calcExpected() : null;

  const modalTitle = isNoticeMode 
    ? 'Xuất thông báo thu tiền'
    : title || (editItem ? 'Sửa khoản thu' : (payRoomObj ? `Thu tiền — ${payRoomObj.name}` : 'Thu tiền nhanh'));

  return (
    <>
      <Modal open={open} onClose={onClose} title={modalTitle} maxWidth="max-w-xl">
        <div className="space-y-4">
          {/* Room selector (PaymentsTab mode) */}
          {showRoomSelector && !isNoticeMode && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Mã phòng<RequiredStar /></label>
              <select id="select-payment-room" name="room_id" value={form.room_id} onChange={e => onRoomChange(e.target.value)} disabled={!!editItem}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50 ${errors.room_id ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
                <option value="">Chọn phòng...</option>
                {data.rooms.map((r: any) => {
                  const hasHD = !!getActiveContract(r.id);
                  return <option key={r.id} value={r.id}>{r.name} ({r.id}) {hasHD ? '📋' : '🆕'}</option>;
                })}
              </select>
              <FieldErr msg={errors.room_id} />
              {form.room_id && roomActiveContracts.length > 1 && (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-amber-700 mb-1">Chọn hợp đồng ({roomActiveContracts.length} HĐ)</label>
                  <select value={selectedContractId} onChange={e => {
                    const newId = e.target.value;
                    setSelectedContractId(newId);
                    const c = data.contracts.find((cc: any) => String(cc.id) === String(newId));
                    if (c) {
                      const exp = calculateExpectedAmount(form.room_id, data, () => c, false, firstDayOfMonthStr());
                      const fields = applyExpectedFields(exp, form.room_id);
                      setForm(prev => ({
                        ...prev,
                        contract_id: c.id,
                        tenant: getContractTenantName(c),
                        phone: getContractTenantPhone(c),
                        people_count: Number(c.people_count) || 1,
                        ...fields,
                      }));
                    }
                  }}
                    className="w-full border border-amber-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none bg-amber-50/30">
                    {roomActiveContracts
                      .sort((a: any, b: any) => String(b.id || '').localeCompare(String(a.id || '')))
                      .map((c: any) => (
                        <option key={c.id} value={c.id}>
                          #{c.id} — {getContractTenantName(c) || c.tenant}
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-amber-500 mt-0.5">Phòng có nhiều hợp đồng, chọn hợp đồng muốn thu tiền</p>
                </div>
              )}
            </div>
          )}

          {/* Multi-room selector for Notice Mode */}
          {isNoticeMode && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">Chọn phòng cần xuất ({selectedRoomIds.length})</label>
              <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                {data.rooms.filter(r => r.status === 'occupied').map((r: any) => (
                  <button key={r.id} 
                    onClick={() => {
                      const next = selectedRoomIds.includes(r.id) 
                        ? selectedRoomIds.filter(id => id !== r.id)
                        : [...selectedRoomIds, r.id];
                      setSelectedRoomIds(next);
                      if (next.length === 1) onRoomChange(next[0]);
                    }}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${selectedRoomIds.includes(r.id) ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Room info header (RoomsTab mode — room pre-selected) */}
          {!showRoomSelector && !isNoticeMode && payRoomObj && (
            <div className="bg-slate-50 rounded-xl p-3 flex items-center justify-between">
              <div><span className="font-bold text-slate-900">{payRoomObj.name}</span><span className="text-xs text-slate-500 ml-2">{payRoomObj.type}</span></div>
              <span className="text-sm font-medium text-indigo-600">{formatVND(payRoomObj.price || 0)}/tháng</span>
            </div>
          )}

          {/* New contract section */}
          {needsNewContract && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
              <p className="font-medium text-amber-800 mb-2">🆕 Phòng trống — sẽ tự động tạo hợp đồng mới</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tên khách<RequiredStar /></label>
                  <input id="input-tenant-name" name="tenant" value={form.tenant} onChange={e => F('tenant', e.target.value)}
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.tenant ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.tenant} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Số điện thoại</label>
                  <input id="input-tenant-phone" name="phone" value={form.phone} onChange={e => F('phone', e.target.value)} placeholder="0901234567"
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.phone ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.phone} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Số CCCD</label>
                  <input id="input-tenant-cccd" name="cccd" value={form.cccd} onChange={e => F('cccd', e.target.value)} placeholder="079123456789"
                    className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.cccd ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`} />
                  <FieldErr msg={errors.cccd} />
                </div>
                {showExtendedTenantFields && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Ngày cấp CCCD</label>
                      <DatePickerInput value={form.issue_date} onChange={v => F('issue_date', v)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Nơi cấp CCCD</label>
                      <select id="select-tenant-issue-place" name="issue_place"
                        value={form.issue_place}
                        onChange={e => F('issue_place', e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
                      >
                        <option value="Cục Cảnh Sát">Cục Cảnh Sát</option>
                        <option value="Bộ Công An">Bộ Công An</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Năm sinh</label>
                      <input id="input-tenant-dob" name="dob" value={form.dob} onChange={e => F('dob', e.target.value)} placeholder="1995"
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Địa chỉ thường trú</label>
                      <textarea id="input-tenant-address" name="address" value={form.address} onChange={e => F('address', e.target.value)} placeholder="Số 123, Đường ABC, Quận 1, TP.HCM" rows={2}
                        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none resize-none" />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Thời hạn HĐ (tháng)</label>
                  <input id="input-contract-duration" name="duration" type="number" min={minMonths} max={maxMonths} value={form.duration}
                    inputMode="numeric"
                    onChange={e => F('duration', Math.max(minMonths, Math.min(maxMonths, Number(e.target.value) || minMonths)))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  <p className="text-[11px] text-slate-400 mt-0.5">{minMonths}–{maxMonths} tháng</p>
                </div>
              </div>
            </div>
          )}

          {/* Existing contract info */}
          {!needsNewContract && form.contract_id && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800 flex items-center gap-2">
              📋 HĐ: <span className="font-mono text-xs">{form.contract_id}</span> — {form.tenant}
            </div>
          )}

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="flex items-end gap-3">
              {!needsNewContract && (
                <button 
                  onClick={() => setIsContractEditable(!isContractEditable)}
                  className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase transition-colors ${isContractEditable ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}
                >
                  {isContractEditable ? 'Đang sửa' : 'Sửa nhanh'}
                </button>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {/* Additional fields moved into the same grid */}
                <div className={(!needsNewContract && !isContractEditable) ? 'opacity-70' : ''}>
                  <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Số người ở</label>
                  <input id="input-people-count" name="people_count" type="number" min={1} value={form.people_count}
                    inputMode="numeric"
                    disabled={!needsNewContract && !isContractEditable}
                    onChange={e => handlePeopleCountChange(Number(e.target.value) || 1)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none disabled:bg-slate-50" />
                </div>

                <div className={`${(!needsNewContract && !isContractEditable) ? 'opacity-70' : ''} ${!form.included_fields?.includes('extra_person_fee') ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-1 mb-1">
                    <input id="checkbox-extra-person-fee" name="extra_person_fee" type="checkbox" checked={form.included_fields?.includes('extra_person_fee')}
                      disabled={!needsNewContract && !isContractEditable}
                      onChange={() => toggleField('extra_person_fee')}
                      className="w-3 h-3 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 disabled:opacity-50" />
                    <label className="block text-[10px] uppercase font-bold text-slate-400">Phụ thu</label>
                  </div>
                  <input id="input-breakdown-extra-person" name="extra_person_fee" type="number" value={form.extra_person_fee} 
                    disabled={!needsNewContract && !isContractEditable}
                    onChange={e => handleBreakdownChange('extra_person_fee', Number(e.target.value))}
                    step="1000" inputMode="numeric"
                    className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm disabled:bg-slate-50" />
                </div>

                <div className={(!needsNewContract && !isContractEditable) ? 'opacity-70' : ''}>
                  <label className="block text-[10px] uppercase font-bold text-rose-500 mb-1">Chiết khấu DV</label>
                  <input id="input-breakdown-discount" name="discount" type="number" value={form.discount} 
                    disabled={!needsNewContract && !isContractEditable}
                    onChange={e => handleBreakdownChange('discount', Number(e.target.value))}
                    step="1000" inputMode="numeric"
                    className="w-full bg-white border border-rose-200 rounded-lg px-2 py-1 text-sm text-rose-600 focus:ring-1 focus:ring-rose-400 focus:outline-none disabled:bg-slate-50" />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold text-amber-600 mb-1">Nợ kỳ trước</label>
                  <input id="input-breakdown-debt" name="previous_debt" type="number" value={form.previous_debt} 
                    onChange={e => handleBreakdownChange('previous_debt', Number(e.target.value))}
                    step="1000" inputMode="numeric"
                    className="w-full bg-white border border-amber-200 rounded-lg px-2 py-1 text-sm text-amber-700 focus:ring-1 focus:ring-amber-400 focus:outline-none" />
                </div>
              </div>
            </div>
          </div>

          {/* Days Proration & Main Monthly Fees */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Số ngày tính phí</label>
                <div className="flex items-center gap-2">
                  {form.stayed_days === form.period_days ? (
                    <div className="flex-1 bg-white border border-indigo-200 text-indigo-700 font-bold rounded-xl px-3 py-2 text-sm">1 tháng</div>
                  ) : (
                    <input id="input-prorate-days" name="stayed_days" type="number" value={form.stayed_days} onChange={e => handleDaysChange(Number(e.target.value) || 0)}
                      inputMode="numeric"
                      className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" />
                  )}
                  {form.stayed_days === form.period_days && (
                    <button onClick={() => handleDaysChange(form.period_days - 1)} className="text-[10px] text-indigo-600 font-medium hover:underline">Sửa</button>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tính từ ngày / Tháng sau?</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1"><DatePickerInput value={form.start_date || ''} onChange={handleStartDateChange} /></div>
                  <button 
                    onClick={toggleNextMonth}
                    className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${isNextMonth ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-indigo-600 hover:bg-indigo-50'}`}>
                    {isNextMonth ? '✅' : '>>'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Kỳ thanh toán (MM/YYYY)</label>
                <input id="input-payment-period" name="payment_period"
                  value={form.payment_period}
                  onChange={e => F('payment_period', e.target.value)}
                  placeholder="MM/YYYY"
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none" 
                />
              </div>
            </div>

            {expResult && expResult.stayed_days < expResult.period_days && (
              <p className="text-[11px] text-indigo-600 bg-white/50 px-2 py-1 rounded-lg border border-indigo-100 italic">
                Hệ thống đang tính tỉ lệ {expResult.stayed_days}/{expResult.period_days} ngày.
              </p>
            )}

            <div className="border-t border-slate-200 pt-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <input type="checkbox" name="monthly_group"
                    checked={['base_rent', 'water_fee', 'living_fee', 'electric_fee', 'extra_person_fee'].every(k => form.included_fields?.includes(k))}
                    onChange={toggleMonthlyGroup}
                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" />
                  <label className="text-sm font-bold text-slate-700">Các khoản phí cố định (Phòng + Nước + Dịch vụ + Điện)</label>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { key: 'base_rent', label: 'Tiền phòng' },
                  { key: 'water_fee', label: 'Nước' },
                  { key: 'living_fee', label: 'Dịch vụ' },
                  { key: 'electric_fee', label: 'Điện' },
                ].map(({ key, label }) => (
                  <div key={key} className={!form.included_fields?.includes(key) ? 'opacity-40' : ''}>
                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">{label}</label>
                    {key === 'electric_fee' && form.included_fields?.includes('electric_fee') ? (
                      <div className="space-y-1">
                        <div className="flex gap-1">
                          <input id="input-electric-old" name="old_electric" type="number" value={form.old_electric} placeholder="Cũ" onChange={e => handleElectricReadingChange('old_electric', Number(e.target.value))}
                            className="w-full bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none" title="Chỉ số cũ" />
                          <input id="input-electric-new" name="new_electric" type="number" value={form.new_electric} placeholder="Mới" onChange={e => handleElectricReadingChange('new_electric', Number(e.target.value))}
                            className="w-full bg-white border border-indigo-200 rounded px-1.5 py-0.5 text-[11px] focus:outline-none" title="Chỉ số mới" />
                        </div>
                        <input id={`input-breakdown-${key}`} name={key} type="number" value={(form as any)[key]} onChange={e => handleBreakdownChange(key, Number(e.target.value))}
                          step="1000" inputMode="numeric"
                          className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-indigo-600 focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
                      </div>
                    ) : (
                      <input id={`input-breakdown-${key}`} type="number" value={(form as any)[key]} onChange={e => handleBreakdownChange(key, Number(e.target.value))}
                        step="1000" inputMode="numeric"
                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm focus:ring-1 focus:ring-indigo-400 focus:outline-none" />
                    )}
                  </div>
                ))}
              </div>

              {form.included_fields?.includes('electric_fee') && (
                <p className="text-[10px] text-slate-400 mt-2 italic text-center">
                  Tiền điện = ({form.new_electric} - {form.old_electric}) kWh × {formatVND(Number(data.settings.ELECTRIC_PRICE) || 0)}/kWh
                </p>
              )}
            </div>
          </div>

          {/* Section 3: Security Deposit */}
          {!isNoticeMode && (
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input type="checkbox" name="deposit_fee" checked={form.included_fields?.includes('deposit_fee')} onChange={() => toggleField('deposit_fee')}
                    className="w-4 h-4 text-amber-600 border-amber-300 rounded focus:ring-amber-500" />
                  <label className="text-sm font-bold text-amber-800 uppercase tracking-wide">Tiền cọc (Thế chân)</label>
                </div>
                <input id="input-breakdown-deposit" name="deposit_fee" type="number" value={form.deposit_fee} onChange={e => handleBreakdownChange('deposit_fee', Number(e.target.value))}
                  step="1000" inputMode="numeric"
                  className={`w-32 bg-white border rounded-xl px-3 py-2 text-sm font-bold text-right ${form.included_fields?.includes('deposit_fee') ? 'border-amber-200 text-amber-700' : 'border-amber-50 opacity-40'}`} />
              </div>
              {form.included_fields?.includes('deposit_fee') && form.deposit_paid > 0 && (
                <div className="mt-2 text-[11px] text-amber-700 flex justify-between px-1">
                  <span>Đã thu trước đó:</span>
                  <span className="font-bold">{formatVND(form.deposit_paid)}</span>
                </div>
              )}
            </div>
          )}

          {/* Payment execution details */}
          <div className="grid grid-cols-2 gap-4">
            {/* Amount and Total */}
            <div className="col-span-2 bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex justify-between items-center mb-1">
              <div>
                <label className="block text-xs font-medium text-indigo-900 mb-1 uppercase tracking-wider opacity-70">Tổng cộng định mức</label>
                <div className="text-2xl font-black text-indigo-700 leading-none">{formatVND(sumBreakdown(form))}</div>
              </div>
              <div className="w-40 text-right">
                <label className="block text-xs font-medium text-slate-600 mb-1">Số tiền thực thu<RequiredStar /></label>
                <input id="input-actual-amount" name="amount" type="number" value={form.amount} onChange={e => handleAmountChange(Number(e.target.value))}
                  step="1000" inputMode="numeric"
                  className={`w-full bg-white border rounded-xl px-3 py-2 text-sm font-bold text-indigo-700 focus:ring-2 focus:ring-indigo-400 focus:outline-none ${errors.amount ? 'border-rose-400 bg-rose-50/30' : 'border-indigo-200'}`} />
                {form.amount > 0 && <p className="text-[10px] font-bold text-indigo-500 mt-1">{formatVND(form.amount)}</p>}
                <FieldErr msg={errors.amount} />
              </div>
            </div>

            {/* Received Date */}
            {form.receiver !== 'Chưa nhận' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Ngày thu</label>
                <div className="flex items-center gap-2">
                  {form.received_date === todayStr() ? (
                    <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-600">Hôm nay</div>
                  ) : (
                    <div className="flex-1"><DatePickerInput value={form.received_date} onChange={v => F('received_date', v)} /></div>
                  )}
                  {form.received_date === todayStr() && (
                    <button onClick={() => F('received_date', '')} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Chọn</button>
                  )}
                  {form.received_date !== todayStr() && (
                    <button onClick={() => F('received_date', todayStr())} className="text-[11px] text-indigo-600 font-medium px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 whitespace-nowrap">Nay</button>
                  )}
                </div>
              </div>
            )}

            {/* Receiver */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Người nhận<RequiredStar /></label>
              <select id="select-receiver" name="receiver" value={form.receiver} onChange={e => onReceiverChange(e.target.value)}
                disabled={editItem && editItem.receiver !== 'Chưa nhận' && editItem.receiver !== ''}
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none ${editItem && editItem.receiver !== 'Chưa nhận' && editItem.receiver !== '' ? 'bg-slate-50 opacity-70 cursor-not-allowed' : ''} ${errors.receiver ? 'border-rose-400 bg-rose-50/30' : 'border-slate-200'}`}>
                <option value="Chưa nhận">Chưa nhận</option>
                {receivers.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <FieldErr msg={errors.receiver} />
            </div>

            {/* Method */}
            {form.receiver !== 'Chưa nhận' && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Hình thức</label>
                <select id="select-payment-method" name="method" value={form.method} onChange={e => F('method', e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none">
                  <option value="Tiền mặt">Tiền mặt</option>
                  <option value="Chuyển khoản">Chuyển khoản</option>
                </select>
              </div>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ghi chú</label>
            <textarea id="textarea-note" name="note" value={form.note} onChange={e => F('note', e.target.value)} rows={2} placeholder="Tháng 4/2026..."
              className={`w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none`} />
          </div>

          {saveError && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">⚠️ {saveError}</div>}

          {isNoticeMode ? (
            <button onClick={handleBatchExport} disabled={saving || pendingSubmit || selectedRoomIds.length === 0}
              className="w-full text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700">
              {(saving || pendingSubmit) && <Loader2 size={16} className="animate-spin" />}
              <ScrollText size={18} /> Xuất {selectedRoomIds.length} thông báo
            </button>
          ) : (
            <div className="flex gap-3">
              <button onClick={handleSubmit} disabled={saving || pendingSubmit}
                className="flex-1 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700">
                {(saving || pendingSubmit) && <Loader2 size={16} className="animate-spin" />}
                <Banknote size={18} />
                {editItem ? 'Cập nhật' : (form.receiver === 'Chưa nhận' ? 'Tạo thông báo thu tiền' : (needsNewContract ? 'Tạo HĐ + Thu tiền' : 'Thu tiền'))}
              </button>
              <button onClick={handleSubmitWithPdf} disabled={saving || pendingSubmit}
                className="flex-1 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 shadow-sm shadow-amber-200">
                {(saving || pendingSubmit) && <Loader2 size={16} className="animate-spin" />}
                <FileText size={16} />
                {editItem ? 'Cập nhật và in PDF' : 'Tạo thông báo và in PDF'}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Partial Payment Confirmation */}
      <ConfirmDialog open={partialConfirm} onClose={() => setPartialConfirm(false)} onConfirm={handlePartialConfirm}
        loading={pendingSubmit} title="Xác nhận thanh toán thiếu" confirmLabel="Xác nhận ghi nhận"
        message={`Số tiền ${formatVND(form.amount)} thấp hơn mức định mức ${formatVND(getExpected())}. Giao dịch sẽ được ghi nhận là "Trả thiếu". Bạn có chắc muốn tiếp tục?`} />
    </>
  );
}
