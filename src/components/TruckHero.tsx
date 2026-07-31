/**
 * Animated highway hero for the navy gradient screens (login/onboarding).
 *
 * A layered scene: rising sun and hill silhouettes in SVG, a road strip
 * whose lane dashes scroll continuously, and the IndianTruck driving in
 * from the left, then idling with a gentle suspension bob. All plain
 * Animated + SVG — no Lottie/asset downloads, works on native and web.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { IndianTruck } from './IndianTruck';

const DASH_CYCLE = 48; // dash width + gap — one seamless scroll period
const useNative = Platform.OS !== 'web';

export function TruckHero({ height = 216 }: { height?: number }): React.JSX.Element {
  const driveIn = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const dash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(driveIn, {
      toValue: 1,
      duration: 1100,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: useNative,
    }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 460, easing: Easing.inOut(Easing.quad), useNativeDriver: useNative }),
        Animated.timing(bob, { toValue: 0, duration: 460, easing: Easing.inOut(Easing.quad), useNativeDriver: useNative }),
      ]),
    ).start();
    Animated.loop(
      Animated.timing(dash, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: useNative }),
    ).start();
  }, [driveIn, bob, dash]);

  const truckX = driveIn.interpolate({ inputRange: [0, 1], outputRange: [-360, 14] });
  const truckY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -2.5] });
  const dashX = dash.interpolate({ inputRange: [0, 1], outputRange: [0, -DASH_CYCLE] });

  return (
    <View style={[styles.scene, { height }]} pointerEvents="none">
      {/* Sun + hills */}
      <Svg width="100%" height="100%" viewBox="0 0 390 216" preserveAspectRatio="xMidYMax slice" style={StyleSheet.absoluteFill}>
        <Circle cx={318} cy={54} r={44} fill="#F7C948" opacity={0.14} />
        <Circle cx={318} cy={54} r={30} fill="#F7C948" opacity={0.25} />
        <Circle cx={318} cy={54} r={20} fill="#F7C948" />
        <Path d="M0 176 Q 90 108 195 156 Q 260 184 390 150 L390 216 L0 216 Z" fill="rgba(255,255,255,0.06)" />
        <Path d="M0 190 Q 130 140 250 178 Q 330 200 390 182 L390 216 L0 216 Z" fill="rgba(255,255,255,0.09)" />
      </Svg>

      {/* Road with scrolling lane dashes */}
      <View style={styles.road}>
        <Animated.View style={[styles.dashRow, { transform: [{ translateX: dashX }] }]}>
          {Array.from({ length: 16 }, (_, i) => (
            <View key={i} style={styles.dash} />
          ))}
        </Animated.View>
      </View>

      {/* The lorry */}
      <Animated.View
        style={[styles.truck, { transform: [{ translateX: truckX }, { translateY: truckY }] }]}
      >
        <IndianTruck width={300} shadow={false} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  road: {
    height: 30,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderTopWidth: 2,
    borderTopColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dashRow: {
    flexDirection: 'row',
    width: DASH_CYCLE * 20,
  },
  dash: {
    width: 26,
    height: 3,
    borderRadius: 2,
    marginRight: DASH_CYCLE - 26,
    backgroundColor: 'rgba(255,255,255,0.65)',
  },
  truck: {
    position: 'absolute',
    bottom: 16,
    left: 0,
  },
});
