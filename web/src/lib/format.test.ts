import { describe, expect, it } from 'vitest';
import type { Payment } from './api';
import {
  dayRange,
  formatRupiah,
  mergeLivePayment,
  parseAmountInput,
  parserVerdict,
} from './format';

const pay = (id: number, amount: number | null = 1000): Payment => ({
  id,
  notification_id: id,
  device_id: 'd',
  amount,
  paid_at: id,
  app_name: 'GoPay Merchant',
  title: 'Pembayaran diterima',
  text: '',
});

describe('formatRupiah', () => {
  it.each([
    [0, 'Rp0'],
    [500, 'Rp500'],
    [25000, 'Rp25.000'],
    [1250000, 'Rp1.250.000'],
  ])('%i -> %s', (n, expected) => {
    expect(formatRupiah(n)).toBe(expected);
  });

  it('shows a dash when the amount is unknown', () => {
    expect(formatRupiah(null)).toBe('—');
    expect(formatRupiah(undefined)).toBe('—');
  });
});

describe('mergeLivePayment', () => {
  it('puts the new payment first', () => {
    const merged = mergeLivePayment([pay(1), pay(2)], pay(3), 10);
    expect(merged.map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it('replaces an existing copy instead of duplicating', () => {
    const merged = mergeLivePayment([pay(1), pay(2)], pay(2, 999), 10);
    expect(merged.map((p) => p.id)).toEqual([2, 1]);
    expect(merged[0].amount).toBe(999);
  });

  it('caps the list at the limit', () => {
    const merged = mergeLivePayment([pay(1), pay(2), pay(3)], pay(4), 3);
    expect(merged.map((p) => p.id)).toEqual([4, 1, 2]);
  });
});

describe('dayRange', () => {
  it('covers whole local days, inclusive', () => {
    const { from, to } = dayRange('2026-10-18', '2026-10-18');
    expect(new Date(from!).getHours()).toBe(0);
    expect(new Date(to!).getHours()).toBe(23);
    expect(to! - from!).toBe(86_400_000 - 1);
  });

  it('leaves open ends undefined', () => {
    expect(dayRange()).toEqual({});
    expect(dayRange('2026-10-18').to).toBeUndefined();
  });
});

describe('parserVerdict', () => {
  it('payment when the parser recognised it', () => {
    expect(
      parserVerdict({ package: 'com.gojek.gopaymerchant', app_name: 'GoPay Merchant', is_payment: true }),
    ).toBe('payment');
  });

  it('missed when a GoPay app notification was not recognised', () => {
    expect(
      parserVerdict({ package: 'com.gojek.gopaymerchant', app_name: 'x', is_payment: false }),
    ).toBe('missed');
    expect(parserVerdict({ package: 'com.a', app_name: 'GoPay Merchant' })).toBe('missed');
  });

  it('other for everything else', () => {
    expect(parserVerdict({ package: 'com.whatsapp', app_name: 'WhatsApp', is_payment: false })).toBe(
      'other',
    );
  });
});

describe('parseAmountInput', () => {
  it.each([
    ['25000', 25000],
    ['25.000', 25000],
    ['Rp 1.250.000', 1250000],
  ])('%s -> %i', (raw, expected) => {
    expect(parseAmountInput(raw)).toBe(expected);
  });

  it('is undefined for empty input', () => {
    expect(parseAmountInput('')).toBeUndefined();
    expect(parseAmountInput('abc')).toBeUndefined();
  });
});
