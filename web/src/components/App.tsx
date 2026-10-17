import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError, type Device } from '../lib/api';
import Login from './Login';
import Overview from './Overview';
import Transactions from './Transactions';
import Invoices from './Invoices';
import ListenerStatus from './ListenerStatus';
import Notifications from './Notifications';
import Devices from './Devices';
import '../styles/global.css';

const TABS = ['Transactions', 'Invoices', 'Overview', 'Log', 'Devices'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [tab, setTab] = useState<Tab>('Transactions');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  // Incoming notifications not yet seen in the Log tab (the Log tab only listens while it is open).
  const [unread, setUnread] = useState(0);

  const logout = useCallback(() => {
    setToken(null);
    setAuthed(false);
  }, []);

  const loadDevices = useCallback(() => {
    api
      .devices()
      .then((list) => {
        setDevices(list);
        setLoadedAt(Date.now());
      })
      .catch((e) => e instanceof UnauthorizedError && logout());
  }, [logout]);

  useEffect(() => {
    if (!authed) return;
    loadDevices();
    // keep the listener health banner current
    const t = setInterval(loadDevices, 60_000);
    return () => clearInterval(t);
  }, [authed, loadDevices]);

  useEffect(() => {
    if (!authed) return;
    const es = new EventSource(api.streamUrl());
    es.addEventListener('notification', () => setUnread((n) => n + 1));
    return () => es.close();
  }, [authed]);

  // Viewing the Log tab clears the badge, including for notifications that arrive while it is open.
  useEffect(() => {
    if (tab === 'Log') setUnread(0);
  }, [tab, unread]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Notif Listener</h1>
        <nav className="seg">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'Log' && unread > 0 ? `${t} (${unread} baru)` : t}
            </button>
          ))}
        </nav>
        <button onClick={logout}>Sign out</button>
      </header>
      <ListenerStatus devices={devices} loadedAt={loadedAt} />
      <main>
        {tab === 'Transactions' && <Transactions />}
        {tab === 'Invoices' && <Invoices />}
        {tab === 'Overview' && <Overview devices={devices} />}
        {tab === 'Log' && <Notifications devices={devices} />}
        {tab === 'Devices' && <Devices devices={devices} onChange={loadDevices} />}
      </main>
    </div>
  );
}
