/**
 * Semester Library — Messaging Geometry Design Tokens
 * Standardized dimensions, touch targets, and spacing for messaging interfaces.
 * Adheres strictly to the 8-point rhythm (with 4-point half steps) and 48dp Android touch targets.
 */

export const MessagingGeometry = {
  // Screen & layout
  screenHorizontalPadding: 16,
  sectionGap: 24,

  // Headers
  headerHeight: 56,
  headerHorizontalPadding: 16,
  headerBackTouchTarget: 48,
  headerActionTouchTarget: 48,

  // Inbox list rows
  inboxRowMinHeight: 72,
  inboxRowPaddingVertical: 12,
  inboxRowPaddingHorizontal: 16,
  inboxRowGap: 12,

  // Search input
  searchBarHeight: 40,
  searchBarPaddingHorizontal: 12,
  searchIconSize: 16,

  // Avatars
  avatarSizeSm: 32,
  avatarSizeMd: 44,
  avatarSizeLg: 48,
  avatarRadius: 9999,

  // Message bubbles
  bubbleMaxWidthPercent: 0.78,
  bubblePaddingVertical: 8,
  bubblePaddingHorizontal: 12,
  bubbleConsecutiveMargin: 2,
  bubbleGroupMargin: 8,
  bubbleRadiusDefault: 16,
  bubbleRadiusConsecutive: 4,

  // Composer
  composerMinInputHeight: 44,
  composerMaxInputHeight: 120,
  composerHorizontalPadding: 12,
  composerVerticalPadding: 8,
  composerKeyboardGap: 8,
  composerSendButtonSize: 36,
  composerActionTouchTarget: 48,

  // Status & metadata indicators
  roleBadgePaddingVertical: 2,
  roleBadgePaddingHorizontal: 6,
  roleBadgeRadius: 4,
  unreadBadgeMinSize: 18,
  unreadBadgePaddingHorizontal: 5,
  unreadBadgeRadius: 9,

  // Modals & action menus
  modalPadding: 16,
  modalCardRadius: 16,
  sheetRadius: 24,
  actionMenuRowMinHeight: 48,
  actionMenuRowPaddingHorizontal: 16,
  actionMenuIconSize: 20,

  // Empty state
  emptyStateSpacingSm: 6,
  emptyStateSpacingMd: 14,
  emptyStateSpacingLg: 20,
  emptyStateIconSize: 44,

  // Standard interactive touch targets (Android 48dp minimum standard)
  minTouchTarget: 48,
  comfortableTouchTarget: 52,
} as const;
