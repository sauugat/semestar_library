import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Animated,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Caption, Subheading } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/services/api';
import { formatSlotNptLabel } from '@/constants/nepaliCalendar';
import { formatBsDate } from '@/utils/nepaliDate';

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const QUICK_DAY_OPTIONS = [1, 2, 3, 5, 7];

export interface TeacherAbsenceRecord {
  id: number;
  teacher_id: string;
  teacher_name?: string | null;
  scope: 'subject' | 'all';
  routine_id?: number | null;
  entry_id?: number | null;
  semester?: number | null;
  subject_name?: string | null;
  day_of_week?: string | null;
  start_date: string;
  end_date: string;
  days_count: number;
  note?: string | null;
}

export interface TeacherClassMessage {
  id: number;
  teacher_name?: string | null;
  message: string;
  target_date: string;
  created_at?: string;
}

export interface TeacherClassEntry {
  entry_id: number;
  routine_id: number;
  semester: number;
  academic_session?: string;
  day_of_week: string;
  day_date: string;
  slot_id: number;
  slot_order: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  slot_label: string;
  subject_name: string;
  faculty_name?: string | null;
  class_type: string;
  is_absent: boolean;
  absence: TeacherAbsenceRecord | null;
  teacher_message?: TeacherClassMessage | null;
}

interface TeacherScheduleResponse {
  teacher: { id: string; name: string };
  todayDate: string;
  todayWeekday: string;
  weekDates: Record<string, string>;
  classes: TeacherClassEntry[];
  activeAbsences: TeacherAbsenceRecord[];
  absentMode: TeacherAbsenceRecord | null;
}

