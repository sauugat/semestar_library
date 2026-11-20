import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Animated,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/services/api';
import {
  DEFAULT_ROUTINE_OPTIONS,
  formatBsDateFriendly,
  formatSlotNptLabel,
  type RoutineOptionsCatalog,
} from '@/constants/nepaliCalendar';
import {
  AdminClassPeriodModal,
  AdminExamTableModal,
  AdminNewClassRoutineModal,
} from '@/components/routine/AdminRoutineEditorModals';

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const FACULTY_TYPE_LABELS: Record<string, string> = {
  FT: 'Full Time (FT)',
  CC: 'Course Contract (CC)',
  MA: "Master's Assistantship (MA)",
};

interface RoutineSlot {
  id: number;
  slot_order: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  label: string;
  is_break: boolean;
}

interface RoutineEntry {
  id: number;
  slot_id: number;
  day_of_week: string;
  subject_name: string | null;
  faculty_name: string | null;
  faculty_type: string | null;
  class_type: string | null;
  is_empty: boolean;
  is_break?: boolean;
}

interface ClassRoutineData {
  id: number;
  university: string;
  program: string;
  academic_session: string;
  year: number;
  semester: number;
  effective_date: string | null;
  status: string;
  slots: RoutineSlot[];
  entries: RoutineEntry[];
}

interface ExamRow {
  id: number;
  semester: number;
  subject_name: string;
  subject_code?: string | null;
  exam_date: string;
  calendar?: string | null;
  exam_time?: string | null;
  room?: string | null;
  weekday?: string | null;
  exam_type?: string | null;
}

const KATHMANDU_OFFSET_MS = 345 * 60 * 1000;

function toKathmanduDate(dateInput: Date = new Date()): Date {
  return new Date(dateInput.getTime() + KATHMANDU_OFFSET_MS);
}

function getTodayWeekday(dateInput: Date = new Date()): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[toKathmanduDate(dateInput).getUTCDay()];
}

function getCurrentKathmanduMinutes(dateInput: Date = new Date()): number {
  const ktm = toKathmanduDate(dateInput);
  return ktm.getUTCHours() * 60 + ktm.getUTCMinutes();
}

function parseMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export default function RoutineScreen() {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { width: windowWidth } = useWindowDimensions();
  const isAdmin = Boolean(user?.isAdmin || user?.role === 'admin');
  const isStaff = isAdmin || user?.role === 'teacher';

  const today = getTodayWeekday();
  const defaultDay = (WORKING_DAYS as readonly string[]).includes(today) ? today : 'Monday';
  const defaultDayIndex = Math.max(0, (WORKING_DAYS as readonly string[]).indexOf(defaultDay));
  const initialContentWidth = Math.max(1, windowWidth - spacing.md * 2);

  const [mode, setMode] = useState<'class' | 'exam'>('class');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(defaultDayIndex);
  const [pagerWidth, setPagerWidth] = useState<number>(initialContentWidth);
  const [pillsWidth, setPillsWidth] = useState<number>(initialContentWidth);
  const [staffSemester, setStaffSemester] = useState<number>(1);
  const [selectedDetail, setSelectedDetail] = useState<{ entry: RoutineEntry; slot: RoutineSlot } | null>(null);

  // Admin picker modal states
  const [classPeriodEdit, setClassPeriodEdit] = useState<{ day: string; slotId: number | null } | null>(null);
  const [newClassRoutineVisible, setNewClassRoutineVisible] = useState(false);
  const [examTableVisible, setExamTableVisible] = useState(false);

  const pagerRef = useRef<any>(null);

  const optionsQuery = useQuery({
    queryKey: ['routine-options'],
    queryFn: async () => {
      const res = await apiFetch('/api/routine/options');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return DEFAULT_ROUTINE_OPTIONS;
      return { ...DEFAULT_ROUTINE_OPTIONS, ...data } as RoutineOptionsCatalog;
    },
    enabled: isAdmin,
    staleTime: 10 * 60 * 1000,
  });
  const routineOptions = optionsQuery.data || DEFAULT_ROUTINE_OPTIONS;
  const scrollX = useRef(new Animated.Value(defaultDayIndex * initialContentWidth)).current;
  const lastSyncedIndexRef = useRef<number>(defaultDayIndex);

  const classQuery = useQuery({
    queryKey: ['class-routine', isStaff ? staffSemester : 'self'],
    queryFn: async () => {
      const endpoint = isStaff ? `/api/routine/class?semester=${staffSemester}` : '/api/routine/class';
      const res = await apiFetch(endpoint);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || data?.message || 'Unable to load class routine.');
      }
      return data as { routine: ClassRoutineData | null; semester?: number; message?: string };
    },
    enabled: mode === 'class',
  });

  const examQuery = useQuery({
    queryKey: ['exam-routine', isStaff ? staffSemester : 'self'],
    queryFn: async () => {
      const endpoint = isStaff ? `/api/routine?semester=${staffSemester}` : '/api/routine';
      const res = await apiFetch(endpoint);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Unable to load exam routine.');
      }
      return (Array.isArray(data) ? data : []) as ExamRow[];
    },
    enabled: mode === 'exam',
  });

  const routine = classQuery.data?.routine || null;

  const liveClass = useMemo(() => {
    if (!routine || !(WORKING_DAYS as readonly string[]).includes(today)) return null;
    const nowMins = getCurrentKathmanduMinutes();
    const todayEntries = routine.entries.filter((e) => e.day_of_week === today);

    for (const slot of routine.slots) {
      const start = parseMinutes(slot.start_time);
      const end = parseMinutes(slot.end_time);
      if (start === null || end === null) continue;
      const entry = todayEntries.find((e) => Number(e.slot_id) === Number(slot.id));
      if (!entry || entry.is_empty) continue;
      if (nowMins >= start && nowMins < end) {
        return { state: 'In Progress' as const, slot, entry };
      }
      if (nowMins < start) {
        return { state: 'Up Next' as const, slot, entry };
      }
    }
    return null;
  }, [routine, today]);

  const entriesByDay = useMemo(() => {
    const result: Record<string, Array<{ slot: RoutineSlot; entry: RoutineEntry | null }>> = {};
    if (!routine) return result;
    for (const day of WORKING_DAYS) {
      const map = new Map<number, RoutineEntry>();
      routine.entries
        .filter((e) => e.day_of_week === day)
        .forEach((e) => map.set(Number(e.slot_id), e));
      result[day] = routine.slots.map((slot) => ({
        slot,
        entry: map.get(Number(slot.id)) || null,
      }));
    }
    return result;
  }, [routine]);

  const syncPagerPosition = useCallback(
    (index: number, width: number, animated: boolean) => {
      const offset = index * width;
      pagerRef.current?.scrollTo?.({ x: offset, y: 0, animated });
      if (!animated) {
        scrollX.setValue(offset);
      }
    },
    [scrollX]
  );

  useEffect(() => {
    if (mode !== 'class' || !routine || pagerWidth <= 1) return;
    const id = requestAnimationFrame(() => {
      syncPagerPosition(lastSyncedIndexRef.current, pagerWidth, false);
    });
    return () => cancelAnimationFrame(id);
  }, [mode, routine, pagerWidth, syncPagerPosition]);

  const handleSelectDay = useCallback(
    (index: number) => {
      lastSyncedIndexRef.current = index;
      setSelectedDayIndex(index);
      syncPagerPosition(index, pagerWidth, true);
    },
    [pagerWidth, syncPagerPosition]
  );

  const handlePagerScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (pagerWidth <= 1) return;
      const offsetX = event.nativeEvent.contentOffset.x;
      const nextIndex = Math.max(
        0,
        Math.min(WORKING_DAYS.length - 1, Math.round(offsetX / pagerWidth))
      );
      if (nextIndex !== lastSyncedIndexRef.current) {
        lastSyncedIndexRef.current = nextIndex;
        setSelectedDayIndex(nextIndex);
      }
    },
    [pagerWidth]
  );

  const onPagerScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        listener: handlePagerScroll,
      }),
    [scrollX, handlePagerScroll]
  );

  const handlePagerLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 1 && nextWidth !== pagerWidth) {
      setPagerWidth(nextWidth);
    }
  }, [pagerWidth]);

  const handlePillsLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 1 && nextWidth !== pillsWidth) {
      setPillsWidth(nextWidth);
    }
  }, [pillsWidth]);

  const pillTabWidth = Math.max(0, (pillsWidth - 8) / WORKING_DAYS.length);
  const pillTranslateX = useMemo(
    () =>
      scrollX.interpolate({
        inputRange: [0, Math.max(1, pagerWidth * (WORKING_DAYS.length - 1))],
        outputRange: [0, pillTabWidth * (WORKING_DAYS.length - 1)],
        extrapolate: 'clamp',
      }),
    [scrollX, pagerWidth, pillTabWidth]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={[styles.container, { padding: spacing.md }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={mode === 'class' ? classQuery.isRefetching : examQuery.isRefetching}
            onRefresh={() => void (mode === 'class' ? classQuery.refetch() : examQuery.refetch())}
            tintColor={colors.text}
          />
        }
      >
        {/* Mode Toggle */}
        <View style={[styles.modeBar, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radii.md }]}>
          {(['class', 'exam'] as const).map((m) => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                style={[
                  styles.modeBtn,
                  {
                    backgroundColor: active ? colors.text : 'transparent',
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text
                  variant="sm"
                  weight="700"
                  style={{ color: active ? colors.background : colors.textSecondary }}
                >
                  {m === 'class' ? 'Class Routine' : 'Exam Schedule'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Staff-only Semester Selector */}
        {isStaff && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, marginBottom: spacing.sm }}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
              const active = staffSemester === sem;
              return (
                <TouchableOpacity
                  key={sem}
                  onPress={() => setStaffSemester(sem)}
                  style={[
                    styles.semChip,
                    {
                      backgroundColor: active ? colors.text : colors.surface,
                      borderColor: colors.border,
                      borderRadius: radii.full,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{ color: active ? colors.background : colors.text }}
                  >
                    Sem {ROMANS[sem - 1]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Admin Quick Action Bar (Class & Exam Add/Edit) */}
        {isAdmin && (
          <View style={styles.adminActionBar}>
            {mode === 'class' ? (
              <>
                {routine ? (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setClassPeriodEdit({ day: WORKING_DAYS[selectedDayIndex] || 'Monday', slotId: null })}
                    style={[styles.adminActionPrimary, { backgroundColor: colors.text, borderRadius: radii.md }]}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.background} />
                    <Text variant="xs" weight="700" style={{ color: colors.background, marginLeft: 6 }}>
                      Add / Edit Class
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setNewClassRoutineVisible(true)}
                  style={[styles.adminActionSecondary, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md }]}
                >
                  <Ionicons name="add-circle-outline" size={16} color={colors.text} />
                  <Text variant="xs" weight="700" style={{ color: colors.text, marginLeft: 6 }}>
                    New Routine
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setExamTableVisible(true)}
                style={[styles.adminActionPrimary, { backgroundColor: colors.text, borderRadius: radii.md }]}
              >
                <Ionicons name="create-outline" size={16} color={colors.background} />
                <Text variant="xs" weight="700" style={{ color: colors.background, marginLeft: 6 }}>
                  Edit Exam Schedule
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {mode === 'class' ? (
          classQuery.isLoading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={colors.text} />
              <Caption color="muted" style={{ marginTop: 12 }}>
                Loading class routine...
              </Caption>
            </View>
          ) : classQuery.isError ? (
            <Card variant="outlined" padding="lg" style={{ borderColor: colors.border }}>
              <Subheading>Unable to load routine</Subheading>
              <Caption color="muted" style={{ marginTop: 4 }}>
                {(classQuery.error as Error)?.message}
              </Caption>
            </Card>
          ) : !routine ? (
            <Card variant="outlined" padding="lg" style={{ borderColor: colors.border }}>
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <Ionicons name="calendar-outline" size={34} color={colors.textSecondary} />
                <Subheading style={{ marginTop: 12, textAlign: 'center' }}>
                  No Published Routine
                </Subheading>
                <Caption color="muted" style={{ marginTop: 6, textAlign: 'center' }}>
                  {classQuery.data?.message || 'No class routine has been published for your semester yet.'}
                </Caption>
              </View>
            </Card>
          ) : (
            <>
              {/* Current / Upcoming Class Highlight */}
              {liveClass && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  disabled={liveClass.entry.class_type === 'Break'}
                  onPress={() => setSelectedDetail({ entry: liveClass.entry, slot: liveClass.slot })}
                  style={[
                    styles.liveCard,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.text,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View
                      style={[
                        styles.typeBadge,
                        { backgroundColor: colors.text, borderColor: colors.text },
                      ]}
                    >
                      <Text variant="xs" weight="800" style={{ color: colors.background }}>
                        {liveClass.state.toUpperCase()}
                      </Text>
                    </View>
                    <Caption color="muted">{liveClass.slot.label}</Caption>
                  </View>
                  <Text variant="md" weight="700" style={{ marginTop: 8 }}>
                    {liveClass.entry.class_type === 'Break' ? 'Break Period' : liveClass.entry.subject_name}
                  </Text>
                  {liveClass.entry.faculty_name ? (
                    <Caption color="muted" style={{ marginTop: 2 }}>
                      {liveClass.entry.faculty_name}
                    </Caption>
                  ) : null}
                </TouchableOpacity>
              )}

              {/* Weekday Selector Bar with Synchronized Sliding Indicator */}
              <View
                onLayout={handlePillsLayout}
                style={[
                  styles.dayPillsBar,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                  },
                ]}
              >
                {pillTabWidth > 0 && (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.dayPillIndicator,
                      {
                        width: pillTabWidth,
                        backgroundColor: colors.text,
                        borderRadius: radii.sm,
                        transform: [{ translateX: pillTranslateX }],
                      },
                    ]}
                  />
                )}
                {WORKING_DAYS.map((day, index) => {
                  const active = selectedDayIndex === index;
                  return (
                    <TouchableOpacity
                      key={day}
                      activeOpacity={0.75}
                      onPress={() => handleSelectDay(index)}
                      style={styles.dayPill}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: active ? colors.background : colors.text }}
                      >
                        {day.slice(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Horizontal Swipeable Day-wise Schedule Pager */}
              <View onLayout={handlePagerLayout} style={styles.pagerWrap}>
                <Animated.ScrollView
                  ref={pagerRef as any}
                  horizontal
                  pagingEnabled
                  directionalLockEnabled
                  nestedScrollEnabled
                  bounces={false}
                  decelerationRate="fast"
                  showsHorizontalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onScroll={onPagerScroll}
                  onMomentumScrollEnd={handlePagerScroll}
                  contentOffset={{ x: defaultDayIndex * pagerWidth, y: 0 }}
                >
                  {WORKING_DAYS.map((day, dayIdx) => {
                    const slotsForDay = entriesByDay[day] || [];
                    const inputRange = [
                      (dayIdx - 1) * pagerWidth,
                      dayIdx * pagerWidth,
                      (dayIdx + 1) * pagerWidth,
                    ];
                    const pageOpacity = scrollX.interpolate({
                      inputRange,
                      outputRange: [0.55, 1, 0.55],
                      extrapolate: 'clamp',
                    });
                    const pageScale = scrollX.interpolate({
                      inputRange,
                      outputRange: [0.985, 1, 0.985],
                      extrapolate: 'clamp',
                    });

                    return (
                      <Animated.View
                        key={day}
                        style={[
                          styles.dayPage,
                          {
                            width: pagerWidth,
                            opacity: pageOpacity,
                            transform: [{ scale: pageScale }],
                          },
                        ]}
                      >
                        {slotsForDay.map(({ slot, entry }) => {
                          const isBreak = slot.is_break || entry?.class_type === 'Break';
                          const isEmpty = !isBreak && (!entry || entry.is_empty || entry.class_type === 'Empty');
                          const cType = entry?.class_type || 'Theory';
                          const isPracticalOrLab = cType === 'Lab' || cType === 'Practical';
                          const canTapCard = (!isBreak && !isEmpty) || (!isBreak && isAdmin);

                          return (
                            <TouchableOpacity
                              key={slot.id}
                              activeOpacity={canTapCard ? 0.75 : 1}
                              disabled={!canTapCard}
                              onPress={() => {
                                if (isAdmin) {
                                  setClassPeriodEdit({ day, slotId: slot.id });
                                } else if (entry) {
                                  setSelectedDetail({ entry, slot });
                                }
                              }}
                              style={[
                                styles.periodCard,
                                {
                                  backgroundColor: isBreak || isEmpty ? colors.surfaceRaised : colors.surface,
                                  borderColor: colors.border,
                                  borderRadius: radii.md,
                                },
                              ]}
                            >
                              <View style={styles.timeCol}>
                                <Text variant="xs" weight="700">
                                  {formatSlotNptLabel(slot)}
                                </Text>
                                <Caption color="muted" style={{ marginTop: 2 }}>
                                  {isBreak ? 'Break' : `${slot.duration_minutes} min`}
                                </Caption>
                              </View>

                              <View style={{ flex: 1, paddingHorizontal: 10 }}>
                                {isBreak ? (
                                  <>
                                    <Text variant="sm" weight="700">Break Period</Text>
                                    <Caption color="muted">Scheduled break</Caption>
                                  </>
                                ) : isEmpty ? (
                                  <>
                                    <Text variant="sm" weight="600" color="secondary">
                                      {isAdmin ? '+ Assign Class' : 'Free Period'}
                                    </Text>
                                    <Caption color="muted">
                                      {isAdmin ? 'Tap to pick subject & teacher' : 'No class scheduled'}
                                    </Caption>
                                  </>
                                ) : (
                                  <>
                                    <Text variant="sm" weight="700">
                                      {entry?.subject_name}
                                    </Text>
                                    {entry?.faculty_name ? (
                                      <Caption color="muted" style={{ marginTop: 2 }}>
                                        {entry.faculty_name}
                                      </Caption>
                                    ) : null}
                                  </>
                                )}
                              </View>

                              {!isBreak && !isEmpty && isPracticalOrLab && (
                                <View
                                  style={[
                                    styles.typeBadge,
                                    {
                                      backgroundColor: colors.text,
                                      borderColor: colors.text,
                                    },
                                  ]}
                                >
                                  <Text
                                    variant="xs"
                                    weight="700"
                                    style={{ color: colors.background }}
                                  >
                                    {cType}
                                  </Text>
                                </View>
                              )}
                            </TouchableOpacity>
                          );
                        })}
                      </Animated.View>
                    );
                  })}
                </Animated.ScrollView>
              </View>
            </>
          )
        ) : examQuery.isLoading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.text} />
            <Caption color="muted" style={{ marginTop: 12 }}>Loading exam schedule...</Caption>
          </View>
        ) : !examQuery.data || examQuery.data.length === 0 ? (
          <Card variant="outlined" padding="lg" style={{ borderColor: colors.border }}>
            <Caption color="muted" style={{ textAlign: 'center' }}>
              No exams have been published for this semester yet.
            </Caption>
          </Card>
        ) : (
          <View style={{ gap: 10 }}>
            {examQuery.data.map((row) => (
              <TouchableOpacity
                key={row.id}
                activeOpacity={isAdmin ? 0.78 : 1}
                disabled={!isAdmin}
                onPress={() => isAdmin && setExamTableVisible(true)}
              >
                <Card
                  variant="outlined"
                  padding="md"
                  style={{ borderColor: colors.border, borderRadius: radii.md }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Caption color="muted">
                      Sem {ROMANS[row.semester - 1]}
                      {row.subject_code ? ` · ${row.subject_code}` : ''}
                    </Caption>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Caption color="muted">
                        {formatBsDateFriendly(row.exam_date, row.calendar)}
                      </Caption>
                      {isAdmin && (
                        <Ionicons name="create-outline" size={15} color={colors.textSecondary} />
                      )}
                    </View>
                  </View>
                  <Text variant="md" weight="700" style={{ marginTop: 4 }}>
                    {row.subject_name}
                  </Text>
                  <Caption color="muted" style={{ marginTop: 4 }}>
                    {[row.exam_time, row.weekday, row.room ? `Room ${row.room}` : null, row.exam_type]
                      .filter(Boolean)
                      .join(' · ') || 'Details to be announced'}
                  </Caption>
                </Card>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Subject Detail Modal */}
      <Modal
        visible={Boolean(selectedDetail)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDetail(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setSelectedDetail(null)}
          style={styles.modalBackdrop}
        >
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Caption color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {selectedDetail?.entry.class_type || 'Theory'}
                </Caption>
                <Heading level={3} style={{ marginTop: 2 }}>
                  {selectedDetail?.entry.subject_name}
                </Heading>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedDetail(null)}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={[styles.modalRows, { borderTopColor: colors.border }]}>
              <View style={styles.modalRow}>
                <Caption color="muted">Faculty</Caption>
                <Text variant="sm" weight="600">
                  {selectedDetail?.entry.faculty_name || 'Not assigned'}
                </Text>
              </View>
              <View style={styles.modalRow}>
                <Caption color="muted">Faculty Type</Caption>
                <Text variant="sm" weight="600">
                  {selectedDetail?.entry.faculty_type
                    ? FACULTY_TYPE_LABELS[selectedDetail.entry.faculty_type] || selectedDetail.entry.faculty_type
                    : '—'}
                </Text>
              </View>
              <View style={styles.modalRow}>
                <Caption color="muted">Day</Caption>
                <Text variant="sm" weight="600">{selectedDetail?.entry.day_of_week}</Text>
              </View>
              <View style={styles.modalRow}>
                <Caption color="muted">Time</Caption>
                <Text variant="sm" weight="600">
                  {selectedDetail ? `${selectedDetail.slot.label} (${selectedDetail.slot.duration_minutes} min)` : '—'}
                </Text>
              </View>
              <View style={styles.modalRow}>
                <Caption color="muted">Classification</Caption>
                <Text variant="sm" weight="600">{selectedDetail?.entry.class_type || 'Theory'}</Text>
              </View>
            </View>
            {isAdmin && selectedDetail && (
              <TouchableOpacity
                onPress={() => {
                  const { entry, slot } = selectedDetail;
                  setSelectedDetail(null);
                  setClassPeriodEdit({ day: entry.day_of_week, slotId: slot.id });
                }}
                style={[styles.adminActionPrimary, { backgroundColor: colors.text, borderRadius: radii.md, marginTop: 16 }]}
              >
                <Ionicons name="create-outline" size={16} color={colors.background} />
                <Text variant="xs" weight="700" style={{ color: colors.background, marginLeft: 6 }}>
                  Edit This Period
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Admin Picker Modals (Class Period, New Class Routine, Exam Schedule) */}
      {isAdmin && (
        <>
          <AdminClassPeriodModal
            visible={Boolean(classPeriodEdit)}
            routine={routine}
            initialDay={classPeriodEdit?.day || WORKING_DAYS[selectedDayIndex] || 'Monday'}
            initialSlotId={classPeriodEdit?.slotId ?? null}
            options={routineOptions}
            onClose={() => setClassPeriodEdit(null)}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['class-routine'] });
            }}
          />
          <AdminNewClassRoutineModal
            visible={newClassRoutineVisible}
            initialSemester={staffSemester}
            options={routineOptions}
            onClose={() => setNewClassRoutineVisible(false)}
            onCreated={(createdSem) => {
              setStaffSemester(createdSem);
              void queryClient.invalidateQueries({ queryKey: ['class-routine'] });
            }}
          />
          <AdminExamTableModal
            visible={examTableVisible}
            initialSemester={staffSemester}
            existingExams={examQuery.data || []}
            options={routineOptions}
            onClose={() => setExamTableVisible(false)}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['exam-routine'] });
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  modeBar: {
    flexDirection: 'row',
    padding: 4,
    borderWidth: 1,
    marginBottom: 14,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  semChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
  },
  adminActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  adminActionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  adminActionSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
  },
  centerBox: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  liveCard: {
    padding: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  dayPillsBar: {
    position: 'relative',
    flexDirection: 'row',
    padding: 4,
    borderWidth: 1,
    marginBottom: 14,
  },
  dayPillIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
  },
  dayPill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  pagerWrap: {
    width: '100%',
  },
  dayPage: {
    gap: 10,
  },
  periodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
  },
  timeCol: {
    width: 84,
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    gap: 10,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
