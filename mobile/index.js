/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import App from './App';
import headlessNotificationListener from './src/headless';
import { name as appName } from './app.json';

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener,
);
AppRegistry.registerComponent(appName, () => App);
