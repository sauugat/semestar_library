export const ATTENDANCE_THRESHOLD_PERCENT = 50;

export const ATTENDANCE_THEME = {
  colors: {
    background: '#080808',
    surface: '#121212',
    surfaceInner: '#181818',
    surfacePill: '#1B1B1B',
    border: '#222222',
    borderSubtle: '#1E1E1E',
    borderPill: '#2A2A2A',
    textPrimary: '#FFFFFF',
    textSecondary: '#A1A1AA',
    textMuted: '#71717A',
    accent: '#F5F5F5',
    track: '#262626',
    present: '#22C55E',
    presentBg: 'rgba(34, 197, 94, 0.14)',
    presentBorder: 'rgba(34, 197, 94, 0.35)',
    danger: '#EF4444',
    dangerBg: 'rgba(239, 68, 68, 0.14)',
    dangerBorder: 'rgba(239, 68, 68, 0.4)',
  },
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    screenPadding: 16,
  },
  radii: {
    sm: 10,
    inner: 14,
    card: 18,
    summaryCard: 22,
    pill: 999,
  },
  typography: {
    headerTitle: { fontSize: 20, fontWeight: '700' as const, lineHeight: 25 },
    headerSub: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
    ringPercent: { fontSize: 24, fontWeight: '800' as const, lineHeight: 28 },
    statValue: { fontSize: 20, fontWeight: '800' as const, lineHeight: 24 },
    sectionTitle: { fontSize: 17, fontWeight: '700' as const, lineHeight: 22 },
    subjectName: { fontSize: 15, fontWeight: '700' as const, lineHeight: 20 },
    subjectPercent: { fontSize: 18, fontWeight: '800' as const, lineHeight: 22 },
    body: { fontSize: 14, fontWeight: '600' as const, lineHeight: 19 },
    muted: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
    caption: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16 },
  },
  touchTarget: 42,
} as const;

/**
 * Formats YYYY-MM-DD into "Oct 26, 2026" without UTC timezone shifts or duplicate ISO suffix.
 */
export function formatCleanNepalDate(yyyyMmDd: string): string {
  if (!yyyyMmDd || typeof yyyyMmDd !== 'string') return '—';
  const clean = yyyyMmDd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const [yStr, mStr, dStr] = clean.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const day = Number(dStr);
  if (monthIdx < 0 || monthIdx > 11 || !day) return clean;
  return `${months[monthIdx]} ${day}, ${year}`;
}

export function isBelowAttendanceThreshold(
  percentage: number,
  totalSessions: number
): boolean {
  if (!totalSessions || totalSessions <= 0) return false;
  return Number(percentage) < ATTENDANCE_THRESHOLD_PERCENT;
}
