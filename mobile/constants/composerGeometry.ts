import { Platform } from 'react-native';

/**
 * Standard Composer Geometry System for Semester Library
 * Shared between Post Comments, Group Chat, and future text composers.
 *
 * Requirements:
 * - One-line composer visual height: 44-48dp
 * - Horizontal padding: 12-16dp
 * - Minimum touch targets: 44dp
 * - Action button visual size: 40dp circle
 * - Border radius: 22dp pill
 * - Keyboard gap: ~6-10dp
 * - Visual centerline alignment between input field and side action buttons
 */
export const COMPOSER_GEOMETRY = {
  // Input dimensions
  minInputHeight: 44,
  maxInputHeight: 120,
  borderRadius: 22,
  
  // Padding & spacing
  horizontalPadding: 12,
  innerHorizontalGap: 10,
  verticalPadding: 8,
  keyboardGap: 8,
  
  // Interactive action controls
  minActionTouchTarget: 44,
  actionButtonSize: 40,
  actionButtonRadius: 20,
  
  // Text & Caret
  fontSize: 15,
  lineHeight: 20,
  inputPaddingTop: Platform.OS === 'ios' ? 11 : 9,
  inputPaddingBottom: Platform.OS === 'ios' ? 11 : 9,
  inputPaddingHorizontal: 16,
} as const;
