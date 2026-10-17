import { describe, expect, it } from 'vitest';
import type { Payment } from './api';
import {
  bestStatus,
  dayRange,
  deviceStatus,
  formatAge,
  formatRupiah,
  lastSeenAge,
  statusFromAge,
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

describe('device health', () => {
  const MIN = 60_000;
  const NOW = 1_800_000_000_000;

  it.each([
    [null, 'never'],
    [2 * MIN, 'active'],
    [14 * MIN, 'active'],
    [16 * MIN, 'idle'],
    [179 * MIN, 'idle'],
    [181 * MIN, 'offline'],
    [3 * 24 * 60 * MIN, 'offline'],
  ])('age %s -> %s', (age, expected) => {
    expect(statusFromAge(age as number | null)).toBe(expected);
    expect(deviceStatus(age == null ? null : NOW - age, NOW)).toBe(expected);
  });

  it('measures age against the server clock, not the browser clock', () => {
    // browser clock is 1 hour ahead of the server: server says the phone was seen 2 min ago
    const loadedAt = NOW + 60 * MIN;
    const d = { last_seen: NOW - 2 * MIN, server_now: NOW };
    expect(lastSeenAge(d, loadedAt, loadedAt)).toBe(2 * MIN);
    // 5 minutes later in the browser, the phone is 7 minutes old
    expect(lastSeenAge(d, loadedAt, loadedAt + 5 * MIN)).toBe(7 * MIN);
    expect(lastSeenAge({ last_seen: null, server_now: NOW }, loadedAt, loadedAt)).toBeNull();
  });

  it('bestStatus: one live phone is enough', () => {
    const live = { last_seen: NOW - MIN, server_now: NOW };
    const dead = { last_seen: NOW - 9 * 60 * MIN, server_now: NOW };
    expect(bestStatus([], NOW, NOW)).toBe('none');
    expect(bestStatus([dead, live], NOW, NOW)).toBe('active');
    expect(bestStatus([dead], NOW, NOW)).toBe('offline');
    expect(bestStatus([{ last_seen: null }], NOW, NOW)).toBe('never');
  });

  it('formatAge in Indonesian', () => {
    expect(formatAge(20_000)).toBe('baru saja');
    expect(formatAge(5 * MIN)).toBe('5 menit lalu');
    expect(formatAge(3 * 60 * MIN)).toBe('3 jam lalu');
    expect(formatAge(72 * 60 * MIN)).toBe('3 hari lalu');
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
