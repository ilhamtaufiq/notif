/** True for any app whose package or display name contains "gopay" (GoPay, GoPay Merchant, ...). */
export function isGopayApp(pkg: string, appName: string): boolean {
  return /gopay/i.test(pkg) || /gopay/i.test(appName);
}

const AMOUNT = /\b(?:rp|idr)\.?\s*\d[\d.,]*/i;

// Phrases that on their own mean "money came in / payment succeeded".
const STRONG: RegExp[] = [
  /uang\s+masuk/,
  /dana\s+masuk/,
  /saldo\s+masuk/,
  /transfer\s+masuk/,
  /pembayaran\s+(?:\w+\s+){0,3}?(?:diterima|berhasil|masuk|sukses)/,
  /(?:menerima|terima)\s+(?:\w+\s+){0,3}?(?:pembayaran|uang|dana|transfer)/,
  /payment\s+(?:\w+\s+){0,2}?(?:received|successful|success)/,
];

// Money-related words that count when the notification also carries a Rp amount.
const WEAK =
  /pembayaran|uang|dana|saldo|diterima|masuk|berhasil|sukses|payment/;

// Lenient fallback for GoPay wording we have not seen: any money word together with any "came in" word.
const MONEY_WORD = /\b(?:uang|dana|saldo|pembayaran|payment|qris)\b/;
const IN_WORD = /\b(?:masuk|diterima|menerima|terima|received)\b/;

/** Detects "payment received / money in" wording (Indonesian + English) in a notification. */
export function isPaymentReceived(...parts: string[]): boolean {
  const text = parts.join(' ').toLowerCase();
  if (STRONG.some(re => re.test(text))) return true;
  if (MONEY_WORD.test(text) && IN_WORD.test(text)) return true;
  return AMOUNT.test(text) && WEAK.test(text);
}

/** Parses an Indonesian-formatted rupiah string ("10.000", "1.250.000,50") to whole rupiah. */
export function toRupiah(raw: string): number | null {
  const s = raw.replace(/[.,]+$/, '');
  const dec = s.match(/[.,](\d{1,2})$/);
  const intPart = dec ? s.slice(0, dec.index) : s;
  const digits = intPart.replace(/[.,]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** First "Rp <amount>" found in the given texts, in whole rupiah. */
export function extractAmount(...parts: string[]): number | null {
  for (const part of parts) {
    const m = part.match(/(?:rp|idr)\.?\s*(\d[\d.,]*)/i);
    if (m) {
      const n = toRupiah(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

export interface ParsedPayment {
  /** Whole rupiah, or null when the notification names no amount. */
  amount: number | null;
}

/**
 * Returns the payment described by a GoPay notification, or null if it is not an incoming payment.
 * Callers decide whether the app is GoPay (see isGopayApp).
 */
export function parsePayment(
  title: string,
  text: string,
  subText = '',
): ParsedPayment | null {
  if (!isPaymentReceived(title, text, subText)) return null;
  return { amount: extractAmount(text, title, subText) };
}
