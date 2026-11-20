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
  BS_MONTHS,
  DEFAULT_ROUTINE_OPTIONS,
  formatSlotNptLabel,
  getBsWeekday,
  type RoutineOptionsCatalog,
} from '@/constants/nepaliCalendar';
import {
  AdminClassPeriodModal,
  AdminExamTableModal,
  AdminNewClassRoutineModal,
} from '@/components/routine/AdminRoutineEditorModals';
import { TeacherClassRoutineView } from '@/components/routine/TeacherClassRoutineView';
import { formatBsDate } from '@/utils/nepaliDate';

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const MODES = ['class', 'exam'] as const;
const EXAM_INSTRUCTIONS = [
  'Students are not allowed to enter the exam hall without college uniform.',
  'Students are not allowed to sit in the examination if he/she comes after half an hour of the commencement of the examination.',
  'Students absent from an examination without prior approval will be marked ABSENT and receive no marks; absences due to valid reasons must be reported in writing with supporting documents to the program coordinator within the stipulated time.',
  'Mobile and digital communication devices are strictly prohibited inside the exam hall.',
  'Students must follow the examination schedule published by the university.',
  'Students are required to appear for the examination according to their semester.',
  'Students should carry their required examination materials and identification.',
  'Students must follow all examination rules and instructions issued by the university.',
  'Any changes to the examination schedule will be communicated through official notices.',
];
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

interface RoutineEntryAbsence {
  id: number;
  scope: 'subject' | 'all';
  teacher_name?: string | null;
  start_date: string;
  end_date: string;
  days_count: number;
  note?: string | null;
}

interface RoutineEntryMessage {
  id: number;
  teacher_name?: string | null;
  message: string;
  target_date: string;
  created_at?: string;
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
  is_cancelled?: boolean;
  absence?: RoutineEntryAbsence | null;
  teacher_message?: RoutineEntryMessage | null;
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
  const isTeacher = !isAdmin && user?.role === 'teacher';
  const isStaff = isAdmin || isTeacher;

  const today = getTodayWeekday();
  const defaultDay = (WORKING_DAYS as readonly string[]).includes(today) ? today : 'Monday';
  const defaultDayIndex = Math.max(0, (WORKING_DAYS as readonly string[]).indexOf(defaultDay));
  const initialContentWidth = Math.max(1, windowWidth - spacing.md * 2);

  const [mode, setMode] = useState<'class' | 'exam'>('class');
  const [modeBarWidth, setModeBarWidth] = useState<number>(initialContentWidth);
  const [modePagerWidth, setModePagerWidth] = useState<number>(Math.max(1, windowWidth));

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(defaultDayIndex);
  const [pagerWidth, setPagerWidth] = useState<number>(initialContentWidth);
  const [pillsWidth, setPillsWidth] = useState<number>(initialContentWidth);
  const [staffSemester, setStaffSemester] = useState<number>(1);
  const [selectedDetail, setSelectedDetail] = useState<{ entry: RoutineEntry; slot: RoutineSlot } | null>(null);
  const [messagePopup, setMessagePopup] = useState<{
    subjectName: string;
    teacherName: string;
    day: string;
    timeLabel: string;
    message: string;
  } | null>(null);

  // Admin picker modal states
  const [classPeriodEdit, setClassPeriodEdit] = useState<{ day: string; slotId: number | null } | null>(null);
  const [newClassRoutineVisible, setNewClassRoutineVisible] = useState(false);
  const [examTableVisible, setExamTableVisible] = useState(false);

  const modePagerRef = useRef<any>(null);
  const modeScrollX = useRef(new Animated.Value(0)).current;
  const lastSyncedModeIndexRef = useRef<number>(0);

  const pagerRef = useRef<any>(null);
  const scrollX = useRef(new Animated.Value(defaultDayIndex * initialContentWidth)).current;
  const lastSyncedIndexRef = useRef<number>(defaultDayIndex);

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

