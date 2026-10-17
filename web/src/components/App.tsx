import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, UnauthorizedError, type Device } from '../lib/api';
import Login from './Login';
import Overview from './Overview';
import Transactions from './Transactions';
import Invoices from './Invoices';
import Notifications from './Notifications';
import Devices from './Devices';
import '../styles/global.css';

const TABS = ['Transactions', 'Invoices', 'Overview', 'Log', 'Devices'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [tab, setTab] = useState<Tab>('Transactions');
  const [devices, setDevices] = useState<Device[]>([]);

  const logout = useCallback(() => {
    setToken(null);
    setAuthed(false);
  }, []);

  const loadDevices = useCallback(() => {
    api
      .devices()
      .then(setDevices)
      .catch((e) => e instanceof UnauthorizedError && logout());
  }, [logout]);

  useEffect(() => {
    if (authed) loadDevices();
  }, [authed, loadDevices]);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Notif Listener</h1>
        <nav className="seg">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <button onClick={logout}>Sign out</button>
      </header>
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
