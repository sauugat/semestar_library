/**
 * Semester Library — Messaging Motion Design Tokens
 * Reusable motion constants for animations, transitions, and gesture responses.
 *
 * Design targets:
 * - Fast feedback: 70–110 ms (default: 90 ms)
 * - Small transitions: 100–150 ms (default: 120 ms)
 * - Element entrance: 120–180 ms (default: 150 ms)
 * - Context menu: 160–220 ms (default: 180 ms)
 * - Navigation: 200–280 ms (default: 240 ms)
 */

export const MotionDuration = {
  fastFeedback: 90,
  smallTransition: 120,
  elementEntrance: 150,
  contextMenu: 180,
  navigation: 240,

  // Standard aliases
  fast: 90,
  normal: 150,
  slow: 240,
} as const;

export const MotionEasing = {
  // Cubic-bezier control points [x1, y1, x2, y2]
  easeOut: [0.16, 1, 0.3, 1] as const,
  easeInOut: [0.4, 0, 0.2, 1] as const,
  standard: [0.2, 0, 0, 1] as const,
  sharp: [0.4, 0, 0.6, 1] as const,
} as const;

export const MotionSpring = {
  // Reanimated withSpring configurations
  responsive: {
    damping: 20,
    stiffness: 180,
    mass: 0.8,
  },
  gentle: {
    damping: 28,
    stiffness: 140,
    mass: 1.0,
  },
  snappy: {
    damping: 24,
    stiffness: 220,
    mass: 0.7,
  },
  bouncy: {
    damping: 14,
    stiffness: 160,
    mass: 0.9,
  },
} as const;

export const Motion = {
  duration: MotionDuration,
  easing: MotionEasing,
  spring: MotionSpring,
} as const;
