/**
 * Semester Library Mobile Design System Tokens
 * Standardized 8-point spacing rhythm, normalized radii, touch targets, and typography.
 */

export const Colors = {
  // Dark mode is the primary / default aesthetic (monochrome black/charcoal)
  dark: {
    background: '#0a0a0a',
    surface: '#141414',
    surfaceRaised: '#1c1c1c',
    surfaceSubtle: '#181818',
    card: '#141414',
    cardElevated: '#1c1c1c',
    cardSubtle: '#111111',
    border: 'rgba(255, 255, 255, 0.08)',
    borderSubtle: 'rgba(255, 255, 255, 0.04)',
    borderStrong: 'rgba(255, 255, 255, 0.16)',
    text: '#f5f5f5',
    textSecondary: '#a3a3a3',
    textMuted: '#737373',
    textTertiary: '#525252',
    primary: '#f5f5f5',
    primaryText: '#0a0a0a',
    primaryLight: '#262626',
    primaryDark: '#d4d4d4',
    accent: '#f5f5f5',
    tabIconDefault: '#737373',
    tabIconSelected: '#f5f5f5',
    tabBarBackground: '#0d0d0d',
    tabBarBorder: 'rgba(255, 255, 255, 0.08)',
    liked: '#ef4444',
    likedBg: 'rgba(239, 68, 68, 0.12)',
    success: '#22c55e',
    successBg: 'rgba(34, 197, 94, 0.12)',
    warning: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.12)',
    error: '#ef4444',
    errorBg: 'rgba(239, 68, 68, 0.12)',
    badgeNotice: '#ffffff',
    badgeNoticeBg: 'rgba(255, 255, 255, 0.1)',
    inputBackground: '#161616',
    inputBorder: 'rgba(255, 255, 255, 0.1)',
    inputFocusBorder: '#f5f5f5',
    skeleton: '#1e1e1e',
    overlay: 'rgba(0, 0, 0, 0.75)',
  },
  // Light monochrome variant
  light: {
    background: '#fafafa',
    surface: '#ffffff',
    surfaceRaised: '#f5f5f5',
    surfaceSubtle: '#f0f0f0',
    card: '#ffffff',
    cardElevated: '#f7f7f7',
    cardSubtle: '#f3f3f3',
    border: 'rgba(0, 0, 0, 0.08)',
    borderSubtle: 'rgba(0, 0, 0, 0.04)',
    borderStrong: 'rgba(0, 0, 0, 0.18)',
    text: '#0a0a0a',
    textSecondary: '#525252',
    textMuted: '#737373',
    textTertiary: '#a3a3a3',
    primary: '#0a0a0a',
    primaryText: '#ffffff',
    primaryLight: '#f0f0f0',
    primaryDark: '#171717',
    accent: '#0a0a0a',
    tabIconDefault: '#8a8a8a',
    tabIconSelected: '#0a0a0a',
    tabBarBackground: '#ffffff',
    tabBarBorder: 'rgba(0, 0, 0, 0.08)',
    liked: '#dc2626',
    likedBg: 'rgba(220, 38, 38, 0.08)',
    success: '#16a34a',
    successBg: 'rgba(22, 163, 74, 0.08)',
    warning: '#d97706',
    warningBg: 'rgba(217, 119, 6, 0.08)',
    error: '#dc2626',
    errorBg: 'rgba(220, 38, 38, 0.08)',
    badgeNotice: '#0a0a0a',
    badgeNoticeBg: 'rgba(0, 0, 0, 0.06)',
    inputBackground: '#f3f3f3',
    inputBorder: 'rgba(0, 0, 0, 0.1)',
    inputFocusBorder: '#0a0a0a',
    skeleton: '#e5e5e5',
    overlay: 'rgba(0, 0, 0, 0.5)',
  },
};

/**
 * 8-point rhythm spacing scale
 */
export const Spacing = {
  micro: 4,     // 4dp micro gap
  tight: 8,     // 8dp tight spacing
  compact: 12,  // 12dp compact spacing
  normal: 16,   // 16dp default card padding & horizontal margins
  section: 24,  // 24dp section separation
  large: 32,    // 32dp spacious layout gaps
  xlarge: 48,   // 48dp large screen spacing

  // Backwards compatibility aliases
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,

  // Semantic spacing tokens
  screenHorizontal: 16,
  cardPadding: 16,
  sectionGap: 24,
  composerClearance: 16,
};

export const Typography = {
  xs: { fontSize: 11, lineHeight: 15 },
  sm: { fontSize: 13, lineHeight: 18 },
  md: { fontSize: 15, lineHeight: 22 },
  lg: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  xl: { fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  xxl: { fontSize: 26, lineHeight: 32, fontWeight: '800' as const },
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '800' as const },
};

/**
 * Standardized Radii
 * Inputs: 10-12
 * Buttons: 10-12
 * Cards: 14-16
 * Bottom sheets: 24
 * Pills: fully rounded
 */
export const Radii = {
  sm: 6,
  input: 11,
  button: 11,
  card: 16,
  sheet: 24,
  pill: 9999,
  full: 9999,

  // Compatibility aliases
  md: 11,
  lg: 16,
  xl: 24,
};

export const TouchTarget = {
  min: 44,
  comfortable: 48,
};

export const IconSizes = {
  xs: 14,
  sm: 18,
  md: 22,
  lg: 26,
  xl: 32,
};

export const Shadows = {
  none: {},
  subtle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
  },
  elevated: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
};
