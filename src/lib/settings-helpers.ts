// Helpers to extract settings-derived values for forms

const DEFAULT_RECEIVERS = ['Chủ nhà 01', 'Quản lý 01', 'Thu ngân 01'];

export function getReceivers(settings: Record<string, any>): string[] {
  const raw = settings?.RECEIVERS;
  if (!raw || String(raw).trim() === '') return DEFAULT_RECEIVERS;
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

export function getContractMonthRange(settings: Record<string, any>): { min: number; max: number } {
  const min = Number(settings?.MIN_CONTRACT_MONTHS) || 3;
  const max = Number(settings?.MAX_CONTRACT_MONTHS) || 12;
  return { min, max };
}

/** Check if receiver is the landlord (first receiver = chủ nhà) */
export function isLandlord(receiver: string, settings: Record<string, any>): boolean {
  const receivers = getReceivers(settings);
  // First receiver is always the landlord
  if (receivers.length > 0 && receiver === receivers[0]) return true;
  // Also match if contains "chủ nhà"
  return receiver.toLowerCase().includes('chủ nhà');
}

/** Auto-determine payment status based on receiver */
export function autoPaymentStatus(receiver: string, settings: Record<string, any>): string {
  return isLandlord(receiver, settings) ? 'Hoàn thành' : 'Chưa tới chủ nhà';
}
