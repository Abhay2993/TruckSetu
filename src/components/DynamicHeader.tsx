/**
 * Feature A — the "Setu" rotator (deliverable 1).
 *
 * Renders "Truck" + "Setu" written in a different Indian script every
 * second: Latin, Devanagari (Hindi/Marathi), Gurmukhi (Punjabi), Bengali,
 * Gujarati, Telugu, Tamil, Kannada, Malayalam and Odia — the brand itself
 * speaks every driver's language. All of these scripts ship with iOS,
 * Android and every modern browser, so no font bundling is needed.
 *
 * Efficiency notes:
 *   • ONE interval per mounted header, created in useEffect and cleared in
 *     its cleanup — no leak when the screen unmounts or props change.
 *   • The index advances with a functional setState, so the interval
 *     callback closes over nothing mutable and never goes stale.
 *   • The word change animates opacity + translateY on the native driver,
 *     so the 1 Hz tick costs no JS-thread layout work.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, fontSizes } from '../theme';

/** "Setu" across Indian scripts — same word, every language. */
const DEFAULT_SUFFIXES = [
  'Setu', // Latin
  'सेतु', // Devanagari — Hindi / Marathi
  'ਸੇਤੂ', // Gurmukhi — Punjabi
  'সেতু', // Bengali
  'સેતુ', // Gujarati
  'సేతు', // Telugu
  'சேது', // Tamil
  'ಸೇತು', // Kannada
  'സേതു', // Malayalam
  'ସେତୁ', // Odia
] as const;
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
  const progress = useRef(new Animated.Value(1)).current;

  // The rotation interval. Deliberately depends only on the cadence and
  // list length: changing other props never tears down / restarts the timer.
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % suffixes.length);
    }, intervalMs);
    return () => clearInterval(id); // cleanup ⇒ no leaked timers
  }, [intervalMs, suffixes.length]);

  // Fade + lift-in on every script change.
  useEffect(() => {
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, progress]);

  const fontSize = size === 'display' ? fontSizes.display : fontSizes.lg;
  const suffix = suffixes[index % suffixes.length] ?? suffixes[0] ?? 'Setu';

  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel={`Truck${suffix}`}>
      <Text style={[styles.prefix, { fontSize, color: prefixColor }]}>Truck</Text>
      <Animated.Text
        style={[
          styles.suffix,
          {
            fontSize,
            color: suffixColor,
            opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }),
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [size === 'display' ? 10 : 5, 0],
                }),
              },
            ],
          },
        ]}
      >
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
    marginLeft: 3,
  },
});
