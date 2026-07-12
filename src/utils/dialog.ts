/**
 * Platform-aware dialogs.
 *
 * React Native's Alert.alert is a silent no-op on react-native-web, which
 * makes any flow that *waits* for a button press (confirmations) impossible
 * to complete in the browser build, and swallows all feedback/validation
 * messages. These helpers route to window.alert / window.confirm on web and
 * to Alert on iOS/Android, so every screen can stay platform-agnostic.
 */

import { Alert, Platform } from 'react-native';

/** Minimal typings for the browser globals — the DOM lib isn't loaded. */
declare const window: {
  alert(message: string): void;
  confirm(message: string): boolean;
};

/** Fire-and-forget message: toasts/status feedback, errors, validation. */
export function notify(title: string, message: string): void {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

/**
 * Yes/no confirmation. Resolves true only when the user explicitly
 * confirms — dismissing the native dialog resolves false, never hangs.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel = 'Confirm',
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
