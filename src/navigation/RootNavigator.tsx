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
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DealerLoadsScreen } from '../screens/dealer/DealerLoadsScreen';
import { DealerShipmentsScreen } from '../screens/dealer/DealerShipmentsScreen';
import { DriverRouteScreen } from '../screens/driver/DriverRouteScreen';
import { DriverTripsScreen } from '../screens/driver/DriverTripsScreen';
import { RoleSelectScreen } from '../screens/onboarding/RoleSelectScreen';
import { PaymentEscrowDashboard } from '../screens/shared/PaymentEscrowDashboard';
import { useAppStore } from '../stores/useAppStore';
import { colors } from '../theme';

export type DriverTabParamList = {
  Route: undefined;
  Trips: undefined;
  Payments: undefined;
};

export type DealerTabParamList = {
  Loads: undefined;
  Shipments: undefined;
  Payments: undefined;
};

export type OnboardingStackParamList = {
  RoleSelect: undefined;
};

const DriverTab = createBottomTabNavigator<DriverTabParamList>();
const DealerTab = createBottomTabNavigator<DealerTabParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();

const tabScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.accent,
  tabBarInactiveTintColor: colors.textMuted,
  tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
  tabBarLabelStyle: { fontWeight: '700' as const },
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
        name="Trips"
        component={DriverTripsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="truck-fast" size={size} color={color} />
          ),
        }}
      />
      <DriverTab.Screen
        name="Payments"
        component={PaymentEscrowDashboard}
        options={{
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
        name="Shipments"
        component={DealerShipmentsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="map-marker-path" size={size} color={color} />
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
  const hasHydrated = useAppStore((s) => s.hasHydrated);

  // Hold rendering until AsyncStorage rehydrates, otherwise a returning
  // driver would flash the onboarding screen on every cold start.
  if (!hasHydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

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
