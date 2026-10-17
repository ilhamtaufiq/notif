import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { listInstalledApps, type InstalledApp } from './apps';

interface Props {
  selected: Record<string, string>;
  onDone: (selected: Record<string, string>) => void;
  onCancel: () => void;
}

export default function AppPicker({ selected, onDone, onCancel }: Props) {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Record<string, string>>(selected);

  useEffect(() => {
    listInstalledApps()
      .then(setApps)
      .catch(e => setError(String(e.message ?? e)));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!apps) return [];
    return q
      ? apps.filter(
          a => a.appName.toLowerCase().includes(q) || a.packageName.includes(q),
        )
      : apps;
  }, [apps, query]);

  const toggle = (a: InstalledApp, on: boolean) =>
    setChosen(cur => {
      const next = { ...cur };
      if (on) next[a.packageName] = a.appName;
      else delete next[a.packageName];
      return next;
    });

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Pressable onPress={onCancel}>
          <Text style={s.link}>Cancel</Text>
        </Pressable>
        <Text style={s.title}>{Object.keys(chosen).length} selected</Text>
        <Pressable onPress={() => onDone(chosen)}>
          <Text style={s.link}>Save</Text>
        </Pressable>
      </View>
      <TextInput
        style={s.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search apps"
        autoCapitalize="none"
        autoCorrect={false}
      />
      {error ? (
        <Text style={s.error}>Could not list apps: {error}</Text>
      ) : !apps ? (
        <ActivityIndicator style={s.loading} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={a => a.packageName}
          initialNumToRender={20}
          renderItem={({ item }) => (
            <View style={s.row}>
              <View style={s.rowText}>
                <Text style={s.name}>{item.appName}</Text>
                <Text style={s.pkg}>{item.packageName}</Text>
              </View>
              <Switch
                value={item.packageName in chosen}
                onValueChange={on => toggle(item, on)}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f6f8' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: { fontWeight: '600', color: '#1c2030' },
  link: { color: '#4f6bed', fontWeight: '600', fontSize: 16 },
  search: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#d9dce6',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#fff',
    color: '#1c2030',
  },
  loading: { marginTop: 32 },
  error: { color: '#c0392b', padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d9dce6',
  },
  rowText: { flex: 1, paddingRight: 12 },
  name: { color: '#1c2030', fontSize: 15 },
  pkg: { color: '#6b7185', fontSize: 12 },
});
