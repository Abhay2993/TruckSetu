/**
 * Design tokens for TruckSetu.
 *
 * The app uses plain React Native StyleSheets fed by this single token map
 * instead of NativeWind: zero extra Babel/Metro configuration, fully
 * type-checked, and trivially portable to a design system later. Screens
 * never hard-code a colour — they read from `colors` so a future dark theme
 * only touches this file.
 */

export const colors = {
  /** Deep trust-navy — primary brand, headers, tab bar. */
  primary: '#0F2A5C',
  primaryDark: '#0A1D40',
  /** Saffron — CTAs and the dynamic "Setu" word. */
  accent: '#F5820D',
  accentSoft: '#FDEBD7',

  success: '#1E8E3E',
  successSoft: '#E3F4E8',
  warning: '#B26A00',
  warningSoft: '#FFF3DF',
  danger: '#C62828',
  dangerSoft: '#FDE7E7',

  background: '#F4F6FA',
  surface: '#FFFFFF',
  border: '#E2E7F0',

  textPrimary: '#16223A',
  textSecondary: '#5B6A85',
  textInverse: '#FFFFFF',
  textMuted: '#8A96AC',

  /** Simulated map canvas. */
  mapBg: '#EAF1E8',
  mapGrid: '#DCE6DA',
  mapRoute: '#3F6FD8',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 24,
  display: 34,
} as const;

/** Shared card shadow — subtle, Android-elevation friendly. */
export const cardShadow = {
  shadowColor: '#0F2A5C',
  shadowOpacity: 0.08,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
} as const;
