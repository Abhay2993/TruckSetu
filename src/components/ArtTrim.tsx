/**
 * Painted truck-border trim — the bunting strip of alternating triangles
 * and dots you see hand-painted along the edge of every Indian lorry body.
 * Used as the app's signature ornament: under the screen header and as a
 * divider inside hero cards. One fixed-width SVG inside an overflow-hidden
 * view, so it needs no layout measurement and costs one draw call.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

const TRI_COLORS = ['#F5820D', '#1E8E3E', '#C62828'] as const;
const TILE = 26;
const TILES = 60;
const ART_H = 13; // design-space height: 9-unit triangles + dots below

export function ArtTrim({
  height = 8,
  opacity = 1,
}: {
  height?: number;
  opacity?: number;
}): React.JSX.Element {
  const tiles: React.JSX.Element[] = [];
  for (let i = 0; i < TILES; i++) {
    const x = i * TILE;
    const color = TRI_COLORS[i % TRI_COLORS.length] ?? TRI_COLORS[0];
    tiles.push(
      <Path key={`t${i}`} d={`M${x} 0 L${x + TILE} 0 L${x + TILE / 2} 9 Z`} fill={color} />,
      <Circle key={`d${i}`} cx={x + TILE / 2} cy={11.4} r={1.6} fill="#F7C948" />,
    );
  }
  // Uniform scale from design space to the requested height — the strip is
  // wide enough (60 tiles) that even large heights still cover any screen.
  const scale = height / ART_H;
  return (
    <View style={[styles.clip, { height, opacity }]} pointerEvents="none">
      <Svg
        width={TILE * TILES * scale}
        height={height}
        viewBox={`0 0 ${TILE * TILES} ${ART_H}`}
      >
        {tiles}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    width: '100%',
    overflow: 'hidden',
  },
});
