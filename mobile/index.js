/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import App from './App';
import headlessNotificationListener from './src/headless';

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener,
);
// The Expo-generated Android project starts the component named "main"; registerRootComponent
// registers App under that name (registering it as the app.json name crashes at startup).
registerRootComponent(App);
