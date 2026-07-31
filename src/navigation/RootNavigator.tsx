/**
 * Feature B — dual-interface routing.
 *
 * The persisted role is THE routing switch: null renders the onboarding
 * stack, 'driver'/'dealer' render entirely separate bottom-tab navigators.
 * Because the role lives in a Zustand store, "switch role" anywhere in the
 * app (ScreenHeader's swap button sets role → null) instantly re-routes
 * without any imperative navigation calls or reset logic.
 *
 * PaymentEscrowDashboard is intentionally registered in BOTH tab sets — the
 * escrow pipeline is the shared spine of the product and the screen adapts
 * to the active role internally.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { PhoneLoginScreen } from '../screens/auth/PhoneLoginScreen';
import { DealerLedgerScreen } from '../screens/dealer/DealerLedgerScreen';
import { DealerLoadsScreen } from '../screens/dealer/DealerLoadsScreen';
import { DealerShipmentsScreen } from '../screens/dealer/DealerShipmentsScreen';
import { DocumentsScreen } from '../screens/driver/DocumentsScreen';
import { DriverLoadsScreen } from '../screens/driver/DriverLoadsScreen';
import { DriverRouteScreen } from '../screens/driver/DriverRouteScreen';
import { DriverTripsScreen } from '../screens/driver/DriverTripsScreen';
import { RoleSelectScreen } from '../screens/onboarding/RoleSelectScreen';
import { MoneyScreen } from '../screens/shared/MoneyScreen';
import { PaymentEscrowDashboard } from '../screens/shared/PaymentEscrowDashboard';
import { registerForPush } from '../services/push';
import { connectRealtime, disconnectRealtime } from '../services/realtime';
import { syncFromServer } from '../services/sync';
import { useAppStore } from '../stores/useAppStore';
import { useAuthStore } from '../stores/useAuthStore';
import { colors } from '../theme';

export type DriverTabParamList = {
  Route: undefined;
  Loads: undefined;
  Trips: undefined;
  Money: undefined;
  Docs: undefined;
  Payments: undefined;
};

export type DealerTabParamList = {
  Loads: undefined;
  Fleet: undefined;
  Ledger: undefined;
  Money: undefined;
  Payments: undefined;
};

export type OnboardingStackParamList = {
  PhoneLogin: undefined;
  RoleSelect: undefined;
};

const DriverTab = createBottomTabNavigator<DriverTabParamList>();
const DealerTab = createBottomTabNavigator<DealerTabParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();

const tabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarStyle: {
    backgroundColor: colors.surface,
    borderTopWidth: 0,
    shadowColor: colors.primary,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 14,
  },
  // 10px keeps six labels un-truncated at 390pt (the narrowest phone we target).
  tabBarLabelStyle: { fontWeight: '700' as const, fontSize: 10 },
};

function DriverTabs(): React.JSX.Element {
  return (
    <DriverTab.Navigator screenOptions={tabScreenOptions}>
      <DriverTab.Screen
        name="Route"
        component={DriverRouteScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <DriverTab.Screen
        name="Loads"
        component={DriverLoadsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="package-variant" size={size} color={color} />
          ),
        }}
      />
      <DriverTab.Screen
        name="Trips"
        component={DriverTripsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="truck-fast" size={size} color={color} />
          ),
        }}
      />
      <DriverTab.Screen
        name="Money"
        component={MoneyScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="bank" size={size} color={color} />
          ),
        }}
      />
      <DriverTab.Screen
        name="Docs"
        component={DocumentsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder-open" size={size} color={color} />
          ),
        }}
      />
      <DriverTab.Screen
        name="Payments"
        component={PaymentEscrowDashboard}
        options={{
          // "Escrow" over "Payments": it fits the six-tab bar without
          // truncating, and reads unambiguously next to the Money tab.
          tabBarLabel: 'Escrow',
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
        }}
      />
    </DriverTab.Navigator>
  );
}

function DealerTabs(): React.JSX.Element {
  return (
    <DealerTab.Navigator screenOptions={tabScreenOptions}>
      <DealerTab.Screen
        name="Loads"
        component={DealerLoadsScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="cube" size={size} color={color} />,
        }}
      />
      <DealerTab.Screen
        name="Fleet"
        component={DealerShipmentsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="map-marker-path" size={size} color={color} />
          ),
        }}
      />
      <DealerTab.Screen
        name="Ledger"
        component={DealerLedgerScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="notebook-outline" size={size} color={color} />
          ),
        }}
      />
      <DealerTab.Screen
        name="Money"
        component={MoneyScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="bank" size={size} color={color} />
          ),
        }}
      />
      <DealerTab.Screen
        name="Payments"
        component={PaymentEscrowDashboard}
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
        }}
      />
    </DealerTab.Navigator>
  );
}

export function RootNavigator(): React.JSX.Element {
  const role = useAppStore((s) => s.role);
  const appHydrated = useAppStore((s) => s.hasHydrated);
  const token = useAuthStore((s) => s.token);
  const authHydrated = useAuthStore((s) => s.hasHydrated);

  // On a warm start with a stored session, refresh loads/shipments/wallet
  // from the server and open the SSE stream (both no-ops in demo mode).
  useEffect(() => {
    if (authHydrated && token) {
      void syncFromServer();
      void registerForPush();
      connectRealtime(token);
    }
    return () => disconnectRealtime();
  }, [authHydrated, token]);

  // Hold rendering until both persisted stores rehydrate, otherwise a
  // returning user would flash the login screen on every cold start.
  if (!appHydrated || !authHydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // Gate 1: authentication.
  if (!token) {
    return (
      <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
        <OnboardingStack.Screen name="PhoneLogin" component={PhoneLoginScreen} />
      </OnboardingStack.Navigator>
    );
  }

  // Gate 2: role selection (Feature B).
  if (role === 'driver') return <DriverTabs />;
  if (role === 'dealer') return <DealerTabs />;

  return (
    <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
      <OnboardingStack.Screen name="RoleSelect" component={RoleSelectScreen} />
    </OnboardingStack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
});
