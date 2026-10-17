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