function addDaysIso(yyyyMmDd: string, delta: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyyMmDd)) return yyyyMmDd;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yr = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const da = String(dt.getUTCDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

interface AbsentModalTarget {
  scope: 'subject' | 'all';
  entry?: TeacherClassEntry;
  startDate: string;
}

export function TeacherClassRoutineView({
  initialContentWidth,
  defaultDayIndex,
}: {
  initialContentWidth: number;
  defaultDayIndex: number;
}) {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(defaultDayIndex);
  const [pagerWidth, setPagerWidth] = useState<number>(initialContentWidth);
  const [pillsWidth, setPillsWidth] = useState<number>(initialContentWidth);

  const [modalTarget, setModalTarget] = useState<AbsentModalTarget | null>(null);
  const [daysInput, setDaysInput] = useState<string>('1');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [markingEntryId, setMarkingEntryId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [messageTarget, setMessageTarget] = useState<TeacherClassEntry | null>(null);
  const [messageDraft, setMessageDraft] = useState<string>('');
  const [isSendingMessage, setIsSendingMessage] = useState<boolean>(false);

  const pagerRef = useRef<any>(null);
  const scrollX = useRef(new Animated.Value(defaultDayIndex * initialContentWidth)).current;
  const lastSyncedIndexRef = useRef<number>(defaultDayIndex);

  const scheduleQuery = useQuery<TeacherScheduleResponse>({
    queryKey: ['teacher-class-routine', user?.studentId],
    queryFn: async () => {
      const res = await apiFetch('/api/routine/teacher/schedule');
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error || 'Unable to load your teaching routine.');
      }
      return data as TeacherScheduleResponse;
    },
    staleTime: 60 * 1000,
  });

  const classesByDay = useMemo(() => {
    const grouped: Record<string, TeacherClassEntry[]> = {};
    for (const day of WORKING_DAYS) grouped[day] = [];
    for (const cls of scheduleQuery.data?.classes || []) {
      if (grouped[cls.day_of_week]) {
        grouped[cls.day_of_week].push(cls);
      }
    }
    return grouped;
  }, [scheduleQuery.data?.classes]);

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
    if (!scheduleQuery.data || pagerWidth <= 1) return;
    const id = requestAnimationFrame(() => {
      syncPagerPosition(lastSyncedIndexRef.current, pagerWidth, false);
    });
    return () => cancelAnimationFrame(id);
  }, [scheduleQuery.data, pagerWidth, syncPagerPosition]);

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

  const handleMarkSubjectAbsent = (cls: TeacherClassEntry) => {
    if (markingEntryId !== null) return;
    const startDate = cls.day_date || scheduleQuery.data?.todayDate || '';
    Alert.alert(
      'Mark Class Absent?',
      `Mark ${cls.subject_name} (${cls.day_of_week}) as No Class and notify students?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Absent',
          style: 'destructive',
          onPress: async () => {
            setMarkingEntryId(cls.entry_id);
            try {
              const res = await apiFetch('/api/routine/teacher/absent', {
                method: 'POST',
                body: JSON.stringify({
                  scope: 'subject',
                  entry_id: cls.entry_id,
                  days: 1,
                  start_date: startDate,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                throw new Error(data?.error || 'Could not mark class absent.');
              }
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['teacher-class-routine'] }),
                queryClient.invalidateQueries({ queryKey: ['class-routine'] }),
              ]);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to mark absent. Please try again.');
            } finally {
              setMarkingEntryId(null);
            }
          },
        },
      ]
    );
  };

  const openAbsentModeModal = () => {
    const startDate = scheduleQuery.data?.todayDate || '';
    setDaysInput('1');
    setModalTarget({ scope: 'all', startDate });
  };

  const openMessageModal = (cls: TeacherClassEntry) => {
    setMessageDraft(cls.teacher_message?.message || '');
    setMessageTarget(cls);
  };

  const handleSendClassMessage = async () => {
    if (!messageTarget || isSendingMessage) return;
    const trimmed = messageDraft.trim();
    if (!trimmed) {
      Alert.alert('Message Required', 'Please write a message to send to students.');
      return;
    }
    setIsSendingMessage(true);
    try {
      const res = await apiFetch('/api/routine/teacher/message', {
        method: 'POST',
        body: JSON.stringify({
          entry_id: messageTarget.entry_id,
          target_date: messageTarget.day_date || scheduleQuery.data?.todayDate,
          message: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not send class message.');
      }
      setMessageTarget(null);
      setMessageDraft('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teacher-class-routine'] }),
        queryClient.invalidateQueries({ queryKey: ['class-routine'] }),
      ]);
      const count = Number(data?.notifiedStudentsCount || 0);
      Alert.alert(
        'Message Sent',
        `Class message posted for ${messageTarget.subject_name}.${
          count > 0 ? ` ${count} student${count === 1 ? '' : 's'} notified.` : ''
        }`
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send message. Please try again.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleClearClassMessage = async () => {
    const msgId = messageTarget?.teacher_message?.id;
    if (!msgId || isSendingMessage) return;
    setIsSendingMessage(true);
    try {
      const res = await apiFetch(`/api/routine/teacher/message/${msgId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not clear message.');
      setMessageTarget(null);
      setMessageDraft('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teacher-class-routine'] }),
        queryClient.invalidateQueries({ queryKey: ['class-routine'] }),
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to clear message.');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleConfirmAbsent = async () => {
    if (!modalTarget || isSubmitting) return;
    const parsedDays = parseInt(daysInput.trim(), 10);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 30) {
      Alert.alert('Invalid Days', 'Please enter a number of days between 1 and 30.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Record<string, any> = {
        scope: modalTarget.scope,
        days: parsedDays,
        start_date: modalTarget.startDate,
      };
      if (modalTarget.scope === 'subject' && modalTarget.entry) {
        payload.entry_id = modalTarget.entry.entry_id;
      }

      const res = await apiFetch('/api/routine/teacher/absent', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Could not save absence.');
      }

      setModalTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['teacher-class-routine'] }),
        queryClient.invalidateQueries({ queryKey: ['class-routine'] }),
      ]);

      const count = Number(data?.notifiedStudentsCount || 0);
      const subjectLabel =
        modalTarget.scope === 'all'
          ? 'all your subjects'
          : modalTarget.entry?.subject_name || 'this subject';
      Alert.alert(
        'Students Notified',
        `Marked absent for ${subjectLabel} (${parsedDays} day${parsedDays === 1 ? '' : 's'}).${
          count > 0 ? ` ${count} student${count === 1 ? '' : 's'} notified.` : ''
        }`
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to mark absent. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelAbsence = (absence: TeacherAbsenceRecord, label: string) => {
    if (cancellingId !== null) return;
    Alert.alert(
      'Cancel Absence?',
      `Restore ${label} on the student routine?`,
      [
        { text: 'Keep Absent', style: 'cancel' },
        {
          text: 'Restore Class',
          onPress: async () => {
            setCancellingId(absence.id);
            try {
              const res = await apiFetch(`/api/routine/teacher/absent/${absence.id}`, {
                method: 'DELETE',
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data?.error || 'Could not cancel absence.');
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['teacher-class-routine'] }),
                queryClient.invalidateQueries({ queryKey: ['class-routine'] }),
              ]);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to restore class.');
            } finally {
              setCancellingId(null);
            }
          },
        },
      ]
    );
  };

  const data = scheduleQuery.data;
  const absentMode = data?.absentMode || null;
  const parsedModalDays = Math.min(30, Math.max(1, parseInt(daysInput.trim(), 10) || 1));
  const modalPreviewEnd = modalTarget?.startDate
    ? addDaysIso(modalTarget.startDate, parsedModalDays - 1)
    : '';

  return (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, { paddingHorizontal: spacing.md }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={scheduleQuery.isRefetching}
          onRefresh={() => void scheduleQuery.refetch()}
          tintColor={colors.text}
        />
      }
    >
      {/* Absent Mode Control Card */}
      <View
        style={[
          styles.absentModeCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radii.md,
          },
        ]}
      >
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text
            variant="sm"
            weight="700"
            style={{ color: absentMode ? '#f87171' : colors.text }}
          >
            {absentMode ? 'Absent Mode Active' : 'Absent Mode'}
          </Text>
          <Caption color="muted" style={{ marginTop: 2 }}>
            {absentMode
              ? `${absentMode.days_count} day${absentMode.days_count === 1 ? '' : 's'} • ${formatBsDate(
                  absentMode.start_date
                )}${
                  absentMode.days_count > 1 ? ` – ${formatBsDate(absentMode.end_date)}` : ''
                }`
              : 'Mark all your subjects absent & notify students'}
          </Caption>
        </View>

        {absentMode ? (
          <TouchableOpacity
            disabled={cancellingId === absentMode.id}
            onPress={() => handleCancelAbsence(absentMode, 'all your classes')}
            style={[
              styles.absentModeBtn,
              {
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
                borderRadius: radii.sm,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Turn off Absent Mode"
          >
            {cancellingId === absentMode.id ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text variant="xs" weight="700" style={{ color: colors.text }}>
                Turn Off
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={openAbsentModeModal}
            style={[
              styles.absentModeBtn,
              {
                backgroundColor: colors.surfaceSubtle,
                borderColor: colors.border,
                borderRadius: radii.sm,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Turn on Absent Mode"
          >
            <Text variant="xs" weight="700" style={{ color: '#f87171' }}>
              Absent Mode
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {scheduleQuery.isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={colors.text} />
          <Caption color="muted" style={{ marginTop: 12 }}>
            Loading your teaching schedule...
          </Caption>
        </View>
      ) : scheduleQuery.isError ? (
        <Card variant="outlined" padding="lg" style={{ borderColor: colors.border }}>
          <Subheading>Unable to load schedule</Subheading>
          <Caption color="muted" style={{ marginTop: 4 }}>
            {(scheduleQuery.error as Error)?.message}
          </Caption>
        </Card>
      ) : !data || data.classes.length === 0 ? (
        <Card variant="outlined" padding="lg" style={{ borderColor: colors.border }}>
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <Ionicons name="calendar-outline" size={32} color={colors.textSecondary} />
            <Subheading style={{ marginTop: 10, textAlign: 'center' }}>
              No Scheduled Classes
            </Subheading>
            <Caption color="muted" style={{ marginTop: 4, textAlign: 'center' }}>
              None of the published routines currently list classes assigned to you.
            </Caption>
          </View>
        </Card>
      ) : (
        <>
          {/* Weekday Selector Bar */}
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

          {/* Swipeable Day Pager */}
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
              {WORKING_DAYS.map((day) => {
                const dayClasses = classesByDay[day] || [];
                const dayIso = data.weekDates?.[day];

                return (
                  <View key={day} style={[styles.dayPage, { width: pagerWidth }]}>
                    {dayIso ? (
                      <Caption color="muted" style={{ marginBottom: 2, paddingHorizontal: 2 }}>
                        {day} • {formatBsDate(dayIso)}
                      </Caption>
                    ) : null}

                    {dayClasses.length === 0 ? (
                      <View
                        style={[
                          styles.emptyDayCard,
                          {
                            backgroundColor: colors.surfaceRaised,
                            borderColor: colors.border,
                            borderRadius: radii.md,
                          },
                        ]}
                      >
                        <Caption color="muted">No classes scheduled for you on {day}.</Caption>
                      </View>
                    ) : (
                      dayClasses.map((cls) => {
                        const semRoman = ROMANS[cls.semester - 1] || String(cls.semester);
                        const isGlobalAbsent = cls.is_absent && cls.absence?.scope === 'all';
                        const isSubjectAbsent = cls.is_absent && cls.absence?.scope === 'subject';

                        return (
                          <View
                            key={`${cls.entry_id}-${cls.slot_id}`}
                            style={[
                              styles.periodCard,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                                borderRadius: radii.md,
                              },
                            ]}
                          >
                            <View style={styles.timeCol}>
                              <Text variant="xs" weight="700">
                                {formatSlotNptLabel({
                                  start_time: cls.start_time,
                                  end_time: cls.end_time,
                                  label: cls.slot_label,
                                })}
                              </Text>
                              <Caption color="muted" style={{ marginTop: 2 }}>
                                {cls.duration_minutes} min
                              </Caption>
                            </View>

                            <View style={{ flex: 1, paddingHorizontal: 10 }}>
                              <Text variant="sm" weight="700" numberOfLines={2}>
                                {cls.subject_name}
                              </Text>
                              <Caption color="muted" style={{ marginTop: 2 }}>
                                Sem {semRoman}
                                {cls.class_type ? ` • ${cls.class_type}` : ''}
                              </Caption>
                            </View>

                            <View style={styles.rowActionsCol}>
                              <TouchableOpacity
                                onPress={() => openMessageModal(cls)}
                                style={[
                                  styles.rowMsgBtn,
                                  {
                                    backgroundColor: colors.surfaceSubtle,
                                    borderColor: colors.border,
                                    borderRadius: radii.sm,
                                  },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={
                                  cls.teacher_message
                                    ? `Edit message for ${cls.subject_name}`
                                    : `Write message for ${cls.subject_name}`
                                }
                              >
                                <Ionicons
                                  name={
                                    cls.teacher_message
                                      ? 'information-circle'
                                      : 'chatbubble-ellipses-outline'
                                  }
                                  size={15}
                                  color={cls.teacher_message ? colors.text : colors.textSecondary}
                                />
                              </TouchableOpacity>

                              {isGlobalAbsent ? (
                                <View style={styles.statusCol}>
                                  <Text variant="xs" weight="700" style={{ color: '#f87171' }}>
                                    No Class
                                  </Text>
                                </View>
                              ) : isSubjectAbsent && cls.absence ? (
                                <TouchableOpacity
                                  disabled={cancellingId === cls.absence.id}
                                  onPress={() => handleCancelAbsence(cls.absence!, cls.subject_name)}
                                  style={[
                                    styles.rowAbsentBtn,
                                    {
                                      backgroundColor: colors.surfaceSubtle,
                                      borderColor: colors.border,
                                      borderRadius: radii.sm,
                                    },
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Restore ${cls.subject_name}`}
                                >
                                  {cancellingId === cls.absence.id ? (
                                    <ActivityIndicator size="small" color={colors.text} />
                                  ) : (
                                    <Text variant="xs" weight="700" style={{ color: '#f87171' }}>
                                      No Class ✕
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              ) : (
                                <TouchableOpacity
                                  disabled={markingEntryId === cls.entry_id}
                                  onPress={() => handleMarkSubjectAbsent(cls)}
                                  style={[
                                    styles.rowAbsentBtn,
                                    {
                                      backgroundColor: colors.surfaceSubtle,
                                      borderColor: colors.border,
                                      borderRadius: radii.sm,
                                    },
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Mark ${cls.subject_name} absent`}
                                >
                                  {markingEntryId === cls.entry_id ? (
                                    <ActivityIndicator size="small" color={colors.text} />
                                  ) : (
                                    <Text variant="xs" weight="700" style={{ color: '#f87171' }}>
                                      Absent
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>
                        );
                      })
                    )}
                  </View>
                );
              })}
            </Animated.ScrollView>
          </View>
        </>
      )}

      {/* Absent Duration Modal (Per-Subject or Absent Mode) */}
      <Modal
        visible={Boolean(modalTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmitting) setModalTarget(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                <Text variant="md" weight="800" style={{ color: colors.text }}>
                  {modalTarget?.scope === 'all'
                    ? 'Absent Mode (All Subjects)'
                    : `Mark Absent: ${modalTarget?.entry?.subject_name || ''}`}
                </Text>
                <Caption color="muted" style={{ marginTop: 4 }}>
                  {modalTarget?.scope === 'all'
                    ? 'All your scheduled subjects will show "No Class" and students will be notified.'
                    : 'Students will be notified and see "No Class" in their routine.'}
                </Caption>
              </View>
              <TouchableOpacity
                disabled={isSubmitting}
                onPress={() => setModalTarget(null)}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text variant="xs" weight="700" color="secondary" style={{ marginBottom: 8 }}>
              ABSENT FOR (DAYS)
            </Text>

            <View style={styles.quickDaysRow}>
              {QUICK_DAY_OPTIONS.map((d) => {
                const selected = String(d) === daysInput.trim();
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setDaysInput(String(d))}
                    style={[
                      styles.quickDayChip,
                      {
                        backgroundColor: selected ? colors.text : colors.surfaceSubtle,
                        borderColor: selected ? colors.text : colors.border,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: selected ? colors.background : colors.text }}
                    >
                      {d} {d === 1 ? 'Day' : 'Days'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ marginTop: 12 }}>
              <Caption color="muted" style={{ marginBottom: 6 }}>
                Or enter custom days (1–30):
              </Caption>
              <TextInput
                value={daysInput}
                onChangeText={(t) => setDaysInput(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={colors.textTertiary}
                maxLength={2}
                style={[
                  styles.daysInput,
                  {
                    color: colors.text,
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                  },
                ]}
              />
            </View>

            {modalTarget?.startDate ? (
              <Caption color="muted" style={{ marginTop: 10 }}>
                Applies from {formatBsDate(modalTarget.startDate)}
                {parsedModalDays > 1 && modalPreviewEnd
                  ? ` to ${formatBsDate(modalPreviewEnd)}`
                  : ''}
              </Caption>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity
                disabled={isSubmitting}
                onPress={() => setModalTarget(null)}
                style={[
                  styles.modalCancelBtn,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.border,
                    borderRadius: radii.sm,
                  },
                ]}
              >
                <Text variant="xs" weight="700" color="secondary">
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isSubmitting}
                onPress={handleConfirmAbsent}
                style={[
                  styles.modalConfirmBtn,
                  {
                    backgroundColor: colors.text,
                    borderRadius: radii.sm,
                    opacity: isSubmitting ? 0.6 : 1,
                  },
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text variant="xs" weight="800" style={{ color: colors.background }}>
                    Confirm & Notify Students
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Write Class Message Modal */}
      <Modal
        visible={Boolean(messageTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSendingMessage) setMessageTarget(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
                <Text variant="md" weight="800" style={{ color: colors.text }}>
                  Write Message
                </Text>
                <Caption color="muted" style={{ marginTop: 4 }}>
                  {messageTarget?.subject_name}
                  {messageTarget?.day_date
                    ? ` • ${messageTarget.day_of_week} (${formatBsDate(messageTarget.day_date)})`
                    : ''}
                </Caption>
              </View>
              <TouchableOpacity
                disabled={isSendingMessage}
                onPress={() => setMessageTarget(null)}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              value={messageDraft}
              onChangeText={setMessageDraft}
              placeholder="e.g. I will be 10 min late today..."
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={400}
              textAlignVertical="top"
              style={[
                styles.messageInput,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.border,
                  borderRadius: radii.sm,
                },
              ]}
            />

            <Caption color="muted" style={{ marginTop: 6 }}>
              Students will receive a notification and see an info (i) button on this class.
            </Caption>

            <View style={styles.modalActions}>
              {messageTarget?.teacher_message ? (
                <TouchableOpacity
                  disabled={isSendingMessage}
                  onPress={handleClearClassMessage}
                  style={[
                    styles.modalCancelBtn,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.border,
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Text variant="xs" weight="700" style={{ color: '#f87171' }}>
                    Clear
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  disabled={isSendingMessage}
                  onPress={() => setMessageTarget(null)}
                  style={[
                    styles.modalCancelBtn,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.border,
                      borderRadius: radii.sm,
                    },
                  ]}
                >
                  <Text variant="xs" weight="700" color="secondary">
                    Cancel
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                disabled={isSendingMessage}
                onPress={handleSendClassMessage}
                style={[
                  styles.modalConfirmBtn,
                  {
                    backgroundColor: colors.text,
                    borderRadius: radii.sm,
                    opacity: isSendingMessage ? 0.6 : 1,
                  },
                ]}
              >
                {isSendingMessage ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text variant="xs" weight="800" style={{ color: colors.background }}>
                    Send & Notify Students
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
  absentModeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  absentModeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  emptyDayCard: {
    padding: 18,
    borderWidth: 1,
    alignItems: 'center',
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
  statusCol: {
    paddingLeft: 8,
    alignItems: 'flex-end',
  },
  rowActionsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowMsgBtn: {
    width: 32,
    height: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAbsentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageInput: {
    minHeight: 88,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
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
  quickDaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickDayChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  daysInput: {
    height: 42,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmBtn: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
