/**
 * Push notifications (Feature 11).
 *
 * Registers the device for Expo push and reports the token to the backend,
 * which fires notifications on escrow events (bid → advance → POD → release,
 * plus disputes and chat). Foreground notifications also surface as a
 * banner. Remote push needs a physical device + a dev/standalone build;
 * this degrades cleanly to a no-op on web and in simulators, so nothing
 * breaks in the demo — the in-app notification centre still works from the
 * server records.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

let registered = false;

/** Idempotent: request permission, get the Expo token, report it. */
export async function registerForPush(): Promise<void> {
  if (registered || Platform.OS === 'web') return;
  registered = true;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'TruckSetu',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))
      .data;
    await api.registerPushToken(token);
  } catch (error) {
    // Missing native module (Expo Go limitation) / no device — fine, the
    // notification centre still reads server records over HTTP.
    console.warn('[push] registration skipped', error);
  }
}
