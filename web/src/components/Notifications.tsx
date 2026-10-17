import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtTime, type AppCount, type Device, type Notif } from '../lib/api';
import { formatRupiah, parserVerdict, type PaymentFilter } from '../lib/format';

const PAGE = 50;

/** Raw log of every notification the phones sent, with what the parser decided about each one. */
export default function NotificationLog({ devices }: { devices: Device[] }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [pkg, setPkg] = useState('');
  const [payment, setPayment] = useState<PaymentFilter>('');
  const [apps, setApps] = useState<AppCount[]>([]);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Notif[]>([]);
  const [total, setTotal] = useState(0);
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.apps().then(setApps).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api
      .notifications({
        q: debouncedQ,
        device_id: deviceId,
        package: pkg,
        payment: payment || undefined,
        limit: PAGE,
        offset: page * PAGE,
      })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setError('');
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [debouncedQ, deviceId, pkg, payment, page]);

  useEffect(load, [load]);

  // Live: refetch on every incoming notification (the parser verdict is only known server-side).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!live) return;
    const es = new EventSource(api.streamUrl());
    let timer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener('notification', () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 200);
    });
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [live]);

  const deviceName = (id: string) => devices.find((d) => d.id === id)?.name ?? 'unknown';
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtered = !!(debouncedQ || deviceId || pkg || payment);

  const toggleRaw = (id: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(items, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard not available in this browser/context.');
    }
  }

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          className="grow"
          placeholder="Cari judul, teks, app, package…"
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
        />
        <select
          aria-label="Hasil parser"
          value={payment}
          onChange={(e) => reset(setPayment)(e.target.value as PaymentFilter)}
        >
          <option value="">Semua hasil parser</option>
          <option value="yes">Terdeteksi pembayaran</option>
          <option value="no">Bukan pembayaran</option>
        </select>
        <select aria-label="Aplikasi" value={pkg} onChange={(e) => reset(setPkg)(e.target.value)}>
          <option value="">Semua app</option>
          {apps.map((a) => (
            <option key={a.package} value={a.package}>
              {a.app_name} ({a.count})
            </option>
          ))}
        </select>
        <select
          aria-label="Perangkat"
          value={deviceId}
          onChange={(e) => reset(setDeviceId)(e.target.value)}
        >
          <option value="">Semua perangkat</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          <span className={live ? 'dot on' : 'dot'} /> Live
        </label>
      </div>

      <div className="toolbar">
        <button
          type="button"
          title="GoPay yang tidak dikenali sebagai pembayaran: kandidat parser yang meleset"
          onClick={() => {
            setQ('gopay');
            setDebouncedQ('gopay');
            setPayment('no');
            setPage(0);
          }}
        >
          Cek GoPay yang terlewat
        </button>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              setDebouncedQ('');
              setDeviceId('');
              setPkg('');
              setPayment('');
              setPage(0);
            }}
          >
            Reset filter
          </button>
        )}
        <button type="button" onClick={copyJson} disabled={items.length === 0}>
          {copied ? 'Tersalin ✓' : 'Salin JSON halaman ini'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card list">
        {items.length === 0 && <p className="muted pad">Tidak ada notifikasi.</p>}
        {items.map((n) => {
          const verdict = parserVerdict(n);
          return (
            <article key={n.id} className="notif" data-verdict={verdict}>
              <header>
                <span>
                  <b>{n.app_name}</b> <span className="muted">{n.package}</span>
                </span>
                <span className="muted">
                  {deviceName(n.device_id)} · {fmtTime(n.posted_at)}
                </span>
              </header>
              <div className="badges">
                {verdict === 'payment' && (
                  <span className="badge pay">
                    Pembayaran ·{' '}
                    {n.payment_amount == null ? 'nominal tidak terbaca' : formatRupiah(n.payment_amount)}
                  </span>
                )}
                {verdict === 'missed' && (
                  <span className="badge warn">GoPay · tidak dikenali sebagai pembayaran</span>
                )}
                {verdict === 'other' && <span className="badge">bukan pembayaran</span>}
                <button type="button" className="link" onClick={() => toggleRaw(n.id)}>
                  {open.has(n.id) ? 'Sembunyikan raw' : 'Raw'}
                </button>
              </div>
              {n.title && <div className="title">{n.title}</div>}
              {n.text && <div className="body">{n.text}</div>}
              {n.sub_text && <div className="muted">{n.sub_text}</div>}
              {open.has(n.id) && <pre className="raw">{JSON.stringify(n, null, 2)}</pre>}
            </article>
          );
        })}
      </div>

      <div className="toolbar pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Terbaru
        </button>
        <span className="muted">
          Halaman {page + 1} / {pages} · {total.toLocaleString('id-ID')} notifikasi
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          Lama →
        </button>
      </div>
    </div>
  );
}
