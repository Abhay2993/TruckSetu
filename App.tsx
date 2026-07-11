/**
 * TruckSetu app entry.
 *
 * Deliberately thin: providers only. All routing logic lives in
 * RootNavigator; all state lives in the Zustand stores (no context
 * pyramids — stores are importable from anywhere, including non-React
 * modules like the telemetry sync path).
 */

import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
