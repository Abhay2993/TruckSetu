/**
 * Feature A — the "Setu" rotator (deliverable 1).
 *
 * Renders "Truck" + a suffix that cycles every second through synonyms and
 * vernacular equivalents of Setu (bridge/connection).
 *
 * Efficiency notes:
 *   • ONE interval per mounted header, created in useEffect and cleared in
 *     its cleanup — no leak when the screen unmounts or props change.
 *   • The index advances with a functional setState, so the interval
 *     callback closes over nothing mutable and never goes stale.
 *   • The crossfade uses the native driver (opacity only), so the 1 Hz tick
 *     costs no JS-thread layout work.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, fontSizes } from '../theme';

const DEFAULT_SUFFIXES = ['Setu', 'Link', 'Connect', 'Bridge', 'Bandhan', 'Safar'] as const;
const ROTATION_INTERVAL_MS = 1000;

interface DynamicHeaderProps {
  /** 'display' for splash/onboarding, 'compact' for in-screen headers. */
  size?: 'display' | 'compact';
  suffixes?: readonly string[];
  intervalMs?: number;
  /** Overrides for dark headers vs light backgrounds. */
  prefixColor?: string;
  suffixColor?: string;
}

export function DynamicHeader({
  size = 'compact',
  suffixes = DEFAULT_SUFFIXES,
  intervalMs = ROTATION_INTERVAL_MS,
  prefixColor = colors.textPrimary,
  suffixColor = colors.accent,
}: DynamicHeaderProps): React.JSX.Element {
  const [index, setIndex] = useState(0);
  const opacity = useRef(new Animated.Value(1)).current;

  // The rotation interval. Deliberately depends only on the cadence and
  // list length: changing other props never tears down / restarts the timer.
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % suffixes.length);
    }, intervalMs);
    return () => clearInterval(id); // cleanup ⇒ no leaked timers
  }, [intervalMs, suffixes.length]);

  // Crossfade on every word change.
  useEffect(() => {
    opacity.setValue(0.2);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, opacity]);

  const fontSize = size === 'display' ? fontSizes.display : fontSizes.lg;
  const suffix = suffixes[index % suffixes.length] ?? suffixes[0] ?? 'Setu';

  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel={`Truck${suffix}`}>
      <Text style={[styles.prefix, { fontSize, color: prefixColor }]}>Truck</Text>
      <Animated.Text style={[styles.suffix, { fontSize, color: suffixColor, opacity }]}>
        {suffix}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  prefix: {
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  suffix: {
    fontWeight: '800',
    letterSpacing: 0.5,
    marginLeft: 2,
  },
});
