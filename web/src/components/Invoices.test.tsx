import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import QRCode from 'qrcode';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Invoices from './Invoices';
import { api, ApiError, type Invoice } from '../lib/api';
import { decodeQrImage, parseTlv, withCrc } from '../lib/qris';
import { isSoundEnabled, playPaymentSound } from '../lib/sound';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA') },
}));

vi.mock('../lib/sound', () => ({
  isSoundEnabled: vi.fn(() => true),
  setSoundEnabled: vi.fn(),
  playPaymentSound: vi.fn(),
}));

vi.mock('../lib/qris', async (orig) => ({
  ...(await orig<typeof import('../lib/qris')>()),
  decodeQrImage: vi.fn(),
}));

vi.mock('../lib/api', async (orig) => {
  const real = await orig<typeof import('../lib/api')>();
  return {
    ...real,
    api: {
      qris: vi.fn(),
      saveQris: vi.fn(),
      deleteQris: vi.fn(),
      invoices: vi.fn(),
      createInvoice: vi.fn(),
      cancelInvoice: vi.fn(),
      markInvoicePaid: vi.fn(),
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
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
}

const STATIC = withCrc([
  { tag: '00', value: '01' },
  { tag: '01', value: '11' },
  { tag: '26', value: '0014ID.CO.QRIS.WWW0215ID1234567890123' },
  { tag: '52', value: '5812' },
  { tag: '53', value: '360' },
  { tag: '58', value: 'ID' },
  { tag: '59', value: 'WARUNG CONTOH' },
  { tag: '60', value: 'CIANJUR' },
]);

const configured = { configured: true, payload: STATIC, merchant_name: 'WARUNG CONTOH', city: 'CIANJUR' };

const invoice = (over: Partial<Invoice> = {}): Invoice => ({
  id: 'inv-1',
  label: 'Budi',
  amount: 37500,
  total_amount: 37512,
  unique_code: 12,
  status: 'open',
  created_at: Date.now(),
  expires_at: Date.now() + 15 * 60_000,
  paid_at: null,
  payment_id: null,
  ...over,
});

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.mocked(playPaymentSound).mockClear();
  vi.mocked(isSoundEnabled).mockReturnValue(true);
  vi.mocked(QRCode.toDataURL as unknown as ReturnType<typeof vi.fn>).mockClear();
  for (const fn of Object.values(m)) fn.mockReset();
  m.streamUrl.mockReturnValue('http://test/api/stream?token=t');
  m.qris.mockResolvedValue(configured);
  m.invoices.mockResolvedValue({ items: [], total: 0 });
});

async function createOne(inv = invoice()) {
  m.createInvoice.mockResolvedValue(inv);
  render(<Invoices />);
  fireEvent.change(await screen.findByLabelText(/Nominal/), { target: { value: '37500' } });
  fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'Budi' } });
  fireEvent.click(screen.getByText('Buat tagihan'));
  return screen.findByAltText(/QRIS Rp37\.512/);
}

