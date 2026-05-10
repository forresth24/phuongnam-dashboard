// API Client for the apartment dashboard

export interface AppConfig {
  apiUrl: string;
  token: string;
}

export type UserRole = 'admin' | 'viewer';

export async function fetchApi<T>(config: AppConfig, endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${config.apiUrl.replace(/\/$/, '')}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.token}`,
      ...options?.headers,
    },
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON response from server: ${text.substring(0, 50)}...`);
  }

  if (!data.success) {
    throw new Error(data.error || 'Unknown API Error');
  }

  return data.data as T;
}

export interface DashboardData {
  rooms: any[];
  contracts: any[];
  contracts_all: any[];
  payments: any[];
  tenants: any[];
  settings: Record<string, number | string>;
}

export const API = {
  // Role
  getRole: (config: AppConfig) => fetchApi<{ role: UserRole }>(config, '/api/role'),

  // Batch fetch (1 GAS call instead of 5)
  getDashboardData: (config: AppConfig) => fetchApi<DashboardData>(config, '/api/dashboard-data'),

  // Legacy
  getSettings: (config: AppConfig) => fetchApi<any>(config, '/api/settings'),
  getStats: (config: AppConfig) => fetchApi<any>(config, '/api/stats'),
  getRooms: (config: AppConfig) => fetchApi<any[]>(config, '/api/rooms'),
  getContracts: (config: AppConfig) => fetchApi<any[]>(config, '/api/contracts'),
  getPayments: (config: AppConfig) => fetchApi<any[]>(config, '/api/payments'),

  // Rooms CRUD
  createRoom: (config: AppConfig, data: any) =>
    fetchApi<any>(config, '/api/rooms', { method: 'POST', body: JSON.stringify(data) }),
  updateRoom: (config: AppConfig, id: string, data: any) =>
    fetchApi<any>(config, `/api/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRoom: (config: AppConfig, id: string) =>
    fetchApi<any>(config, `/api/rooms/${id}`, { method: 'DELETE' }),

  // Contracts CRUD
  createContract: (config: AppConfig, data: any) =>
    fetchApi<any>(config, '/api/contracts', { method: 'POST', body: JSON.stringify(data) }),
  updateContract: (config: AppConfig, id: string, data: any) =>
    fetchApi<any>(config, `/api/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteContract: (config: AppConfig, id: string) =>
    fetchApi<any>(config, `/api/contracts/${id}`, { method: 'DELETE' }),
  endContract: (config: AppConfig, id: string) =>
    fetchApi<any>(config, `/api/contracts/${id}/end`, { method: 'POST' }),

  // Payments CRUD
  createPayment: (config: AppConfig, data: any) =>
    fetchApi<any>(config, '/api/payments', { method: 'POST', body: JSON.stringify(data) }),
  updatePayment: (config: AppConfig, id: string, data: any) =>
    fetchApi<any>(config, `/api/payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  bulkUpdatePayments: (config: AppConfig, ids: string[], updates: any) =>
    fetchApi<any>(config, '/api/payments/bulk', { method: 'PUT', body: JSON.stringify({ ids, updates }) }),
  deletePayment: (config: AppConfig, id: string) =>
    fetchApi<any>(config, `/api/payments/${id}`, { method: 'DELETE' }),
  completePayment: (config: AppConfig, id: string) =>
    fetchApi<void>(config, `/api/payments/${id}/complete`, { method: 'POST' }),

  // Tenants CRUD
  getTenants: (config: AppConfig) => fetchApi<any[]>(config, '/api/tenants'),
  createTenant: (config: AppConfig, data: any) =>
    fetchApi<any>(config, '/api/tenants', { method: 'POST', body: JSON.stringify(data) }),
  updateTenant: (config: AppConfig, id: string, data: any) =>
    fetchApi<any>(config, `/api/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTenant: (config: AppConfig, id: string) =>
    fetchApi<any>(config, `/api/tenants/${id}`, { method: 'DELETE' }),

  // Settings
  updateSettings: (config: AppConfig, data: Record<string, number | string>) =>
    fetchApi<any>(config, '/api/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // PDF generation
  getContractPdf: (config: AppConfig, contractId: string) =>
    fetchApi<{ base64: string; filename: string }>(config, `/api/pdf/contract/${contractId}`),
  getPaymentPdf: (config: AppConfig, contractId: string) =>
    fetchApi<{ base64: string; filename: string }>(config, `/api/pdf/payment/${contractId}`),
  getSubContractPdf: (config: AppConfig, contractId: string) =>
    fetchApi<{ base64: string; filename: string }>(config, `/api/pdf/sub-contract/${contractId}`),
  getReceiptPdf: (config: AppConfig, paymentId: string) =>
    fetchApi<{ base64: string; filename: string }>(config, `/api/pdf/receipt/${paymentId}`),
};

/** Download a base64 PDF as a file */
export function downloadBase64Pdf(base64: string, filename: string) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
