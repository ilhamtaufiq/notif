import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Transactions from './Transactions';
import { api, type Payment } from '../lib/api';
import { playPaymentSound } from '../lib/sound';

vi.mock('../lib/sound', () => ({
  isSoundEnabled: vi.fn(() => true),
  setSoundEnabled: vi.fn(),
  playPaymentSound: vi.fn(),
}));

vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return {
    ...real,
    api: {
      payments: vi.fn(),
      paymentSummary: vi.fn(),
      streamUrl: vi.fn(() => 'http://test/api/stream?token=t'),
    },
  };
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, ((ev: MessageEvent) => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const pay = (id: number, amount: number | null, text = 'dari pelanggan'): Payment => ({
  id,
  notification_id: id,
  device_id: 'd',
  amount,
  paid_at: 1_760_000_000_000 + id,
  app_name: 'GoPay Merchant',
  title: 'Pembayaran diterima',
  text,
});

const summary = {
  today: { count: 2, sum: 125000 },
  last7: { count: 5, sum: 300000 },
  last30: { count: 9, sum: 900000 },
  by_day: [{ day_start: 1_760_000_000_000, count: 2, sum: 125000 }],
};

const mockApi = api as unknown as {
  payments: ReturnType<typeof vi.fn>;
  paymentSummary: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.mocked(playPaymentSound).mockClear();
  mockApi.payments.mockReset().mockResolvedValue({
    items: [pay(2, 100000), pay(1, 25000)],
    total: 2,
    sum: 125000,
  });
  mockApi.paymentSummary.mockReset().mockResolvedValue(summary);
});

describe('Transactions', () => {
  it('lists payments with formatted amounts and totals', async () => {
    render(<Transactions />);
    expect(await screen.findByText('Rp100.000')).toBeInTheDocument();
    expect(screen.getByText('Rp25.000')).toBeInTheDocument();
    expect(screen.getByTestId('filtered-sum')).toHaveTextContent('Rp125.000');
    expect(screen.getByText('2 transaksi', { selector: 'b' })).toBeInTheDocument(); // list header
    expect(await screen.findByText('Rp900.000')).toBeInTheDocument(); // 30-day total
  });

  it('shows an empty state', async () => {
    mockApi.payments.mockResolvedValue({ items: [], total: 0, sum: 0 });
    render(<Transactions />);
    expect(await screen.findByText('Belum ada transaksi.')).toBeInTheDocument();
  });

  it('marks payments whose amount could not be read', async () => {
    mockApi.payments.mockResolvedValue({ items: [pay(3, null, 'Uang masuk')], total: 1, sum: 0 });
    render(<Transactions />);
    expect(await screen.findByText(/nominal tidak terbaca/)).toBeInTheDocument();
  });

  it('shows which invoice a payment settled', async () => {
    mockApi.payments.mockResolvedValue({
      items: [{ ...pay(4, 37512), invoice_label: 'Budi' }, pay(3, 1000)],
      total: 2,
      sum: 38512,
    });
    render(<Transactions />);
    expect(await screen.findByText(/Tagihan: Budi/)).toBeInTheDocument();
    expect(screen.getAllByText(/Tagihan:/)).toHaveLength(1);
  });

  it('passes the amount filter to the API and resets to the first page', async () => {
    render(<Transactions />);
    await screen.findByText('Rp100.000');
    fireEvent.change(screen.getByLabelText(/Min/), { target: { value: '50.000' } });
    await waitFor(() =>
      expect(mockApi.payments).toHaveBeenLastCalledWith(
        expect.objectContaining({ min: 50000, offset: 0 }),
      ),
    );
  });

  it('plays the voice and refreshes when a payment arrives live', async () => {
    render(<Transactions />);
    await screen.findByText('Rp100.000');
    const callsBefore = mockApi.payments.mock.calls.length;

    act(() => FakeEventSource.instances[0].emit('payment', pay(9, 40000)));

    expect(playPaymentSound).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockApi.payments.mock.calls.length).toBe(callsBefore + 1));
  });

  it('stays silent when the sound switch is off, but still refreshes', async () => {
    render(<Transactions />);
    await screen.findByText('Rp100.000');
    fireEvent.click(screen.getByLabelText('Suara pembayaran')); // turn off
    vi.mocked(playPaymentSound).mockClear();
    const callsBefore = mockApi.payments.mock.calls.length;

    act(() => FakeEventSource.instances[0].emit('payment', pay(10, 1000)));

    expect(playPaymentSound).not.toHaveBeenCalled();
    await waitFor(() => expect(mockApi.payments.mock.calls.length).toBe(callsBefore + 1));
  });

  it('closes the live connection on unmount', async () => {
    const { unmount } = render(<Transactions />);
    await screen.findByText('Rp100.000');
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