  // Keep both queries warm simultaneously so sliding between Class & Exam is instant with zero spinner flash
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
    enabled: !isTeacher,
    staleTime: 60 * 1000,
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
    staleTime: 5 * 60 * 1000,
  });

  const routine = classQuery.data?.routine || null;

  const [currentMins, setCurrentMins] = useState(() => getCurrentKathmanduMinutes());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentMins(getCurrentKathmanduMinutes());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

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

  // Outer Mode Pager (Class Routine <-> Exam Schedule)
  const syncModePagerPosition = useCallback(
    (index: number, width: number, animated: boolean) => {
      const offset = index * width;
      modePagerRef.current?.scrollTo?.({ x: offset, y: 0, animated });
      if (!animated) {
        modeScrollX.setValue(offset);
      }
    },
    [modeScrollX]
  );

  const handleSelectMode = useCallback(
    (nextMode: 'class' | 'exam') => {
      const index = nextMode === 'class' ? 0 : 1;
      lastSyncedModeIndexRef.current = index;
      setMode(nextMode);
      syncModePagerPosition(index, modePagerWidth, true);
    },
    [modePagerWidth, syncModePagerPosition]
  );

  const handleModePagerScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (modePagerWidth <= 1) return;
      const offsetX = event.nativeEvent.contentOffset.x;
      const nextIndex = offsetX >= modePagerWidth * 0.5 ? 1 : 0;
      if (nextIndex !== lastSyncedModeIndexRef.current) {
        lastSyncedModeIndexRef.current = nextIndex;
        setMode(nextIndex === 0 ? 'class' : 'exam');
      }
    },
    [modePagerWidth]
  );

  const onModePagerScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: modeScrollX } } }], {
        useNativeDriver: true,
        listener: handleModePagerScroll,
      }),
    [modeScrollX, handleModePagerScroll]
  );

  const handleModeBarLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width);
      if (nextWidth > 1 && nextWidth !== modeBarWidth) {
        setModeBarWidth(nextWidth);
      }
    },
    [modeBarWidth]
  );

  const handleModePagerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width);
      if (nextWidth > 1 && nextWidth !== modePagerWidth) {
        setModePagerWidth(nextWidth);
        requestAnimationFrame(() => {
          syncModePagerPosition(lastSyncedModeIndexRef.current, nextWidth, false);
        });
      }
    },
    [modePagerWidth, syncModePagerPosition]
  );

  const modeTabWidth = Math.max(0, (modeBarWidth - 8) / 2);
  const modeIndicatorTranslateX = useMemo(
    () =>
      modeScrollX.interpolate({
        inputRange: [0, Math.max(1, modePagerWidth)],
        outputRange: [0, modeTabWidth],
        extrapolate: 'clamp',
      }),
    [modeScrollX, modePagerWidth, modeTabWidth]
  );

  const classPageOpacity = useMemo(
    () =>
      modeScrollX.interpolate({
        inputRange: [0, Math.max(1, modePagerWidth)],
        outputRange: [1, 0.65],
        extrapolate: 'clamp',
      }),
    [modeScrollX, modePagerWidth]
  );

  const classPageScale = useMemo(
    () =>
      modeScrollX.interpolate({
        inputRange: [0, Math.max(1, modePagerWidth)],
        outputRange: [1, 0.985],
        extrapolate: 'clamp',
      }),
    [modeScrollX, modePagerWidth]
  );

  const examPageOpacity = useMemo(
    () =>
      modeScrollX.interpolate({
        inputRange: [0, Math.max(1, modePagerWidth)],
        outputRange: [0.65, 1],
        extrapolate: 'clamp',
      }),
    [modeScrollX, modePagerWidth]
  );

  const examPageScale = useMemo(
    () =>
      modeScrollX.interpolate({
        inputRange: [0, Math.max(1, modePagerWidth)],
        outputRange: [0.985, 1],
        extrapolate: 'clamp',
      }),
    [modeScrollX, modePagerWidth]
  );

  // Inner Day Pager (Mon..Fri)
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
    if (!routine || pagerWidth <= 1) return;
    const id = requestAnimationFrame(() => {
      syncPagerPosition(lastSyncedIndexRef.current, pagerWidth, false);
    });
    return () => cancelAnimationFrame(id);
  }, [routine, pagerWidth, syncPagerPosition]);

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

  const handlePagerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width);
      if (nextWidth > 1 && nextWidth !== pagerWidth) {
        setPagerWidth(nextWidth);
      }
    },
    [pagerWidth]
  );

  const handlePillsLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = Math.round(event.nativeEvent.layout.width);
      if (nextWidth > 1 && nextWidth !== pillsWidth) {
        setPillsWidth(nextWidth);
      }
    },
    [pillsWidth]
  );

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

  const examNoticeText = useMemo(() => {
    const rows = examQuery.data || [];
    if (!rows.length) return '';
    const typeCounts = new Map<string, number>();
    for (const r of rows) {
      const cleaned = String(r.exam_type || '')
        .replace(/\s*examination$/i, '')
        .trim();
      if (cleaned) typeCounts.set(cleaned, (typeCounts.get(cleaned) || 0) + 1);
    }
    let typeLabel = '';
    let maxCount = 0;
    for (const [label, count] of typeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        typeLabel = label;
      }
    }
    const sems = Array.from(
      new Set(rows.map((r) => Number(r.semester)).filter((n) => n >= 1 && n <= 8))
    ).sort((a, b) => a - b);
    const semLabel =
      sems.length === 1
        ? `Semester ${ROMANS[sems[0] - 1]}`
        : sems.length > 1
          ? `Semesters ${sems.map((n) => ROMANS[n - 1]).join(', ')}`
          : `Semester ${ROMANS[staffSemester - 1]}`;
    return `It is to be informed to all the students, faculties and staffs that the ${typeLabel ? `${typeLabel} ` : ''}examination of BIT program ${semLabel} will be conducted as per the following schedule. So, all the concerned are informed to be prepared accordingly.`;
  }, [examQuery.data, staffSemester]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Fixed Top Controls: Animated Sliding Mode Toggle + Staff Semester Selector */}
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <View
          onLayout={handleModeBarLayout}
          style={[
            styles.modeBar,
            {
              backgroundColor: colors.surfaceRaised,
              borderColor: colors.border,
              borderRadius: radii.md,
            },
          ]}
        >
          {modeTabWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.modeIndicator,
                {
                  width: modeTabWidth,
                  backgroundColor: colors.text,
                  borderRadius: radii.sm,
                  transform: [{ translateX: modeIndicatorTranslateX }],
                },
              ]}
            />
          )}
          {MODES.map((m) => {
            const active = mode === m;
            return (
              <TouchableOpacity
                key={m}
                activeOpacity={0.75}
                onPress={() => handleSelectMode(m)}
                style={styles.modeBtn}
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

        {(isAdmin || (isTeacher && mode === 'exam')) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.semScroll}
            contentContainerStyle={styles.semScrollContent}
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
      </View>

      {/* Gesture-Driven Swipeable 2-Page Container (Class Routine <-> Exam Schedule) */}
      <View style={{ flex: 1 }} onLayout={handleModePagerLayout}>
        <Animated.ScrollView
          ref={modePagerRef as any}
          horizontal
          pagingEnabled
          directionalLockEnabled
          bounces={false}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onModePagerScroll}
          onMomentumScrollEnd={handleModePagerScroll}
          style={{ flex: 1 }}
        >
          {/* PAGE 0: CLASS ROUTINE */}
          <Animated.View
            style={{
              width: modePagerWidth,
              flex: 1,
              opacity: classPageOpacity,
              transform: [{ scale: classPageScale }],
            }}
          >
            {isTeacher ? (
              <TeacherClassRoutineView
                initialContentWidth={initialContentWidth}
                defaultDayIndex={defaultDayIndex}
              />
            ) : (
            <ScrollView
              contentContainerStyle={[styles.pageScrollContent, { paddingHorizontal: spacing.md }]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={classQuery.isRefetching}
                  onRefresh={() => void classQuery.refetch()}
                  tintColor={colors.text}
                />
              }
            >
              {isAdmin && (
                <View style={styles.adminActionBar}>
                  {routine ? (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() =>
                        setClassPeriodEdit({
                          day: WORKING_DAYS[selectedDayIndex] || 'Monday',
                          slotId: null,
                        })
                      }
                      style={[
                        styles.adminActionPrimary,
                        { backgroundColor: colors.text, borderRadius: radii.md },
                      ]}
                    >
                      <Ionicons name="create-outline" size={16} color={colors.background} />
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: colors.background, marginLeft: 6 }}
                      >
                        Add / Edit Class
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setNewClassRoutineVisible(true)}
                    style={[
                      styles.adminActionSecondary,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.text} />
                    <Text variant="xs" weight="700" style={{ color: colors.text, marginLeft: 6 }}>
                      New Routine
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {classQuery.isLoading ? (
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
                      {classQuery.data?.message ||
                        'No class routine has been published for your semester yet.'}
                    </Caption>
                  </View>
                </Card>
              ) : (
                <>
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
                              const isEmpty =
                                !isBreak &&
                                (!entry || entry.is_empty || entry.class_type === 'Empty');
                              const cType = entry?.class_type || 'Theory';
                              const isPracticalOrLab = cType === 'Lab' || cType === 'Practical';
                              const isCancelled = Boolean(!isBreak && !isEmpty && entry?.is_cancelled);
                              const canTapCard = (!isBreak && !isEmpty) || (!isBreak && isAdmin);

                              const startMins = parseMinutes(slot.start_time);
                              const endMins = parseMinutes(slot.end_time);
                              const isCurrent = Boolean(
                                day === today &&
                                  !isBreak &&
                                  !isEmpty &&
                                  !isCancelled &&
                                  entry &&
                                  startMins !== null &&
                                  endMins !== null &&
                                  currentMins >= startMins &&
                                  currentMins < endMins
                              );

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
                                      backgroundColor:
                                        isBreak || isEmpty ? colors.surfaceRaised : colors.surface,
                                      borderColor: colors.border,
                                      borderRadius: radii.md,
                                    },
                                    isCurrent && [
                                      styles.currentPeriodCard,
                                      {
                                        backgroundColor: colors.surface,
                                        borderColor: '#ffffff',
                                      },
                                    ],
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

                                  <View
                                    style={{
                                      flex: 1,
                                      paddingHorizontal: 10,
                                      paddingRight: isCurrent ? 78 : 10,
                                    }}
                                  >
                                    {isBreak ? (
                                      <>
                                        <Text variant="sm" weight="700">
                                          Break Period
                                        </Text>
                                        <Caption color="muted">Scheduled break</Caption>
                                      </>
                                    ) : isEmpty ? (
                                      <>
                                        <Text variant="sm" weight="600" color="secondary">
                                          {isAdmin ? '+ Assign Class' : 'Free Period'}
                                        </Text>
                                        <Caption color="muted">
                                          {isAdmin
                                            ? 'Tap to pick subject & teacher'
                                            : 'No class scheduled'}
                                        </Caption>
                                      </>
                                    ) : isCancelled ? (
                                      <>
                                        <Text variant="sm" weight="700" color="secondary">
                                          {entry?.subject_name}
                                        </Text>
                                        <Caption color="muted" style={{ marginTop: 2 }}>
                                          {entry?.absence?.teacher_name || entry?.faculty_name || 'Teacher'} absent
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

                                  {!isBreak && !isEmpty && entry?.teacher_message ? (
                                    <TouchableOpacity
                                      onPress={() =>
                                        setMessagePopup({
                                          subjectName: entry.subject_name || 'Class',
                                          teacherName:
                                            entry.teacher_message?.teacher_name ||
                                            entry.faculty_name ||
                                            'Teacher',
                                          day,
                                          timeLabel: formatSlotNptLabel(slot),
                                          message: entry.teacher_message!.message,
                                        })
                                      }
                                      style={[
                                        styles.infoMsgBtn,
                                        {
                                          backgroundColor: colors.surfaceSubtle,
                                          borderColor: colors.border,
                                          marginRight: isCancelled || isPracticalOrLab ? 8 : 0,
                                        },
                                      ]}
                                      accessibilityRole="button"
                                      accessibilityLabel={`View teacher message for ${entry.subject_name}`}
                                    >
                                      <Ionicons
                                        name="information-circle-outline"
                                        size={18}
                                        color={colors.text}
                                      />
                                    </TouchableOpacity>
                                  ) : null}

                                  {isCancelled && (
                                    <Text variant="xs" weight="800" style={{ color: '#f87171' }}>
                                      No Class
                                    </Text>
                                  )}

                                  {isCurrent && (
                                    <View style={styles.currentlyTopRight}>
                                      <View style={styles.currentlyDot} />
                                      <Text style={styles.currentlyText}>Currently</Text>
                                    </View>
                                  )}

                                  {!isBreak && !isEmpty && !isCancelled && isPracticalOrLab && (
                                    <View
                                      style={[
                                        styles.typeBadge,
                                        {
                                          backgroundColor: colors.text,
                                          borderColor: colors.text,
                                          marginTop: isCurrent ? 18 : 0,
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
              )}
            </ScrollView>
            )}
          </Animated.View>

          {/* PAGE 1: EXAM SCHEDULE */}
          <Animated.View
            style={{
              width: modePagerWidth,
              flex: 1,
              opacity: examPageOpacity,
              transform: [{ scale: examPageScale }],
            }}
          >
            <ScrollView
              contentContainerStyle={[styles.pageScrollContent, { paddingHorizontal: spacing.md }]}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={examQuery.isRefetching}
                  onRefresh={() => void examQuery.refetch()}
                  tintColor={colors.text}
                />
              }
            >
              {isAdmin && (
                <View style={styles.adminActionBar}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setExamTableVisible(true)}
                    style={[
                      styles.adminActionPrimary,
                      { backgroundColor: colors.text, borderRadius: radii.md },
                    ]}
                  >
                    <Ionicons name="create-outline" size={16} color={colors.background} />
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: colors.background, marginLeft: 6 }}
                    >
                      Edit Exam Schedule
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {examQuery.isLoading ? (
                <View style={styles.centerBox}>
                  <ActivityIndicator size="large" color={colors.text} />
                  <Caption color="muted" style={{ marginTop: 12 }}>
                    Loading exam schedule...
                  </Caption>
                </View>
              ) : !examQuery.data || examQuery.data.length === 0 ? (
                <Card variant="outlined" padding="lg" style={{ borderColor: colors.border }}>
                  <Caption color="muted" style={{ textAlign: 'center' }}>
                    No exams have been published for this semester yet.
                  </Caption>
                </Card>
              ) : (
                <View style={{ gap: 12 }}>
                  <Text
                    variant="xs"
                    style={[styles.examNoticeText, { color: colors.textSecondary }]}
                  >
                    {examNoticeText}
                  </Text>

                  {examQuery.data.map((row) => {
                    const parsed = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(
                      (row.exam_date || '').trim()
                    );
                    const bsYearNum = parsed ? Number(parsed[1]) : 0;
                    const bsMonthPad = parsed ? parsed[2].padStart(2, '0') : '';
                    const bsDayNum = parsed ? Number(parsed[3]) : 0;
                    const bsMonthName = bsMonthPad
                      ? BS_MONTHS.find((m) => m.value === bsMonthPad)?.name || bsMonthPad
                      : '';
                    const weekdayLabel =
                      row.weekday ||
                      (parsed && (row.calendar === 'BS' || !row.calendar)
                        ? getBsWeekday(bsYearNum, Number(bsMonthPad), bsDayNum)
                        : '') ||
                      row.calendar ||
                      'BS';

                    return (
                      <TouchableOpacity
                        key={row.id}
                        activeOpacity={isAdmin ? 0.78 : 1}
                        disabled={!isAdmin}
                        onPress={() => isAdmin && setExamTableVisible(true)}
                        style={[
                          styles.examCard,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                            borderRadius: radii.md,
                          },
                        ]}
                      >
                        <View style={styles.examCardTop}>
                          <View
                            style={[
                              styles.examDateTile,
                              {
                                backgroundColor: colors.surfaceRaised,
                                borderRadius: radii.sm,
                              },
                            ]}
                          >
                            <Text
                              variant="xs"
                              weight="700"
                              style={[styles.examDateMonth, { color: colors.textSecondary }]}
                              numberOfLines={1}
                            >
                              {(bsMonthName || 'DATE').toUpperCase()}
                            </Text>
                            <Text variant="lg" weight="800" style={styles.examDateDay}>
                              {parsed ? String(bsDayNum).padStart(2, '0') : '—'}
                            </Text>
                            <Text
                              variant="xs"
                              weight="700"
                              style={[styles.examDateWeekday, { color: colors.textSecondary }]}
                              numberOfLines={1}
                            >
                              {weekdayLabel.toUpperCase()}
                            </Text>
                          </View>

                          <View style={styles.examSubjectCol}>
                            <Text variant="md" weight="700" style={styles.examSubjectTitle}>
                              {row.subject_name}
                            </Text>
                            <View style={styles.examCardTimeRow}>
                              <Ionicons
                                name="time-outline"
                                size={13}
                                color={colors.textSecondary}
                              />
                              <Text
                                variant="xs"
                                weight="500"
                                style={{ color: colors.textSecondary, marginLeft: 5 }}
                              >
                                {row.exam_time || 'Time to be announced'}
                              </Text>
                            </View>
                          </View>

                          {isAdmin && (
                            <Ionicons
                              name="create-outline"
                              size={18}
                              color={colors.textSecondary}
                              style={{ marginLeft: 8 }}
                            />
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}

                  <View
                    style={[
                      styles.examInstructionsCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Caption color="muted" style={styles.examNoticeKicker}>
                      IMPORTANT
                    </Caption>
                    <Text variant="md" weight="700" style={{ marginBottom: 10 }}>
                      Instructions for Examinees
                    </Text>
                    <View style={{ gap: 8 }}>
                      {EXAM_INSTRUCTIONS.map((rule, idx) => (
                        <View key={idx} style={styles.instructionRow}>
                          <Text
                            variant="xs"
                            weight="700"
                            style={[styles.instructionNum, { color: colors.textSecondary }]}
                          >
                            {idx + 1}.
                          </Text>
                          <Text
                            variant="xs"
                            style={[styles.instructionText, { color: colors.textSecondary }]}
                          >
                            {rule}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>
          </Animated.View>
        </Animated.ScrollView>
      </View>

      {/* Teacher Class Message Popup Modal */}
      <Modal
        visible={Boolean(messagePopup)}
        transparent
        animationType="fade"
        onRequestClose={() => setMessagePopup(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setMessagePopup(null)}
          style={styles.modalBackdrop}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.lg,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Caption color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Class Message • {messagePopup?.day} ({messagePopup?.timeLabel})
                </Caption>
                <Heading level={3} style={{ marginTop: 2 }}>
                  {messagePopup?.subjectName}
                </Heading>
                <Caption color="muted" style={{ marginTop: 2 }}>
                  From {messagePopup?.teacherName}
                </Caption>
              </View>
              <TouchableOpacity
                onPress={() => setMessagePopup(null)}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={[styles.modalRows, { borderTopColor: colors.border }]}>
              <Text variant="md" style={{ color: colors.text, lineHeight: 22 }}>
                {messagePopup?.message}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

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
              {selectedDetail?.entry.is_cancelled ? (
                <View style={styles.modalRow}>
                  <Caption color="muted">Status</Caption>
                  <Text variant="sm" weight="700" style={{ color: '#f87171' }}>
                    No Class
                    {selectedDetail.entry.absence?.days_count &&
                    selectedDetail.entry.absence.days_count > 1
                      ? ` (${formatBsDate(selectedDetail.entry.absence.start_date)} – ${formatBsDate(
                          selectedDetail.entry.absence.end_date
                        )})`
                      : ''}
                  </Text>
                </View>
              ) : null}
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
                    ? FACULTY_TYPE_LABELS[selectedDetail.entry.faculty_type] ||
                      selectedDetail.entry.faculty_type
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
                  {selectedDetail
                    ? `${selectedDetail.slot.label} (${selectedDetail.slot.duration_minutes} min)`
                    : '—'}
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
                style={[
                  styles.adminActionPrimary,
                  { backgroundColor: colors.text, borderRadius: radii.md, marginTop: 16 },
                ]}
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
  pageScrollContent: {
    paddingBottom: 40,
  },
  modeBar: {
    position: 'relative',
    flexDirection: 'row',
    padding: 4,
    borderWidth: 1,
    marginBottom: 12,
  },
  modeIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    zIndex: 1,
  },
  semScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 12,
  },
  semScrollContent: {
    gap: 8,
    alignItems: 'center',
  },
  semChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    alignSelf: 'center',
  },
  examCard: {
    borderWidth: 1,
    padding: 12,
  },
  examCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  examDateTile: {
    minWidth: 66,
    paddingVertical: 8,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  examDateMonth: {
    fontSize: 10,
    letterSpacing: 0.5,
  },
  examDateDay: {
    fontSize: 22,
    lineHeight: 26,
    marginVertical: 1,
  },
  examDateWeekday: {
    fontSize: 9.5,
    letterSpacing: 0.4,
  },
  examSubjectCol: {
    flex: 1,
    justifyContent: 'center',
  },
  examSubjectTitle: {
    fontSize: 15.5,
    lineHeight: 20,
  },
  examCardTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  examNoticeKicker: {
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  examNoticeText: {
    lineHeight: 19,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  examInstructionsCard: {
    borderWidth: 1,
    padding: 16,
    marginTop: 4,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  instructionNum: {
    width: 20,
    lineHeight: 18,
  },
  instructionText: {
    flex: 1,
    lineHeight: 18,
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
  currentPeriodCard: {
    borderColor: '#ffffff',
    borderWidth: 1.5,
  },
  currentlyTopRight: {
    position: 'absolute',
    top: 10,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  currentlyDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#22c55e',
  },
  currentlyText: {
    color: '#22c55e',
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  timeCol: {
    width: 84,
  },
  infoMsgBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
