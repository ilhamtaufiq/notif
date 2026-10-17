import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationLog from './Notifications';
import { api, type Notif } from '../lib/api';

vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return {
    ...real,
    api: {
      notifications: vi.fn(),
      apps: vi.fn(),
      streamUrl: vi.fn(() => 'http://test/api/stream?token=t'),
    },
  };
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, (() => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string) {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

const notif = (id: number, over: Partial<Notif> = {}): Notif => ({
  id,
  device_id: 'dev1',
  package: 'com.whatsapp',
  app_name: 'WhatsApp',
  title: `Title ${id}`,
  text: `Body ${id}`,
  sub_text: '',
  category: '',
  posted_at: 1_760_000_000_000 + id,
  received_at: 1_760_000_000_000 + id,
  is_payment: false,
  payment_amount: null,
  ...over,
});

const rows = [
  notif(3, {
    package: 'com.gojek.gopaymerchant',
    app_name: 'GoPay Merchant',
    title: 'Pembayaran diterima',
    text: 'Rp25.000 masuk',
    is_payment: true,
    payment_amount: 25000,
  }),
  notif(2, {
    package: 'com.gojek.gopaymerchant',
    app_name: 'GoPay Merchant',
    title: 'Promo',
    text: 'Cashback hari ini',
  }),
  notif(1),
];

const mockApi = api as unknown as {
  notifications: ReturnType<typeof vi.fn>;
  apps: ReturnType<typeof vi.fn>;
};
const lastParams = () => mockApi.notifications.mock.calls.at(-1)![0];
const devices = [{ id: 'dev1', name: 'Pixel', created_at: 0, last_seen: null, notif_count: 3 }];

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  mockApi.notifications.mockReset().mockResolvedValue({ items: rows, total: 3 });
  mockApi.apps.mockReset().mockResolvedValue([]);
});

describe('NotificationLog', () => {
  it('shows every notification with the parser verdict', async () => {
    render(<NotificationLog devices={devices} />);
    expect(await screen.findByText('Title 1')).toBeInTheDocument();
    expect(screen.getByText(/Pembayaran ·/)).toHaveTextContent('Rp25.000');
    expect(screen.getByText(/tidak dikenali sebagai pembayaran/)).toBeInTheDocument();
    expect(screen.getAllByText('bukan pembayaran')).toHaveLength(1); // the WhatsApp one
    expect(screen.getByText(/3 notifikasi/)).toBeInTheDocument();
  });

  it('flags an unreadable amount on a recognised payment', async () => {
    mockApi.notifications.mockResolvedValue({
      items: [notif(5, { app_name: 'GoPay Merchant', is_payment: true, payment_amount: null })],
      total: 1,
    });
    render(<NotificationLog devices={devices} />);
    expect(await screen.findByText(/nominal tidak terbaca/)).toBeInTheDocument();
  });

  it('reveals the raw JSON of a notification', async () => {
    render(<NotificationLog devices={devices} />);
    await screen.findByText('Title 1');
    expect(screen.queryByText(/"package": "com.whatsapp"/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Raw')[2]);
    expect(screen.getByText(/"package": "com.whatsapp"/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sembunyikan raw'));
    expect(screen.queryByText(/"package": "com.whatsapp"/)).not.toBeInTheDocument();
  });

  it('filters by parser result', async () => {
    render(<NotificationLog devices={devices} />);
    await screen.findByText('Title 1');
    fireEvent.change(screen.getByLabelText('Hasil parser'), { target: { value: 'yes' } });
    await waitFor(() => expect(lastParams()).toMatchObject({ payment: 'yes', offset: 0 }));
    fireEvent.change(screen.getByLabelText('Hasil parser'), { target: { value: '' } });
    await waitFor(() => expect(lastParams().payment).toBeUndefined());
  });

  it('"Cek GoPay yang terlewat" searches gopay among non-payments', async () => {
    render(<NotificationLog devices={devices} />);
    await screen.findByText('Title 1');
    fireEvent.click(screen.getByText('Cek GoPay yang terlewat'));
    await waitFor(() => expect(lastParams()).toMatchObject({ q: 'gopay', payment: 'no' }));
    expect(screen.getByText('Reset filter')).toBeInTheDocument();
  });

  it('copies the visible page as JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<NotificationLog devices={devices} />);
    await screen.findByText('Title 1');
    fireEvent.click(screen.getByText('Salin JSON halaman ini'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0][0]);
    expect(copied).toHaveLength(3);
    expect(copied[0]).toMatchObject({ is_payment: true, payment_amount: 25000 });
    expect(await screen.findByText('Tersalin ✓')).toBeInTheDocument();
  });

  it('refetches when a notification arrives live, and stops when live is off', async () => {
    render(<NotificationLog devices={devices} />);
    await screen.findByText('Title 1');
    const before = mockApi.notifications.mock.calls.length;

    act(() => FakeEventSource.instances[0].emit('notification'));
    await waitFor(() => expect(mockApi.notifications.mock.calls.length).toBe(before + 1));

    fireEvent.click(screen.getByRole('checkbox'));
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it('shows an empty state', async () => {
    mockApi.notifications.mockResolvedValue({ items: [], total: 0 });
    render(<NotificationLog devices={devices} />);
    expect(await screen.findByText('Tidak ada notifikasi.')).toBeInTheDocument();
  });
});
