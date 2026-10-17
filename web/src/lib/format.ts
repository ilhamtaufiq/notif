import type { Payment } from './api';

/** "Rp1.250.000", or an em dash when the notification carried no readable amount. */
export function formatRupiah(n: number | null | undefined): string {
  return n == null ? '—' : `Rp${n.toLocaleString('id-ID')}`;
}

/** Puts a freshly received payment at the top of the list, replacing any copy, capped at `limit`. */
export function mergeLivePayment(list: Payment[], p: Payment, limit: number): Payment[] {
  return [p, ...list.filter((x) => x.id !== p.id)].slice(0, limit);
}

/** Converts two `YYYY-MM-DD` inputs (local time) to an inclusive [from, to] millisecond range. */
export function dayRange(from?: string, to?: string): { from?: number; to?: number } {
  const out: { from?: number; to?: number } = {};
  if (from) out.from = new Date(`${from}T00:00:00`).getTime();
  if (to) out.to = new Date(`${to}T23:59:59.999`).getTime();
  return out;
}

export type DeviceStatus = 'active' | 'idle' | 'offline' | 'never';

const ACTIVE_MS = 15 * 60_000; // heartbeats come at most every 5 minutes
const IDLE_MS = 3 * 3_600_000;

/** How alive a phone's listener looks, from the age (ms) of its last contact; null = never seen. */
export function statusFromAge(age: number | null): DeviceStatus {
  if (age == null) return 'never';
  if (age < ACTIVE_MS) return 'active';
  return age < IDLE_MS ? 'idle' : 'offline';
}

export function deviceStatus(lastSeen: number | null, now: number): DeviceStatus {
  return statusFromAge(lastSeen == null ? null : now - lastSeen);
}

/** Age in ms of `lastSeen`, using the server's clock reading plus the time elapsed since it was fetched. */
export function lastSeenAge(
  d: { last_seen: number | null; server_now?: number },
  loadedAt: number,
  now: number,
): number | null {
  if (d.last_seen == null) return null;
  const serverNow = (d.server_now ?? loadedAt) + (now - loadedAt);
  return Math.max(0, serverNow - d.last_seen);
}

/** The healthiest status among all devices: a single live phone is enough. */
export function bestStatus(
  devices: { last_seen: number | null; server_now?: number }[],
  loadedAt: number,
  now: number,
): DeviceStatus | 'none' {
  if (devices.length === 0) return 'none';
  const order: DeviceStatus[] = ['active', 'idle', 'offline', 'never'];
  let best = 3;
  for (const d of devices) {
    best = Math.min(best, order.indexOf(statusFromAge(lastSeenAge(d, loadedAt, now))));
  }
  return order[best];
}

export function formatAge(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} jam lalu` : `${Math.round(h / 24)} hari lalu`;
}

export type PaymentFilter = '' | 'yes' | 'no';

/**
 * What the phone parser decided about a logged notification.
 * "missed" = from a GoPay app but not recognised as a payment: the cases worth checking.
 */
export function parserVerdict(n: {
  package: string;
  app_name: string;
  is_payment?: boolean;
}): 'payment' | 'missed' | 'other' {
  if (n.is_payment) return 'payment';
  return /gopay/i.test(n.package) || /gopay/i.test(n.app_name) ? 'missed' : 'other';
}

/** Parses "25000" / "25.000" typed into an amount filter; empty or invalid gives undefined. */
export function parseAmountInput(raw: string): number | undefined {
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
}
