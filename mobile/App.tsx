import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import RNAndroidNotificationListener from 'react-native-android-notification-listener';
import AppPicker from './src/AppPicker';
import { loadConfig, updateConfig, type FilterMode } from './src/storage';
import { playPaymentSound } from './src/sound';
import { flush, pendingCount, testConnection } from './src/sync';

type Permission = 'unknown' | 'authorized' | 'denied';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [deviceKey, setDeviceKey] = useState('');
  const [permission, setPermission] = useState<Permission>('unknown');
  const [pending, setPending] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [allowedApps, setAllowedApps] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const refresh = useCallback(async () => {
    setPermission(await RNAndroidNotificationListener.getPermissionStatus());
    setPending(await pendingCount());
  }, []);

  useEffect(() => {
    loadConfig().then((c) => {
      setServerUrl(c.serverUrl);
      setDeviceKey(c.deviceKey);
      setFilterMode(c.filterMode);
      setAllowedApps(c.allowedApps);
      setSoundEnabled(c.soundEnabled);
    });
    refresh();
    // The user comes back from the system settings screen / a notification arrived meanwhile.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  async function saveAndTest() {
    setBusy(true);
    const cfg = { serverUrl: serverUrl.trim().replace(/\/+$/, ''), deviceKey: deviceKey.trim() };
    await updateConfig(cfg);
    const err = await testConnection(cfg);
    if (err) {
      setStatus(err);
    } else {
      const sent = await flush();
      setStatus(sent ? `Connected. Sent ${sent} queued notifications.` : 'Connected.');
    }
    await refresh();
    setBusy(false);
  }

  async function syncNow() {
    setBusy(true);
    const sent = await flush();
    setStatus(sent ? `Sent ${sent} notifications.` : 'Nothing sent (queue empty or server unreachable).');
    await refresh();
    setBusy(false);
  }

  async function chooseMode(mode: FilterMode) {
    setFilterMode(mode);
    await updateConfig({ filterMode: mode });
    if (mode === 'selected' && Object.keys(allowedApps).length === 0) setPicking(true);
  }

  async function toggleSound(on: boolean) {
    setSoundEnabled(on);
    await updateConfig({ soundEnabled: on });
  }

  async function saveApps(apps: Record<string, string>) {
    setAllowedApps(apps);
    setPicking(false);
    await updateConfig({ allowedApps: apps });
  }

  const granted = permission === 'authorized';

  if (picking) {
    return (
      <AppPicker selected={allowedApps} onDone={saveApps} onCancel={() => setPicking(false)} />
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.container}>
        <Text style={s.h1}>Notif Listener</Text>
        <Text style={s.muted}>Forwards this phone's notifications to your dashboard.</Text>

        <View style={s.card}>
          <Text style={s.h2}>1. Server</Text>
          <Text style={s.label}>Server URL</Text>
          <TextInput
            style={s.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="http://192.168.1.10:8080"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={s.label}>Device key</Text>
          <TextInput
            style={s.input}
            value={deviceKey}
            onChangeText={setDeviceKey}
            placeholder="nl_…"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <Pressable
            style={[s.btn, (busy || !serverUrl || !deviceKey) && s.disabled]}
            disabled={busy || !serverUrl || !deviceKey}
            onPress={saveAndTest}>
            <Text style={s.btnText}>Save & test connection</Text>
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.h2}>2. Notification access</Text>
          <Text style={granted ? s.ok : s.warn}>
            {granted ? 'Granted - listening for notifications' : 'Not granted'}
          </Text>
          {!granted && (
            <Pressable style={s.btn} onPress={() => RNAndroidNotificationListener.requestPermission()}>
              <Text style={s.btnText}>Open notification access settings</Text>
            </Pressable>
          )}
          <Text style={s.muted}>
            Tip: exclude this app from battery optimisation so Android keeps the listener alive.
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.h2}>3. Apps to capture</Text>
          <View style={s.segment}>
            {(['all', 'selected'] as const).map((m) => (
              <Pressable
                key={m}
                style={[s.segBtn, filterMode === m && s.segActive]}
                onPress={() => chooseMode(m)}>
                <Text style={filterMode === m ? s.segTextActive : s.segText}>
                  {m === 'all' ? 'All apps' : 'Selected apps'}
                </Text>
              </Pressable>
            ))}
          </View>
          {filterMode === 'selected' && (
            <>
              <Text style={s.body}>
                {Object.keys(allowedApps).length === 0
                  ? 'No apps selected - nothing will be captured.'
                  : `${Object.keys(allowedApps).length} apps selected`}
              </Text>
              <Pressable style={[s.btn, s.secondary]} onPress={() => setPicking(true)}>
                <Text style={s.btnTextDark}>Choose apps</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.h2}>GoPay payment sound</Text>
          <View style={s.switchRow}>
            <Text style={[s.body, s.switchText]}>
              Play voice when a GoPay app (name contains "gopay") gets a payment / money-in notification
            </Text>
            <Switch value={soundEnabled} onValueChange={toggleSound} />
          </View>
          <Pressable style={[s.btn, s.secondary]} onPress={() => playPaymentSound()}>
            <Text style={s.btnTextDark}>Test sound</Text>
          </Pressable>
        </View>

        <View style={s.card}>
          <Text style={s.h2}>Queue</Text>
          <Text style={s.body}>{pending} notifications waiting to be sent</Text>
          <Pressable style={[s.btn, s.secondary, busy && s.disabled]} disabled={busy} onPress={syncNow}>
            <Text style={s.btnTextDark}>Sync now</Text>
          </Pressable>
        </View>

        {!!status && <Text style={s.status}>{status}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f6f8' },
  container: { padding: 16, gap: 14 },
  h1: { fontSize: 24, fontWeight: '700', color: '#1c2030' },
  h2: { fontSize: 16, fontWeight: '600', color: '#1c2030', marginBottom: 4 },
  muted: { color: '#6b7185', fontSize: 13 },
  body: { color: '#1c2030' },
  label: { color: '#6b7185', fontSize: 13, marginTop: 6 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  input: { borderWidth: 1, borderColor: '#d9dce6', borderRadius: 8, padding: 10, color: '#1c2030' },
  btn: { backgroundColor: '#4f6bed', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  secondary: { backgroundColor: '#e9ecf8' },
  disabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '600' },
  btnTextDark: { color: '#2d3a8c', fontWeight: '600' },
  ok: { color: '#12805f', fontWeight: '600' },
  warn: { color: '#c0392b', fontWeight: '600' },
  segment: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: '#d9dce6', overflow: 'hidden' },
  segBtn: { flex: 1, padding: 10, alignItems: 'center' },
  segActive: { backgroundColor: '#4f6bed' },
  segText: { color: '#1c2030' },
  segTextActive: { color: '#fff', fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchText: { flex: 1 },
  status: { color: '#1c2030', textAlign: 'center' },
});
