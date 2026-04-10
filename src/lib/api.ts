// API Client for the apartment dashboard

export interface AppConfig {
  apiUrl: string;
  token: string;
}

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

export const API = {
  getStats: (config: AppConfig) => fetchApi<any>(config, '/api/stats'),
  getRooms: (config: AppConfig) => fetchApi<any[]>(config, '/api/rooms'),
  getContracts: (config: AppConfig) => fetchApi<any[]>(config, '/api/contracts'),
  getPayments: (config: AppConfig) => fetchApi<any[]>(config, '/api/payments'),
  completePayment: (config: AppConfig, id: string) => fetchApi<void>(config, `/api/payments/${id}/complete`, { method: 'POST' }),
};
