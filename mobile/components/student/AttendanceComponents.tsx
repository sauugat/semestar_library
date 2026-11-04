import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ATTENDANCE_THEME as T,
  isBelowAttendanceThreshold,
} from './attendanceTheme';
import type { StudentSubjectAttendanceItem } from './StudentAttendanceView';
import { formatDisplayPercentage } from './StudentAttendanceView';

const RING_SIZE = 124;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CENTER = RING_SIZE / 2;
const RING_SEGMENTS = 72;

function CircularProgressRing({
  percentage,
  hasSessions,
  isBelowThreshold,
  label,
}: {
  percentage: number;
  hasSessions: boolean;
  isBelowThreshold: boolean;
  label: string;
}) {
  const clamped = hasSessions ? Math.max(0, Math.min(100, Number(percentage) || 0)) : 0;
  const activeColor = isBelowThreshold ? T.colors.danger : T.colors.accent;
  const isFullCircle = clamped >= 99.5;

  const activeDots = useMemo(() => {
    if (isFullCircle || clamped <= 0) return [];
    const count = Math.max(1, Math.round((clamped / 100) * RING_SEGMENTS));
    const dots: { key: number; left: number; top: number }[] = [];
    for (let i = 0; i < count; i++) {
      const angleDeg = -90 + (i / RING_SEGMENTS) * 360;
      const angleRad = (angleDeg * Math.PI) / 180;
      const cx = RING_CENTER + RING_RADIUS * Math.cos(angleRad);
      const cy = RING_CENTER + RING_RADIUS * Math.sin(angleRad);
      dots.push({
        key: i,
        left: cx - RING_STROKE / 2,
        top: cy - RING_STROKE / 2,
      });
    }
    return dots;
  }, [clamped, isFullCircle]);

  return (
    <View style={styles.ringWrapper}>
      {/* Base Track Circle */}
      <View
        style={[
          styles.ringTrack,
          isFullCircle && { borderColor: activeColor },
        ]}
      />

      {/* Partial Progress Arc (1% - 99%) */}
      {!isFullCircle &&
        activeDots.map((dot) => (
          <View
            key={dot.key}
            style={[
              styles.ringDot,
              {
                left: dot.left,
                top: dot.top,
                backgroundColor: activeColor,
              },
            ]}
          />
        ))}

      {/* Centered Percentage & Label */}
      <View style={styles.ringCenterContent}>
        <Text
          style={[
            styles.ringPercentText,
            isBelowThreshold && { color: T.colors.danger },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
        <Text style={styles.ringSubText}>Overall</Text>
      </View>
    </View>
  );
}

export function AttendanceHeader({
  subtitle,
  onBack,
  onRefresh,
}: {
  subtitle?: string;
  onBack: () => void;
  onRefresh?: () => void;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.circleIconBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="arrow-back" size={20} color={T.colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.headerTextWrap}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Student Attendance
        </Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {onRefresh ? (
        <TouchableOpacity
          onPress={onRefresh}
          style={styles.circleIconBtn}
          accessibilityRole="button"
          accessibilityLabel="Refresh attendance"
        >
          <Ionicons name="refresh" size={19} color={T.colors.textPrimary} />
        </TouchableOpacity>
      ) : (
        <View style={styles.circleIconPlaceholder} />
      )}
    </View>
  );
}

export function OverallSummary({
  presentCount,
  totalSessions,
  absentCount,
  attendancePercentage,
  percentageAvailable,
}: {
  presentCount: number;
  totalSessions: number;
  absentCount: number;
  attendancePercentage: number;
  percentageAvailable: boolean;
}) {
  const hasSessions = Boolean(percentageAvailable && totalSessions > 0);
  const pctDisplay = hasSessions
    ? formatDisplayPercentage(attendancePercentage, true)
    : '0%';
  const belowThreshold = isBelowAttendanceThreshold(attendancePercentage, totalSessions);

  return (
    <View
      style={[
        styles.summaryCard,
        belowThreshold && { borderColor: T.colors.dangerBorder },
      ]}
    >
      <View style={styles.summaryTopRow}>
        <CircularProgressRing
          percentage={attendancePercentage}
          hasSessions={hasSessions}
          isBelowThreshold={belowThreshold}
          label={pctDisplay}
        />

        <View style={styles.summaryDivider} />

        <View style={styles.statsColumn}>
          {/* Present Box */}
          <View style={styles.statWideCard}>
            <View style={[styles.statIconCircle, { backgroundColor: T.colors.presentBg }]}>
              <Ionicons name="checkmark-circle" size={18} color={T.colors.present} />
            </View>
            <View style={styles.statTextGroup}>
              <Text style={[styles.statValue, { color: T.colors.present }]}>
                {presentCount}
              </Text>
              <Text style={[styles.statLabel, { color: T.colors.present }]}>
                Present
              </Text>
            </View>
          </View>

          {/* Absent Box */}
          <View style={styles.statWideCard}>
            <View style={[styles.statIconCircle, { backgroundColor: T.colors.dangerBg }]}>
              <Ionicons name="close-circle" size={18} color={T.colors.danger} />
            </View>
            <View style={styles.statTextGroup}>
              <Text style={[styles.statValue, { color: T.colors.danger }]}>
                {absentCount}
              </Text>
              <Text style={[styles.statLabel, { color: T.colors.danger }]}>
                Absent
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

export function SubjectRow({ subject }: { subject: StudentSubjectAttendanceItem }) {
  const hasSessions = Boolean(subject.percentageAvailable && subject.totalSessions > 0);
  const pctLabel = hasSessions
    ? formatDisplayPercentage(subject.attendancePercentage, true)
    : '0%';
  const ratio = hasSessions
    ? Math.max(0, Math.min(100, Number(subject.attendancePercentage) || 0))
    : 0;
  const belowThreshold = isBelowAttendanceThreshold(
    subject.attendancePercentage,
    subject.totalSessions
  );
  const barColor = belowThreshold ? T.colors.danger : T.colors.accent;

  return (
    <View
      style={[
        styles.subjectCard,
        belowThreshold && { borderColor: T.colors.dangerBorder },
      ]}
    >
      <View style={styles.codeBadge}>
        <Text style={styles.codeBadgeText}>{subject.code || subject.subjectId}</Text>
      </View>

      <View style={styles.subjectMiddle}>
        <Text style={styles.subjectName}>{subject.name}</Text>
        {hasSessions ? (
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${ratio}%`, backgroundColor: barColor },
              ]}
            />
          </View>
        ) : (
          <Text style={styles.noSessionsText}>No sessions recorded</Text>
        )}
      </View>

      <View style={styles.subjectRight}>
        <View style={styles.subjectStatsRow}>
          <Text
            style={[
              styles.subjectPercent,
              belowThreshold && { color: T.colors.danger },
              !hasSessions && { color: T.colors.textSecondary },
            ]}
          >
            {pctLabel}
          </Text>
          {hasSessions && (
            <Text style={styles.subjectFraction}>
              ({subject.presentCount}/{subject.totalSessions})
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

export function TeacherUpdateNotice() {
  return (
    <View style={styles.footerNotice}>
      <Ionicons
        name="information-circle-outline"
        size={18}
        color={T.colors.textSecondary}
      />
      <Text style={styles.footerNoticeText}>
        Attendance is automatically updated by your teachers.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: T.spacing.screenPadding,
    paddingVertical: T.spacing.sm,
  },
  circleIconBtn: {
    width: T.touchTarget,
    height: T.touchTarget,
    borderRadius: T.touchTarget / 2,
    backgroundColor: T.colors.surface,
    borderWidth: 1,
    borderColor: T.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleIconPlaceholder: {
    width: T.touchTarget,
    height: T.touchTarget,
  },
  headerTextWrap: {
    flex: 1,
    marginHorizontal: T.spacing.sm,
  },
  headerTitle: {
    ...T.typography.headerTitle,
    color: T.colors.textPrimary,
  },
  headerSubtitle: {
    ...T.typography.headerSub,
    color: T.colors.textSecondary,
    marginTop: 2,
  },
  summaryCard: {
    backgroundColor: T.colors.surface,
    borderRadius: T.radii.summaryCard,
    borderWidth: 1,
    borderColor: T.colors.border,
    padding: T.spacing.md,
    marginBottom: T.spacing.lg,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ringWrapper: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ringTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_CENTER,
    borderWidth: RING_STROKE,
    borderColor: T.colors.track,
  },
  ringDot: {
    position: 'absolute',
    width: RING_STROKE,
    height: RING_STROKE,
    borderRadius: RING_STROKE / 2,
  },
  ringCenterContent: {
    width: RING_SIZE - RING_STROKE * 2 - 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPercentText: {
    ...T.typography.ringPercent,
    color: T.colors.textPrimary,
    textAlign: 'center',
  },
  ringSubText: {
    ...T.typography.muted,
    color: T.colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: T.colors.border,
    marginHorizontal: T.spacing.md,
  },
  statsColumn: {
    flex: 1,
    gap: 10,
    justifyContent: 'center',
  },
  statWideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.colors.surfaceInner,
    borderRadius: T.radii.inner,
    borderWidth: 1,
    borderColor: T.colors.border,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  statIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTextGroup: {
    flex: 1,
    justifyContent: 'center',
  },
  statValue: {
    ...T.typography.statValue,
  },
  statLabel: {
    ...T.typography.caption,
    marginTop: 1,
  },
  subjectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.colors.surface,
    borderRadius: T.radii.card,
    borderWidth: 1,
    borderColor: T.colors.border,
    paddingHorizontal: T.spacing.md,
    paddingVertical: T.spacing.md,
    marginBottom: T.spacing.sm,
  },
  codeBadge: {
    backgroundColor: T.colors.surfacePill,
    borderWidth: 1,
    borderColor: T.colors.borderPill,
    borderRadius: T.radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  codeBadgeText: {
    ...T.typography.caption,
    color: T.colors.textSecondary,
  },
  subjectMiddle: {
    flex: 1,
    marginHorizontal: 14,
  },
  subjectName: {
    ...T.typography.subjectName,
    color: T.colors.textPrimary,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: T.colors.track,
    borderRadius: T.radii.pill,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: T.radii.pill,
  },
  noSessionsText: {
    ...T.typography.muted,
    color: T.colors.textMuted,
    marginTop: 4,
  },
  subjectRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 4,
  },
  subjectStatsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  subjectPercent: {
    ...T.typography.subjectPercent,
    color: T.colors.textPrimary,
  },
  subjectFraction: {
    ...T.typography.muted,
    color: T.colors.textSecondary,
  },
  footerNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.colors.surface,
    borderRadius: T.radii.inner,
    borderWidth: 1,
    borderColor: T.colors.border,
    paddingHorizontal: T.spacing.md,
    paddingVertical: 14,
    marginTop: T.spacing.xs,
  },
  footerNoticeText: {
    ...T.typography.muted,
    color: T.colors.textSecondary,
    flex: 1,
  },
});
