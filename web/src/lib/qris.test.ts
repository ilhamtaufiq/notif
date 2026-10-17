import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import {
  crc16,
  decodeQrFromImageData,
  parseTlv,
  toDynamic,
  validateStatic,
  withCrc,
  type TlvField,
} from './qris';

// An ordered list (not an object: JS would reorder integer-like keys such as "26" before "00").
const BASE_FIELDS: [string, string][] = [
  ['00', '01'],
  ['01', '11'],
  ['26', '0014ID.CO.QRIS.WWW0215ID1234567890123'],
  ['52', '5812'],
  ['53', '360'],
  ['55', '02'],
  ['58', 'ID'],
  ['59', 'WARUNG CONTOH'],
  ['60', 'CIANJUR'],
  ['61', '43211'],
];

/** Static QRIS fields; `over` replaces a tag's value, or inserts the tag in numeric order if new. */
const staticFields = (over: Record<string, string> = {}): TlvField[] => {
  const map = new Map<string, string>(BASE_FIELDS);
  for (const [tag, value] of Object.entries(over)) map.set(tag, value);
  return [...map.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([tag, value]) => ({ tag, value }));
};
const STATIC = withCrc(staticFields());

describe('crc16', () => {
  it('matches the standard CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe(0x29b1);
  });
});

describe('parseTlv', () => {
  it('splits fields and rejects malformed input', () => {
    expect(parseTlv('000201010211')).toEqual([
      { tag: '00', value: '01' },
      { tag: '01', value: '11' },
    ]);
    expect(parseTlv('0002')).toBeNull(); // length cut off
    expect(parseTlv('00AB01')).toBeNull(); // non numeric length
    expect(parseTlv('000501')).toBeNull(); // declared length longer than data
  });
});

describe('validateStatic', () => {
  it('accepts a static QRIS and reads the merchant', () => {
    expect(validateStatic(STATIC)).toEqual({
      ok: true,
      info: { merchantName: 'WARUNG CONTOH', city: 'CIANJUR' },
    });
  });

  it('rejects bad CRC, dynamic, non-QRIS and garbage', () => {
    const tampered = STATIC.slice(0, -1) + (STATIC.endsWith('0') ? '1' : '0');
    expect(validateStatic(tampered)).toEqual({ ok: false, error: 'bad_crc' });
    expect(validateStatic(withCrc(staticFields({ '01': '12' })))).toEqual({ ok: false, error: 'already_dynamic' });
    expect(validateStatic(withCrc(staticFields({ '00': '02' })))).toEqual({ ok: false, error: 'not_emv_qr' });
    expect(validateStatic('hello world, not a qris!')).toEqual({ ok: false, error: 'malformed' });
    expect(validateStatic('0002')).toEqual({ ok: false, error: 'invalid_length' });
  });
});

describe('toDynamic', () => {
  it('produces a valid dynamic QRIS carrying the amount', () => {
    const dyn = toDynamic(STATIC, 37512);
    const fields = parseTlv(dyn)!;
    const get = (t: string) => fields.find((f) => f.tag === t)?.value;
    expect(get('01')).toBe('12');
    expect(get('54')).toBe('37512');
    expect(get('59')).toBe('WARUNG CONTOH');
    expect(get('26')).toBe('0014ID.CO.QRIS.WWW0215ID1234567890123');
    // CRC is valid: recomputing over everything except the last 4 chars gives the last 4 chars
    expect(crc16(dyn.slice(0, -4)).toString(16).toUpperCase().padStart(4, '0')).toBe(dyn.slice(-4));
    expect(fields[fields.length - 1].tag).toBe('63');
  });

  it('keeps tags in ascending order with the amount after the currency', () => {
    const tags = parseTlv(toDynamic(STATIC, 1000))!.map((f) => Number(f.tag));
    expect(tags).toEqual([...tags].sort((a, b) => a - b));
    expect(tags.indexOf(54)).toBe(tags.indexOf(53) + 1);
  });

  it('drops tip/fee tags and replaces an existing amount', () => {
    const withTip = withCrc(staticFields({ '55': '02', '56': '0210', '57': '0105' }));
    const tags = parseTlv(toDynamic(withTip, 5000))!.map((f) => f.tag);
    expect(tags).not.toContain('55');
    expect(tags).not.toContain('56');
    expect(tags).not.toContain('57');
    const again = toDynamic(withCrc(staticFields({ '54': '999' })), 5000);
    expect(parseTlv(again)!.filter((f) => f.tag === '54')).toEqual([{ tag: '54', value: '5000' }]);
  });

  it('does not change the original static payload and is not itself a static QRIS', () => {
    const before = STATIC;
    const dyn = toDynamic(STATIC, 2000);
    expect(STATIC).toBe(before);
    expect(validateStatic(dyn)).toEqual({ ok: false, error: 'already_dynamic' });
  });

  it('rejects invalid amounts and invalid input', () => {
    for (const bad of [0, -1, 1.5, NaN, 2_000_000_000]) {
      expect(() => toDynamic(STATIC, bad)).toThrow(RangeError);
    }
    expect(() => toDynamic('nope', 1000)).toThrow(/invalid static QRIS/);
  });
});

describe('decodeQrFromImageData', () => {
  /** Renders a QR matrix to RGBA pixels the way a screenshot of it would look. */
  function render(text: string, scale = 6, quiet = 4) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const size = (n + quiet * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.modules.get(y, x)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = ((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx;
            data[px * 4] = data[px * 4 + 1] = data[px * 4 + 2] = 0;
          }
        }
      }
    }
    return { data, size };
  }

  it('reads back the exact QRIS text from a rendered QR image', () => {
    const { data, size } = render(STATIC);
    expect(decodeQrFromImageData(data, size, size)).toBe(STATIC);
  });

  it('returns null when the image has no QR code', () => {
    const blank = new Uint8ClampedArray(200 * 200 * 4).fill(255);
    expect(decodeQrFromImageData(blank, 200, 200)).toBeNull();
  });
});
