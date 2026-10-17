import jsQR from 'jsqr';

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as used by QRIS tag 63. */
export function crc16(data: string): number {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

const crcHex = (data: string) => crc16(data).toString(16).toUpperCase().padStart(4, '0');

export interface TlvField {
  tag: string;
  value: string;
}

/** Splits a payload into top-level TLV fields; null when it is not well-formed. */
export function parseTlv(s: string): TlvField[] | null {
  const out: TlvField[] = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2);
    const lenStr = s.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) return null;
    const len = Number(lenStr);
    i += 4;
    if (i + len > s.length) return null;
    out.push({ tag, value: s.slice(i, i + len) });
    i += len;
  }
  return out;
}

export function buildTlv(fields: TlvField[]): string {
  return fields.map((f) => `${f.tag}${String(f.value.length).padStart(2, '0')}${f.value}`).join('');
}

/** Builds a payload from fields and appends a valid CRC (tag 63). */
export function withCrc(fields: TlvField[]): string {
  const body = `${buildTlv(fields)}6304`;
  return body + crcHex(body);
}

export type QrisError =
  | 'invalid_length'
  | 'malformed'
  | 'not_emv_qr'
  | 'missing_crc'
  | 'bad_crc'
  | 'already_dynamic'
  | 'unknown_initiation';

export interface QrisInfo {
  merchantName: string;
  city: string;
}

export type Validation = { ok: true; info: QrisInfo } | { ok: false; error: QrisError };

/** Checks that `payload` is a well-formed, CRC-valid *static* QRIS. Mirrors the backend rules. */
export function validateStatic(payload: string): Validation {
  if (payload.length < 20 || payload.length > 1024) return { ok: false, error: 'invalid_length' };
  const tlv = parseTlv(payload);
  if (!tlv) return { ok: false, error: 'malformed' };
  if (tlv[0]?.tag !== '00' || tlv[0].value !== '01') return { ok: false, error: 'not_emv_qr' };
  const last = tlv[tlv.length - 1];
  if (last.tag !== '63' || last.value.length !== 4) return { ok: false, error: 'missing_crc' };
  if (crcHex(payload.slice(0, -4)) !== last.value.toUpperCase()) return { ok: false, error: 'bad_crc' };
  const init = tlv.find((f) => f.tag === '01')?.value;
  if (init === '12') return { ok: false, error: 'already_dynamic' };
  if (init !== '11') return { ok: false, error: 'unknown_initiation' };
  const get = (tag: string) => tlv.find((f) => f.tag === tag)?.value ?? '';
  return { ok: true, info: { merchantName: get('59'), city: get('60') } };
}

/**
 * Turns a static QRIS into a dynamic one that asks for exactly `amount` rupiah:
 * initiation method 11 -> 12, amount (tag 54) inserted in order, tip/fee tags (55-57) dropped,
 * CRC recomputed. Throws if the input is not a valid static QRIS or the amount is not a positive integer.
 */
export function toDynamic(staticPayload: string, amount: number): string {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000_000) {
    throw new RangeError('amount must be a whole rupiah between 1 and 1,000,000,000');
  }
  const v = validateStatic(staticPayload);
  if (!v.ok) throw new Error(`invalid static QRIS: ${v.error}`);
  const fields = parseTlv(staticPayload)!
    .filter((f) => !['63', '54', '55', '56', '57'].includes(f.tag))
    .map((f) => (f.tag === '01' ? { tag: '01', value: '12' } : f));
  const at = fields.findIndex((f) => Number(f.tag) > 54);
  const amountField = { tag: '54', value: String(amount) };
  if (at === -1) fields.push(amountField);
  else fields.splice(at, 0, amountField);
  return withCrc(fields);
}

export const qrisErrorMessage: Record<QrisError | 'no_qr' | 'unknown', string> = {
  invalid_length: 'Isi QR terlalu pendek atau terlalu panjang untuk QRIS.',
  malformed: 'Isi QR bukan format QRIS yang valid.',
  not_emv_qr: 'QR ini bukan QRIS.',
  missing_crc: 'QRIS tidak lengkap (CRC tidak ditemukan).',
  bad_crc: 'QRIS rusak atau terpotong (CRC tidak cocok). Coba unggah gambar yang lebih jelas.',
  already_dynamic: 'Ini QRIS dinamis. Unggah QRIS statis milik merchant (yang ditempel di toko).',
  unknown_initiation: 'Jenis QRIS tidak dikenali.',
  no_qr: 'Tidak ada QR yang terbaca di gambar. Coba foto yang lebih jelas, lurus, dan tidak terpotong.',
  unknown: 'Terjadi kesalahan saat memproses QRIS.',
};

/** Decodes a QR code from raw RGBA pixels. Returns the text, or null if none is found. */
export function decodeQrFromImageData(data: Uint8ClampedArray, width: number, height: number): string | null {
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** Reads a QR code from an uploaded image file (downscales very large photos first). */
export async function decodeQrImage(file: Blob, maxSide = 1600): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas not available');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, w, h);
  return decodeQrFromImageData(data, w, h);
}
