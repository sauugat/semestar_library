/**
 * Semester Library Mobile Design System Tokens
 * Standardized 8-point spacing rhythm, normalized radii, touch targets, and typography.
 */

/**
 * Strict Monochrome Messaging Palette
 * Dedicated tokens for Step 5B.4A premium minimalist aesthetic.
 */
export const Monochrome = {
  background: '#080808',
  header: '#101010',
  surface: '#141414',
  surfaceElevated: '#1C1C1C',
  surfaceSubtle: '#181818',
  border: '#282828',
  borderSubtle: '#1F1F1F',
  borderStrong: '#383838',

  // Floating Navigation Bar tokens (Apple Liquid Glass-inspired monochrome capsule)
  navSurface: 'rgba(23, 23, 23, 0.70)',
  navSurfaceOpaque: '#171717',
  navBorder: 'rgba(255, 255, 255, 0.12)',
  navIconInactive: '#B0B0B0',
  navIconActive: '#FFFFFF',
  navActiveIndicator: 'rgba(255, 255, 255, 0.14)',

  text: '#FFFFFF',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1A1',
  textTertiary: '#737373',
  textDisabled: '#525252',

  surfaceRaised: '#242424',

  // Message Bubbles: Gray #626262 outgoing, Black/Charcoal #171717 incoming
  bubbleOutgoing: '#626262',
  bubbleOutgoingText: '#FFFFFF',
  bubbleOutgoingMeta: '#D4D4D4',
  outgoingBubble: '#626262',
  outgoingText: '#FFFFFF',
  outgoingMeta: '#D4D4D4',

  bubbleIncoming: '#171717',
  bubbleIncomingText: '#FFFFFF',
  bubbleIncomingMeta: '#737373',
  incomingBubble: '#171717',
  incomingText: '#FFFFFF',
  incomingMeta: '#737373',

  // Composer tokens
  composerSurface: '#171717',
  composerInput: '#242424',
  composerText: '#F5F5F5',
  composerPlaceholder: '#808080',

  cohortAvatarBg: '#1C1C1C',
  cohortAvatarBorder: '#282828',
  cohortAvatarIcon: '#E5E5E5',

  unreadBadgeBg: '#F5F5F5',
  unreadBadgeText: '#111111',
} as const;

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
    border: '#282828',
    borderSubtle: '#1f1f1f',
    borderStrong: '#383838',
    text: '#f5f5f5',
    textSecondary: '#a3a3a3',
    textMuted: '#737373',
    textTertiary: '#525252',
    primary: '#f5f5f5',
    primaryText: '#090909',
    primaryLight: '#262626',
    primaryDark: '#d4d4d4',
    accent: '#f5f5f5',
    tabIconDefault: '#737373',
    tabIconSelected: '#f5f5f5',
    tabBarBackground: '#0d0d0d',
    tabBarBorder: '#282828',
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
    inputBorder: '#282828',
    inputFocusBorder: '#f5f5f5',
    skeleton: '#1e1e1e',
    overlay: 'rgba(0, 0, 0, 0.75)',

    // Semantic messaging tokens (Strict Monochrome)
    textDisabled: '#525252',
    interactivePressed: 'rgba(255, 255, 255, 0.06)',
    bubbleOutgoingBg: '#eaeaea',
    bubbleOutgoingText: '#111111',
    bubbleIncomingBg: '#242424',
    bubbleIncomingText: '#f5f5f5',
    bubbleIncomingBorder: '#282828',
    timestampText: '#737373',
    receiptSent: '#555555',
    receiptSeen: '#111111',
    unreadBadgeBg: '#f5f5f5',
    unreadBadgeText: '#111111',
    offlineBannerBg: '#1c1c1c',
    offlineBannerText: '#a1a1a1',
    blockedBannerBg: '#181818',
    blockedBannerText: '#737373',
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

    // Semantic messaging tokens (Light mode)
    textDisabled: '#a3a3a3',
    interactivePressed: 'rgba(0, 0, 0, 0.05)',
    bubbleOutgoingBg: '#0a0a0a',
    bubbleOutgoingText: '#ffffff',
    bubbleIncomingBg: '#f0f0f0',
    bubbleIncomingText: '#0a0a0a',
    bubbleIncomingBorder: 'rgba(0, 0, 0, 0.06)',
    timestampText: '#737373',
    receiptSent: '#737373',
    receiptSeen: '#2563eb',
    unreadBadgeBg: '#0a0a0a',
    unreadBadgeText: '#ffffff',
    offlineBannerBg: '#f0f0f0',
    offlineBannerText: '#525252',
    blockedBannerBg: '#f5f5f5',
    blockedBannerText: '#737373',
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
 * Semantic Messaging Typography Tokens
 * Standardized typography scale for conversations, threads, inputs, and badges.
 */
export const MessagingTypography = {
  pageTitle: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const, letterSpacing: -0.2 },
  sectionHeading: { fontSize: 12, lineHeight: 16, fontWeight: '700' as const, letterSpacing: 0.5 },
  conversationTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const },
  inboxUsername: { fontSize: 15, lineHeight: 20, fontWeight: '600' as const },
  messageBody: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const },
  messagePreview: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  timestamp: { fontSize: 11, lineHeight: 15, fontWeight: '400' as const },
  roleMetadata: { fontSize: 10, lineHeight: 13, fontWeight: '700' as const, letterSpacing: 0.4 },
  inputText: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  buttonLabel: { fontSize: 14, lineHeight: 18, fontWeight: '600' as const },
  statusLabel: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
} as const;

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

/**
 * Semantic Messaging Radii
 */
export const MessagingRadii = {
  controlSm: 6,
  input: 11,
  button: 11,
  card: 16,
  bubble: 16,
  bubbleConsecutive: 4,
  sheet: 24,
  pill: 9999,
  avatar: 9999,
} as const;

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

// Re-export shared messaging tokens
export * from './motion';
export * from './messagingGeometry';

