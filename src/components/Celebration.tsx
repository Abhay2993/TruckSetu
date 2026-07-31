/**
 * Confetti burst for the moments that matter — escrow fully settled, a
 * contract sealed. Bump the `burst` counter to fire; particles fall with
 * drift, spin and fade, then the overlay renders nothing. Deterministic
 * per-particle randomness (seeded off the index) keeps re-renders stable.
 * Plain Animated views — no dependencies, works on native and web.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

const PARTICLE_COLORS = ['#F5820D', '#F7C948', '#1E8E3E', '#C62828', '#2C8C99', '#FFFFFF'];
const COUNT = 22;
const FALL_MS = 1500;

/** Stable pseudo-random in [0,1) from an integer seed. */
function rand(seed: number): number {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function Celebration({ burst }: { burst: number }): React.JSX.Element | null {
  const progress = useRef(new Animated.Value(0)).current;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (burst === 0) return;
    setActive(true);
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: FALL_MS,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setActive(false);
    });
    return () => anim.stop();
  }, [burst, progress]);

  if (!active) return null;

  return (
    <Animated.View style={styles.overlay} pointerEvents="none">
      {Array.from({ length: COUNT }, (_, i) => {
        const startX = rand(i) * 100; // percent across the screen
        const drift = (rand(i + 50) - 0.5) * 120;
        const size = 7 + rand(i + 100) * 6;
        const color = PARTICLE_COLORS[i % PARTICLE_COLORS.length];
        const spin = rand(i + 150) > 0.5 ? '540deg' : '-540deg';
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: -20,
              left: `${startX}%`,
              width: size,
              height: size * 0.55,
              borderRadius: 2,
              backgroundColor: color,
              opacity: progress.interpolate({
                inputRange: [0, 0.7, 1],
                outputRange: [1, 1, 0],
              }),
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 620 + rand(i + 200) * 160],
                  }),
                },
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, drift],
                  }),
                },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', spin],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    zIndex: 99,
  },
});
