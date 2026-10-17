import {
  extractAmount,
  isGopayApp,
  isPaymentReceived,
  parsePayment,
  toRupiah,
} from '../src/payment';

describe('isGopayApp', () => {
  it.each([
    ['com.gojek.gopaymerchant', 'whatever'],
    ['com.example.app', 'GoPay Merchant'],
    ['com.example.app', 'gopay'],
    ['id.gopay.business', 'Bisnis'],
  ])('matches %s / %s', (pkg, name) => {
    expect(isGopayApp(pkg, name)).toBe(true);
  });

  it.each([
    ['com.gojek.app', 'Gojek'],
    ['com.whatsapp', 'WhatsApp'],
  ])('does not match %s / %s', (pkg, name) => {
    expect(isGopayApp(pkg, name)).toBe(false);
  });
});

describe('isPaymentReceived', () => {
  it.each([
    'Pembayaran diterima',
    'Pembayaran QRIS berhasil',
    'Uang masuk Rp10.000',
    'Dana masuk',
    'Saldo masuk Rp 50.000',
    'Kamu menerima pembayaran dari Budi',
    'Pembayaran masuk',
    'QRIS masuk',
    'Rp50.000 masuk ke saldo',
    'Payment received',
    'Transfer masuk Rp1.000.000',
    'UANG MASUK',
  ])('detects: %s', text => {
    expect(isPaymentReceived(text)).toBe(true);
  });

  it('looks across title, text and sub text', () => {
    expect(
      isPaymentReceived('GoPay Merchant', 'Rp25.000', 'Pembayaran diterima'),
    ).toBe(true);
  });

  it.each([
    'Promo cashback hingga 50%',
    'Verifikasi akun kamu',
    'Pembayaran dibatalkan',
    'Selamat datang di GoPay',
    'Ada voucher baru untukmu',
    '',
  ])('ignores: %s', text => {
    expect(isPaymentReceived(text)).toBe(false);
  });
});

describe('toRupiah', () => {
  it.each([
    ['10.000', 10000],
    ['1.250.000', 1250000],
    ['25000', 25000],
    ['10.000,50', 10000],
    ['10,000', 10000],
    ['1.250.000,00', 1250000],
    ['10.000.', 10000],
    ['5', 5],
  ])('%s -> %i', (raw, expected) => {
    expect(toRupiah(raw)).toBe(expected);
  });

  it('returns null for non numeric input', () => {
    expect(toRupiah('.')).toBeNull();
  });
});

describe('extractAmount', () => {
  it.each([
    ['Rp10.000', 10000],
    ['Rp 25.000', 25000],
    ['rp1.250.000,50 telah masuk', 1250000],
    ['IDR 75.000', 75000],
    ['Pembayaran Rp.100.000 diterima', 100000],
  ])('%s -> %i', (text, expected) => {
    expect(extractAmount(text)).toBe(expected);
  });

  it('returns null when there is no amount', () => {
    expect(extractAmount('Pembayaran diterima', 'tanpa nominal')).toBeNull();
  });

  it('takes the first text that has an amount', () => {
    expect(extractAmount('tidak ada', 'Rp5.000')).toBe(5000);
  });
});

describe('parsePayment', () => {
  it('returns amount for a typical QRIS notification', () => {
    expect(
      parsePayment('Pembayaran diterima', 'Rp37.500 dari pelanggan via QRIS'),
    ).toEqual({
      amount: 37500,
    });
  });

  it('is still a payment when no amount can be read', () => {
    expect(parsePayment('Uang masuk', 'Cek aplikasi untuk detail')).toEqual({
      amount: null,
    });
  });

  it('reads the amount from the title when the text has none', () => {
    expect(parsePayment('Rp12.000 masuk', 'GoPay Merchant')).toEqual({
      amount: 12000,
    });
  });

  it('returns null for non payment notifications', () => {
    expect(parsePayment('Promo', 'Diskon Rp10.000 untuk kamu')).toBeNull();
  });
});
