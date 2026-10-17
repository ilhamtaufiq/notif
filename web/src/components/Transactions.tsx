import { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, fmtTime, type Payment, type PaymentSummary } from '../lib/api';
import { dayRange, formatRupiah, parseAmountInput } from '../lib/format';
import { isSoundEnabled, playPaymentSound, setSoundEnabled } from '../lib/sound';

const PAGE = 25;

export default function Transactions() {
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [items, setItems] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [sum, setSum] = useState(0);
  const [page, setPage] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState('');
  const [sound, setSound] = useState(isSoundEnabled);
  const [freshId, setFreshId] = useState<number | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const load = useCallback(() => {
    api
      .payments({
        ...dayRange(from, to),
        min: parseAmountInput(min),
        max: parseAmountInput(max),
        limit: PAGE,
        offset: page * PAGE,
      })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setSum(r.sum);
        setError('');
      })
      .catch((e) => setError(String(e.message ?? e)));
    api
      .paymentSummary(14)
      .then(setSummary)
      .catch(() => {});
  }, [from, to, min, max, page]);

  useEffect(load, [load]);

  // Live: every payment event plays the voice (if enabled) and refreshes the list.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const es = new EventSource(api.streamUrl());
    es.addEventListener('payment', (ev) => {
      const p: Payment = JSON.parse((ev as MessageEvent).data);
      if (soundRef.current) playPaymentSound();
      setFreshId(p.id);
      setTimeout(() => setFreshId((cur) => (cur === p.id ? null : cur)), 6000);
      loadRef.current();
    });
    return () => es.close();
  }, []);

  const toggleSound = (on: boolean) => {
    setSound(on);
    setSoundEnabled(on);
    if (on) playPaymentSound(); // also unlocks audio playback in the browser
  };

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const filtered = !!(from || to || min || max);

  const dayData = (summary?.by_day ?? []).map((d) => ({
    label: new Date(d.day_start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    sum: d.sum,
    count: d.count,
  }));

  return (
    <div className="stack">
      <div className="grid cards">
        <Total label="Hari ini" value={summary?.today} />
        <Total label="7 hari" value={summary?.last7} />
        <Total label="30 hari" value={summary?.last30} />
        <div className="card stat">
          <div className="muted">Suara pembayaran</div>
          <label className="check big-check">
            <input
              type="checkbox"
              aria-label="Suara pembayaran"
              checked={sound}
              onChange={(e) => toggleSound(e.target.checked)}
            />
            <span className={sound ? 'dot on' : 'dot'} /> {sound ? 'On' : 'Off'}
          </label>
          <button type="button" onClick={playPaymentSound}>
            Tes suara
          </button>
        </div>
      </div>

      {dayData.some((d) => d.sum > 0) && (
        <div className="card">
          <h3>Pembayaran per hari (14 hari)</h3>
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dayData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} width={60} tickFormatter={(v) => v.toLocaleString('id-ID')} />
                <Tooltip formatter={(v) => formatRupiah(Number(v))} />
                <Bar dataKey="sum" fill="var(--accent-2)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card toolbar">
        <label className="field">
          Dari
          <input type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} />
        </label>
        <label className="field">
          Sampai
          <input type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} />
        </label>
        <label className="field">
          Min (Rp)
          <input
            inputMode="numeric"
            placeholder="0"
            value={min}
            onChange={(e) => resetPage(setMin)(e.target.value)}
          />
        </label>
        <label className="field">
          Maks (Rp)
          <input
            inputMode="numeric"
            placeholder="∞"
            value={max}
            onChange={(e) => resetPage(setMax)(e.target.value)}
          />
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setFrom('');
              setTo('');
              setMin('');
              setMax('');
              setPage(0);
            }}
          >
            Reset
          </button>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card list">
        <div className="row head">
          <b>
            {total.toLocaleString('id-ID')} transaksi{filtered ? ' (terfilter)' : ''}
          </b>
          <b data-testid="filtered-sum">{formatRupiah(sum)}</b>
        </div>
        {items.length === 0 && <p className="muted pad">Belum ada transaksi.</p>}
        {items.map((p) => (
          <article key={p.id} className={p.id === freshId ? 'notif fresh' : 'notif'}>
            <header>
              <b className="amount">{formatRupiah(p.amount)}</b>
              <span className="muted">{fmtTime(p.paid_at)}</span>
            </header>
            <div className="muted">
              {p.app_name} · {p.title}
              {p.amount == null && ' · nominal tidak terbaca'}
            </div>
            {p.text && <div className="body">{p.text}</div>}
          </article>
        ))}
      </div>

      <div className="toolbar pager">
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Terbaru
        </button>
        <span className="muted">
          Halaman {page + 1} / {pages}
        </span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
          Lama →
        </button>
      </div>
    </div>
  );
}

function Total({ label, value }: { label: string; value?: { count: number; sum: number } }) {
  return (
    <div className="card stat">
      <div className="muted">{label}</div>
      <div className="big">{formatRupiah(value?.sum ?? 0)}</div>
      <div className="muted">{value?.count ?? 0} transaksi</div>
    </div>
  );
}
