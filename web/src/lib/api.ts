// PUBLIC_API_URL unset  -> dev default (backend on :8080 of the current host)
// PUBLIC_API_URL=""     -> same origin (production behind the nginx /api proxy)
// PUBLIC_API_URL=<url>  -> that URL
const configuredApi = import.meta.env.PUBLIC_API_URL as string | undefined;
export const API: string =
  configuredApi !== undefined
    ? configuredApi.replace(/\/+$/, '')
    : `http://${location.hostname}:8080`;

const TOKEN_KEY = 'notif-listener-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

export interface Notif {
  id: number;
  device_id: string;
  package: string;
  app_name: string;
  title: string;
  text: string;
  sub_text: string;
  category: string;
  posted_at: number;
  received_at: number;
  /** Parser verdict from the log endpoint (absent on live stream rows). */
  is_payment?: boolean;
  payment_amount?: number | null;
}

export interface Device {
  id: string;
  name: string;
  created_at: number;
  last_seen: number | null;
  notif_count: number;
}

export interface AppCount {
  package: string;
  app_name: string;
  count: number;
}

export interface Stats {
  days: number;
  total: number;
  today: number;
  devices: number;
  top_apps: AppCount[];
  by_hour: number[];
  by_day: { day_start: number; count: number }[];
  by_category: { category: string; count: number }[];
}

export interface Payment {
  id: number;
  notification_id: number;
  device_id: string;
  /** Whole rupiah; null when the notification named no readable amount. */
  amount: number | null;
  paid_at: number;
  app_name: string;
  title: string;
  text: string;
}

export interface PaymentTotal {
  count: number;
  sum: number;
}

export interface PaymentSummary {
  today: PaymentTotal;
  last7: PaymentTotal;
  last30: PaymentTotal;
  by_day: { day_start: number; count: number; sum: number }[];
}

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) throw new UnauthorizedError('unauthorized');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

const qs = (params: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  devices: () => request<Device[]>('/api/devices'),
  createDevice: (name: string) =>
    request<{ id: string; name: string; api_key: string }>('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  deleteDevice: (id: string) => request<void>(`/api/devices/${id}`, { method: 'DELETE' }),
  apps: () => request<AppCount[]>('/api/apps'),
  stats: (p: { days: number; device_id?: string }) =>
    request<Stats>(
      `/api/stats${qs({ ...p, tz_offset: -new Date().getTimezoneOffset() })}`,
    ),
  notifications: (p: {
    q?: string;
    device_id?: string;
    package?: string;
    payment?: 'yes' | 'no';
    limit?: number;
    offset?: number;
  }) => request<{ items: Notif[]; total: number }>(`/api/notifications${qs(p)}`),
  payments: (p: {
    from?: number;
    to?: number;
    min?: number;
    max?: number;
    limit?: number;
    offset?: number;
  }) => request<{ items: Payment[]; total: number; sum: number }>(`/api/payments${qs(p)}`),
  paymentSummary: (days = 14) =>
    request<PaymentSummary>(
      `/api/payments/summary${qs({ days, tz_offset: -new Date().getTimezoneOffset() })}`,
    ),
  streamUrl: () => `${API}/api/stream?token=${encodeURIComponent(getToken() ?? '')}`,
};

export const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const fmtAgo = (ms: number | null) => {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