describe('Invoices: QRIS upload', () => {
  beforeEach(() => m.qris.mockResolvedValue({ configured: false }));

  it('asks for the static QRIS first and hides the invoice form', async () => {
    render(<Invoices />);
    expect(await screen.findByText(/Unggah QRIS static toko/)).toBeInTheDocument();
    expect(screen.queryByText('Buat tagihan')).not.toBeInTheDocument();
  });

  it('rejects pasted text that is not a valid static QRIS without calling the API', async () => {
    render(<Invoices />);
    fireEvent.change(await screen.findByLabelText('Teks QRIS'), { target: { value: 'bukan qris sama sekali' } });
    fireEvent.click(screen.getByText('Simpan teks QRIS'));
    expect(await screen.findByText(/bukan format QRIS|terlalu pendek/)).toBeInTheDocument();
    expect(m.saveQris).not.toHaveBeenCalled();
  });

  it('saves a valid pasted QRIS and then shows the merchant and the invoice form', async () => {
    m.saveQris.mockResolvedValue(configured);
    render(<Invoices />);
    fireEvent.change(await screen.findByLabelText('Teks QRIS'), { target: { value: `  ${STATIC}\n` } });
    fireEvent.click(screen.getByText('Simpan teks QRIS'));
    expect(await screen.findByText('WARUNG CONTOH')).toBeInTheDocument();
    expect(m.saveQris).toHaveBeenCalledWith(STATIC);
    expect(screen.getByText('Buat tagihan')).toBeInTheDocument();
  });

  it('reads the QR from an uploaded image and saves it', async () => {
    vi.mocked(decodeQrImage).mockResolvedValue(STATIC);
    m.saveQris.mockResolvedValue(configured);
    render(<Invoices />);
    const input = await screen.findByLabelText('Unggah gambar QRIS');
    fireEvent.change(input, { target: { files: [new File(['x'], 'qris.png', { type: 'image/png' })] } });
    await waitFor(() => expect(m.saveQris).toHaveBeenCalledWith(STATIC));
    expect(await screen.findByText('WARUNG CONTOH')).toBeInTheDocument();
  });

  it('explains when the image contains no readable QR', async () => {
    vi.mocked(decodeQrImage).mockResolvedValue(null);
    render(<Invoices />);
    const input = await screen.findByLabelText('Unggah gambar QRIS');
    fireEvent.change(input, { target: { files: [new File(['x'], 'foto.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText(/Tidak ada QR yang terbaca/)).toBeInTheDocument();
    expect(m.saveQris).not.toHaveBeenCalled();
  });

  it('tells the user when the uploaded QRIS is already dynamic', async () => {
    const dynamic = withCrc([
      { tag: '00', value: '01' },
      { tag: '01', value: '12' },
      { tag: '58', value: 'ID' },
      { tag: '59', value: 'X' },
      { tag: '60', value: 'Y' },
    ]);
    vi.mocked(decodeQrImage).mockResolvedValue(dynamic);
    render(<Invoices />);
    const input = await screen.findByLabelText('Unggah gambar QRIS');
    fireEvent.change(input, { target: { files: [new File(['x'], 'q.png', { type: 'image/png' })] } });
    expect(await screen.findByText(/QRIS dinamis/)).toBeInTheDocument();
  });
});

describe('Invoices: creating and settling', () => {
  it('creates an invoice and shows a QR locked to the total, with the unique code explained', async () => {
    const img = await createOne();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(m.createInvoice).toHaveBeenCalledWith({ label: 'Budi', amount: 37500, ttl_minutes: 15 });
    expect(screen.getByText(/kode unik 12/)).toBeInTheDocument();

    const text = vi.mocked(QRCode.toDataURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const fields = parseTlv(text)!;
    expect(fields.find((f) => f.tag === '54')?.value).toBe('37512');
    expect(fields.find((f) => f.tag === '01')?.value).toBe('12');
  });

  it('requires a nominal before creating', async () => {
    render(<Invoices />);
    await screen.findByLabelText(/Nominal/);
    fireEvent.click(screen.getByText('Buat tagihan'));
    expect(await screen.findByText('Isi nominal tagihan.')).toBeInTheDocument();
    expect(m.createInvoice).not.toHaveBeenCalled();
  });

  it('explains when no unique total is free', async () => {
    m.createInvoice.mockRejectedValue(new ApiError(409, 'no_free_code'));
    render(<Invoices />);
    fireEvent.change(await screen.findByLabelText(/Nominal/), { target: { value: '1000' } });
    fireEvent.click(screen.getByText('Buat tagihan'));
    expect(await screen.findByText(/nominal yang sama/)).toBeInTheDocument();
  });

  it('shows LUNAS and plays the voice when the payment arrives live', async () => {
    await createOne();
    act(() => FakeEventSource.instances[0].emit('invoice', invoice({ status: 'paid', paid_at: Date.now(), payment_id: 7 })));
    expect(await screen.findByRole('status')).toHaveTextContent(/LUNAS/);
    expect(playPaymentSound).toHaveBeenCalledTimes(1);
  });

  it('does not play the voice when sound is switched off', async () => {
    vi.mocked(isSoundEnabled).mockReturnValue(false);
    await createOne();
    act(() => FakeEventSource.instances[0].emit('invoice', invoice({ status: 'paid', payment_id: 7 })));
    expect(await screen.findByRole('status')).toHaveTextContent(/LUNAS/);
    expect(playPaymentSound).not.toHaveBeenCalled();
  });

  it('ignores live updates for other invoices', async () => {
    await createOne();
    act(() => FakeEventSource.instances[0].emit('invoice', invoice({ id: 'other', status: 'paid', payment_id: 8 })));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(playPaymentSound).not.toHaveBeenCalled();
  });

  it('cancels the open invoice', async () => {
    await createOne();
    m.cancelInvoice.mockResolvedValue(invoice({ status: 'cancelled' }));
    fireEvent.click(screen.getByText('Batalkan'));
    await waitFor(() => expect(m.cancelInvoice).toHaveBeenCalledWith('inv-1'));
    expect(await screen.findByText('Dibatalkan.')).toBeInTheDocument();
  });

  it('marks an invoice paid by hand and labels it as manual', async () => {
    await createOne();
    m.markInvoicePaid.mockResolvedValue(invoice({ status: 'paid', paid_at: Date.now(), payment_id: null }));
    fireEvent.click(screen.getByText('Tandai lunas manual'));
    expect(await screen.findByRole('status')).toHaveTextContent(/ditandai manual/);
  });

  it('lists existing invoices with their status', async () => {
    m.invoices.mockResolvedValue({
      items: [
        invoice({ id: 'a', status: 'paid', label: 'Siti', total_amount: 20000, amount: 20000, unique_code: 0 }),
        invoice({ id: 'b', status: 'cancelled', label: 'Joko', total_amount: 15001, amount: 15000, unique_code: 1 }),
      ],
      total: 2,
    });
    render(<Invoices />);
    expect(await screen.findByText('Lunas')).toBeInTheDocument();
    expect(screen.getByText('Dibatalkan')).toBeInTheDocument();
    expect(screen.getByText(/Siti/)).toBeInTheDocument();
  });

  it('closes the live connection on unmount', async () => {
    const { unmount } = render(<Invoices />);
    await screen.findByLabelText(/Nominal/);
    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
