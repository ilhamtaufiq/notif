import * as Notifications from 'expo-notifications';

const CHANNEL_ID = 'notif-test';

// Show notifications while the app is in the foreground too, so the test is visible on screen.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Shows a notification in the phone's status bar. Returns false when the user has not allowed notifications. */
export async function showLocalNotification(title: string, body: string): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  let granted = perm.granted;
  if (!granted && perm.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return false;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Tes notifikasi',
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL_ID },
  });
  return true;
}
