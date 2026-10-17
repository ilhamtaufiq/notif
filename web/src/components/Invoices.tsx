import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, fmtTime, type Invoice, type QrisSetting } from '../lib/api';
import { formatRupiah, parseAmountInput } from '../lib/format';
import {
  decodeQrImage,
  qrisErrorMessage,
  toDynamic,
  validateStatic,
  type QrisError,
} from '../lib/qris';
import { isSoundEnabled, playPaymentSound } from '../lib/sound';

const TTL_OPTIONS = [5, 15, 30, 60];

const STATUS_LABEL: Record<Invoice['status'], string> = {
  open: 'Menunggu',
  paid: 'Lunas',
  cancelled: 'Dibatalkan',
  expired: 'Kedaluwarsa',
};

const errText = (code: string) => qrisErrorMessage[code as QrisError] ?? qrisErrorMessage.unknown;

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Invoices() {
  const [qris, setQris] = useState<QrisSetting | null>(null);
  const [qrisError, setQrisError] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [ttl, setTtl] = useState(15);
  const [formError, setFormError] = useState('');

  const [items, setItems] = useState<Invoice[]>([]);
  const [active, setActive] = useState<Invoice | null>(null);
  const [qrUrl, setQrUrl] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const activeRef = useRef<Invoice | null>(null);
  activeRef.current = active;

  const loadList = useCallback(() => {
    api
      .invoices({ limit: 30 })
      .then((r) => setItems(r.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .qris()
      .then(setQris)
      .catch(() => setQris({ configured: false }));
    loadList();
  }, [loadList]);

  // Countdown ticker.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Live: another device/the phone listener settled or changed an invoice.
  useEffect(() => {
    const es = new EventSource(api.streamUrl());
    es.addEventListener('invoice', (ev) => {
      const inv: Invoice = JSON.parse((ev as MessageEvent).data);
      setItems((cur) => (cur.some((i) => i.id === inv.id) ? cur.map((i) => (i.id === inv.id ? inv : i)) : [inv, ...cur]));
      if (activeRef.current?.id === inv.id) {
        setActive(inv);
        if (inv.status === 'paid' && isSoundEnabled()) playPaymentSound();
      }
    });
    return () => es.close();
  }, []);

  // Build the QR image whenever a different invoice is shown.
  const payload = qris?.payload;
  const activeId = active?.id;
  const activeTotal = active?.total_amount;
  useEffect(() => {
    if (!payload || activeId == null || activeTotal == null) {
      setQrUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(toDynamic(payload, activeTotal), { margin: 2, width: 360, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setQrUrl(url))
      .catch(() => !cancelled && setQrUrl(''));
    return () => {
      cancelled = true;
    };
  }, [payload, activeId, activeTotal]);

  async function saveQrisPayload(text: string) {
    const trimmed = text.trim();
    const v = validateStatic(trimmed);
    if (!v.ok) {
      setQrisError(errText(v.error));
      return;
    }
    setBusy(true);
    try {
      setQris(await api.saveQris(trimmed));
      setQrisError('');
      setPasted('');
    } catch (e) {
      setQrisError(errText(e instanceof ApiError ? e.code : 'unknown'));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setQrisError('');
    try {
      const text = await decodeQrImage(file);
      if (!text) {
        setQrisError(qrisErrorMessage.no_qr);
        return;
      }
      await saveQrisPayload(text);
    } catch {
      setQrisError(qrisErrorMessage.no_qr);
    } finally {
      setBusy(false);
    }
  }

  async function removeQris() {
    if (!confirm('Hapus QRIS static yang tersimpan? Tagihan baru tidak bisa dibuat sampai diunggah lagi.')) return;
    await api.deleteQris();
    setQris({ configured: false });
    setActive(null);
  }

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    const value = parseAmountInput(amount);
    if (!value || value < 1) {
      setFormError('Isi nominal tagihan.');
      return;
    }
    setBusy(true);
    try {
      const inv = await api.createInvoice({ label: label.trim(), amount: value, ttl_minutes: ttl });
      setFormError('');
      setActive(inv);
      setItems((cur) => [inv, ...cur]);
      setAmount('');
      setLabel('');
    } catch (err) {
      setFormError(
        err instanceof ApiError && err.code === 'no_free_code'
          ? 'Terlalu banyak tagihan terbuka dengan nominal yang sama. Batalkan atau tunggu salah satunya.'
          : 'Gagal membuat tagihan.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: (id: string) => Promise<Invoice>, id: string) {
    try {
      const inv = await fn(id);
      setItems((cur) => cur.map((i) => (i.id === inv.id ? inv : i)));
      if (activeRef.current?.id === inv.id) setActive(inv);
    } catch {
      loadList();
    }
  }

  // An open invoice past its deadline is shown as expired even before the next refresh.
  const effective = (inv: Invoice): Invoice['status'] =>
    inv.status === 'open' && now > inv.expires_at ? 'expired' : inv.status;

  if (!qris) return <p className="muted">Memuat…</p>;

  return (
    <div className="stack">
      {!qris.configured ? (
        <div className="card stack">
          <h3>1. Unggah QRIS static toko</h3>
          <p className="muted">
            Unggah foto/screenshot QRIS statis merchant (yang ditempel di toko). Aplikasi membaca isinya di
            browser, lalu membuat QR dengan nominal terkunci untuk tiap tagihan.
          </p>
          <input
            type="file"
            accept="image/*"
            aria-label="Unggah gambar QRIS"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <details>
            <summary>Atau tempel teks QRIS</summary>
            <textarea
              aria-label="Teks QRIS"
              rows={3}
              placeholder="00020101021126…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button type="button" disabled={busy || !pasted.trim()} onClick={() => saveQrisPayload(pasted)}>
              Simpan teks QRIS
            </button>
          </details>
          {qrisError && <p className="error">{qrisError}</p>}
        </div>
      ) : (
        <div className="card toolbar">
          <span>
            QRIS aktif: <b>{qris.merchant_name || 'merchant'}</b>
            {qris.city ? ` · ${qris.city}` : ''}
          </span>
          <button type="button" onClick={removeQris} className="danger">
            Ganti / hapus QRIS
          </button>
        </div>
      )}

      {qris.configured && (
        <form className="card toolbar" onSubmit={createInvoice}>
          <label className="field">
            Nominal (Rp)
            <input
              inputMode="numeric"
              placeholder="37500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="field grow">
            Keterangan
            <input placeholder="mis. Budi / meja 3" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="field">
            Berlaku
            <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
              {TTL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} menit
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>Buat tagihan</button>
          {formError && <p className="error full">{formError}</p>}
        </form>
      )}

      {active && (
        <ActiveInvoice
          invoice={active}
          status={effective(active)}
          now={now}
          qrUrl={qrUrl}
          onCancel={() => act(api.cancelInvoice, active.id)}
          onPaid={() => act(api.markInvoicePaid, active.id)}
          onClose={() => setActive(null)}
        />
      )}

      <div className="card list">
        <div className="row head">
          <b>Tagihan terbaru</b>
        </div>
        {items.length === 0 && <p className="muted pad">Belum ada tagihan.</p>}
        {items.map((inv) => {
          const st = effective(inv);
          return (
            <div key={inv.id} className="row">
              <div>
                <b>{formatRupiah(inv.total_amount)}</b>{' '}
                <span className="muted">
                  {inv.label || 'tanpa keterangan'} · {fmtTime(inv.created_at)}
                  {inv.unique_code > 0 && ` · kode unik +${inv.unique_code}`}
                </span>
              </div>
              <span className="actions">
                <span className={`badge status-${st}`}>{STATUS_LABEL[st]}</span>
                {st === 'open' && (
                  <button type="button" className="link" onClick={() => setActive(inv)}>
                    Tampilkan QR
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActiveInvoice({
  invoice,
  status,
  now,
  qrUrl,
  onCancel,
  onPaid,
  onClose,
}: {
  invoice: Invoice;
  status: Invoice['status'];
  now: number;
  qrUrl: string;
  onCancel: () => void;
  onPaid: () => void;
  onClose: () => void;
}) {
  const paid = status === 'paid';
  return (
    <div className={paid ? 'card invoice paid' : 'card invoice'}>
      {paid ? (
        <div className="paid-banner" role="status">
          LUNAS ✓ <b>{formatRupiah(invoice.total_amount)}</b>
          {invoice.payment_id == null && <div className="muted">ditandai manual</div>}
        </div>
      ) : (
        <>
          {qrUrl ? (
            <img className="qr" src={qrUrl} alt={`QRIS ${formatRupiah(invoice.total_amount)}`} />
          ) : (
            <div className="qr placeholder muted">Membuat QR…</div>
          )}
          <div className="total">
            Total bayar <b>{formatRupiah(invoice.total_amount)}</b>
          </div>
          {invoice.unique_code > 0 && (
            <div className="muted">
              Nominal {formatRupiah(invoice.amount)} + kode unik {invoice.unique_code}. Pembeli harus membayar
              tepat jumlah ini.
            </div>
          )}
          {status === 'open' && <div className="muted">Berlaku {formatCountdown(invoice.expires_at - now)}</div>}
          {status === 'expired' && <div className="error">Kedaluwarsa. Buat tagihan baru.</div>}
          {status === 'cancelled' && <div className="error">Dibatalkan.</div>}
        </>
      )}
      <div className="toolbar center">
        {!paid && status !== 'cancelled' && (
          <>
            <button type="button" onClick={onPaid}>
              Tandai lunas manual
            </button>
            <button type="button" className="danger" onClick={onCancel}>
              Batalkan
            </button>
          </>
        )}
        <button type="button" onClick={onClose}>
          Tutup
        </button>
      </div>
      {invoice.label && <div className="muted">{invoice.label}</div>}
    </div>
  );
}
