import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { apiFetch } from '@/services/api';
import {
  AD_MONTHS,
  AD_YEARS,
  BS_MONTHS,
  BS_YEARS,
  NPT_TIME_POINTS,
  WEEKDAYS_NEPALI,
  formatSlotNptLabel,
  type RoutineOptionsCatalog,
} from '@/constants/nepaliCalendar';

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;

export interface EditorRoutineSlot {
  id: number;
  slot_order: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  label: string;
  is_break: boolean;
}

export interface EditorRoutineEntry {
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

export interface EditorClassRoutine {
  id: number;
  academic_session: string;
  year: number;
  semester: number;
  effective_date: string | null;
  status: string;
  slots: EditorRoutineSlot[];
  entries: EditorRoutineEntry[];
}

export interface EditorExamRow {
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Caption color="muted" style={styles.sectionLabel}>
      {children}
    </Caption>
  );
}

// ============================================================================
// 1. ADMIN CLASS PERIOD PICKER MODAL (Choose Day, Slot, Type, Subject, Teacher)
// ============================================================================
export function AdminClassPeriodModal({
  visible,
  routine,
  initialDay,
  initialSlotId,
  options,
  onClose,
  onSaved,
}: {
  visible: boolean;
  routine: EditorClassRoutine | null;
  initialDay: string;
  initialSlotId: number | null;
  options: RoutineOptionsCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, radii } = useTheme();
  const nonBreakSlots = useMemo(
    () => (routine?.slots || []).filter((s) => !s.is_break),
    [routine?.slots]
  );

  const [day, setDay] = useState<string>('Monday');
  const [slotId, setSlotId] = useState<number>(0);
  const [classType, setClassType] = useState<string>('Theory');
  const [subjectName, setSubjectName] = useState<string>('');
  const [customSubjectMode, setCustomSubjectMode] = useState(false);
  const [facultyName, setFacultyName] = useState<string>('');
  const [customFacultyMode, setCustomFacultyMode] = useState(false);
  const [facultyType, setFacultyType] = useState<string>('FT');
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const semesterSubjects = useMemo(() => {
    const sem = routine?.semester || 1;
    const core = options.subjectsBySemester?.[sem] || [];
    const electives = sem >= 7 ? options.electives || [] : [];
    return [...core, ...electives];
  }, [options, routine?.semester]);

  const currentEntry = useMemo(() => {
    if (!routine || !slotId) return null;
    return (
      routine.entries.find(
        (e) => e.day_of_week === day && Number(e.slot_id) === Number(slotId)
      ) || null
    );
  }, [routine, day, slotId]);

  useEffect(() => {
    if (!visible || !routine) return;
    const targetDay = (WORKING_DAYS as readonly string[]).includes(initialDay)
      ? initialDay
      : 'Monday';
    const targetSlot = initialSlotId || nonBreakSlots[0]?.id || 0;
    setDay(targetDay);
    setSlotId(targetSlot);
    setErrorText(null);
  }, [visible, routine, initialDay, initialSlotId, nonBreakSlots]);

  useEffect(() => {
    if (!visible || !routine) return;
    if (currentEntry) {
      setClassType(currentEntry.is_empty ? 'Empty' : currentEntry.class_type || 'Theory');
      const subj = currentEntry.subject_name || '';
      setSubjectName(subj);
      const isKnownSubj = !subj || semesterSubjects.some((s) => s.title.toLowerCase() === subj.toLowerCase());
      setCustomSubjectMode(!isKnownSubj);

      const fac = currentEntry.faculty_name || '';
      setFacultyName(fac);
      const isKnownFac = !fac || options.teachers.some((t) => t.toLowerCase() === fac.toLowerCase());
      setCustomFacultyMode(!isKnownFac);
      setFacultyType(currentEntry.faculty_type || 'FT');
    } else {
      setClassType('Theory');
      setSubjectName('');
      setCustomSubjectMode(false);
      setFacultyName('');
      setCustomFacultyMode(false);
      setFacultyType('FT');
    }
    setErrorText(null);
  }, [visible, routine, currentEntry, semesterSubjects, options.teachers]);

  if (!visible || !routine) return null;

  const hideDetails = classType === 'Break' || classType === 'Empty';

  const handleSave = async () => {
    if (!slotId) {
      setErrorText('Please choose a time slot.');
      return;
    }
    const isEmpty = classType === 'Empty';
    const isBreak = classType === 'Break';
    const cleanSubj = subjectName.trim();
    if (!isEmpty && !isBreak && !cleanSubj) {
      setErrorText('Please choose a subject.');
      return;
    }
    setSaving(true);
    setErrorText(null);
    try {
      const res = await apiFetch(`/api/routine/class/admin/${routine.id}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_of_week: day,
          slot_id: slotId,
          subject_name: isEmpty ? null : isBreak ? 'Break' : cleanSubj,
          faculty_name: isEmpty || isBreak ? null : facultyName.trim() || null,
          faculty_type: isEmpty || isBreak ? null : facultyType || null,
          class_type: classType,
          is_empty: isEmpty,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save class period.');
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorText(err?.message || 'Could not save class period.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!currentEntry) return;
    setSaving(true);
    setErrorText(null);
    try {
      const res = await apiFetch(
        `/api/routine/class/admin/${routine.id}/entries/${currentEntry.id}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not clear period.');
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorText(err?.message || 'Could not clear period.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetOverlay}
      >
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Caption color="muted" style={{ letterSpacing: 0.7 }}>
                ADMIN · SEM {ROMANS[routine.semester - 1]} CLASS ROUTINE
              </Caption>
              <Heading level={3} style={{ marginTop: 2 }}>
                {currentEntry && !currentEntry.is_empty ? 'Edit Class Period' : 'Assign Class Period'}
              </Heading>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeIconBtn, { backgroundColor: colors.surfaceRaised }]}>
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScrollBody}>
            <SectionLabel>DAY OF WEEK</SectionLabel>
            <View style={styles.chipWrap}>
              {WORKING_DAYS.map((d) => {
                const active = day === d;
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setDay(d)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {d.slice(0, 3)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <SectionLabel>TIME SLOT (NEPALI TIME · NPT)</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {nonBreakSlots.map((slot) => {
                const active = slotId === slot.id;
                return (
                  <TouchableOpacity
                    key={slot.id}
                    onPress={() => setSlotId(slot.id)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {formatSlotNptLabel(slot)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <SectionLabel>CLASS TYPE</SectionLabel>
            <View style={styles.chipWrap}>
              {(options.classTypes || ['Theory', 'Practical', 'Lab', 'Break', 'Empty']).map((ct) => {
                const active = classType === ct;
                return (
                  <TouchableOpacity
                    key={ct}
                    onPress={() => setClassType(ct)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {ct}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {!hideDetails && (
              <>
                <SectionLabel>CHOOSE SUBJECT</SectionLabel>
                <View style={styles.chipWrap}>
                  {semesterSubjects.map((s) => {
                    const active = !customSubjectMode && subjectName.toLowerCase() === s.title.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={`${s.code}:${s.title}`}
                        onPress={() => {
                          setSubjectName(s.title);
                          setCustomSubjectMode(false);
                        }}
                        style={[
                          styles.chip,
                          { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                        ]}
                      >
                        <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                          {s.title}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    onPress={() => {
                      setCustomSubjectMode(true);
                      if (semesterSubjects.some((s) => s.title === subjectName)) setSubjectName('');
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: customSubjectMode ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: customSubjectMode ? colors.background : colors.textSecondary }}>
                      + Custom
                    </Text>
                  </TouchableOpacity>
                </View>
                {customSubjectMode && (
                  <TextInput
                    value={subjectName}
                    onChangeText={setSubjectName}
                    placeholder="Enter subject name"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.inputBox, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]}
                  />
                )}

                <SectionLabel>CHOOSE TEACHER / FACULTY (OPTIONAL)</SectionLabel>
                <View style={styles.chipWrap}>
                  <TouchableOpacity
                    onPress={() => {
                      setFacultyName('');
                      setCustomFacultyMode(false);
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: !customFacultyMode && !facultyName ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: !customFacultyMode && !facultyName ? colors.background : colors.text }}>
                      Unassigned
                    </Text>
                  </TouchableOpacity>
                  {options.teachers.map((teacher) => {
                    const active = !customFacultyMode && facultyName.toLowerCase() === teacher.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={teacher}
                        onPress={() => {
                          setFacultyName(teacher);
                          setCustomFacultyMode(false);
                        }}
                        style={[
                          styles.chip,
                          { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                        ]}
                      >
                        <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                          {teacher}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    onPress={() => {
                      setCustomFacultyMode(true);
                      if (options.teachers.includes(facultyName)) setFacultyName('');
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: customFacultyMode ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: customFacultyMode ? colors.background : colors.textSecondary }}>
                      + Custom
                    </Text>
                  </TouchableOpacity>
                </View>
                {customFacultyMode && (
                  <TextInput
                    value={facultyName}
                    onChangeText={setFacultyName}
                    placeholder="Enter teacher name"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.inputBox, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]}
                  />
                )}

                <SectionLabel>FACULTY TYPE</SectionLabel>
                <View style={styles.chipWrap}>
                  {options.facultyTypes.map((ft) => {
                    const active = facultyType === ft.value;
                    return (
                      <TouchableOpacity
                        key={ft.value}
                        onPress={() => setFacultyType(ft.value)}
                        style={[
                          styles.chip,
                          { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                        ]}
                      >
                        <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                          {ft.value}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {errorText ? (
              <Text variant="xs" style={{ color: '#FCA5A5', marginTop: 10 }}>
                {errorText}
              </Text>
            ) : null}
          </ScrollView>

          <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>
            {currentEntry ? (
              <TouchableOpacity
                onPress={() => void handleClear()}
                disabled={saving}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text variant="sm" weight="600" style={{ color: '#FCA5A5' }}>
                  Clear
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => void handleSave()}
              disabled={saving}
              style={[styles.primaryBtn, { backgroundColor: colors.text, flex: 1 }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text variant="sm" weight="700" style={{ color: colors.background }}>
                  Save Period
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================================================
// 2. ADMIN NEW CLASS ROUTINE MODAL (BS Academic Session & BS Effective Date)
// ============================================================================
export function AdminNewClassRoutineModal({
  visible,
  initialSemester,
  options,
  onClose,
  onCreated,
}: {
  visible: boolean;
  initialSemester: number;
  options: RoutineOptionsCatalog;
  onClose: () => void;
  onCreated: (semester: number) => void;
}) {
  const { colors, radii } = useTheme();
  const [semester, setSemester] = useState<number>(initialSemester || 1);
  const [session, setSession] = useState<string>(options.sessionPresets[2] || '2083 BS (Ashwin–Chaitra)');
  const [bsYear, setBsYear] = useState<number>(2083);
  const [bsMonth, setBsMonth] = useState<string>('06');
  const [bsDay, setBsDay] = useState<number>(1);
  const [publishNow, setPublishNow] = useState<boolean>(true);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSemester(initialSemester || 1);
    setSession(options.sessionPresets[2] || '2083 BS (Ashwin–Chaitra)');
    setBsYear(2083);
    setBsMonth('06');
    setBsDay(1);
    setPublishNow(true);
    setErrorText(null);
  }, [visible, initialSemester, options.sessionPresets]);

  if (!visible) return null;

  const handleCreate = async () => {
    setSaving(true);
    setErrorText(null);
    try {
      const effective_date = `${bsYear}/${bsMonth}/${String(bsDay).padStart(2, '0')} BS`;
      const res = await apiFetch('/api/routine/class/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semester,
          academic_session: session,
          effective_date,
          status: publishNow ? 'published' : 'draft',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not create class routine.');

      if (publishNow && data?.routine?.id) {
        await apiFetch(`/api/routine/class/admin/${data.routine.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replaceExisting: true }),
        });
      }
      onCreated(semester);
      onClose();
    } catch (err: any) {
      setErrorText(err?.message || 'Could not create class routine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Caption color="muted" style={{ letterSpacing: 0.7 }}>
                ADMIN · NEW CLASS ROUTINE
              </Caption>
              <Heading level={3} style={{ marginTop: 2 }}>
                Create Semester Timetable
              </Heading>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeIconBtn, { backgroundColor: colors.surfaceRaised }]}>
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScrollBody}>
            <SectionLabel>SEMESTER</SectionLabel>
            <View style={styles.chipWrap}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                const active = semester === sem;
                return (
                  <TouchableOpacity
                    key={sem}
                    onPress={() => setSemester(sem)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      Sem {ROMANS[sem - 1]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <SectionLabel>ACADEMIC SESSION (NEPALI BS)</SectionLabel>
            <View style={styles.chipWrap}>
              {options.sessionPresets.map((preset) => {
                const active = session === preset;
                return (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => setSession(preset)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {preset}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <SectionLabel>EFFECTIVE BS DATE ({bsYear}/{bsMonth}/{String(bsDay).padStart(2, '0')} BS)</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {BS_YEARS.map((y) => {
                const active = bsYear === y;
                return (
                  <TouchableOpacity
                    key={y}
                    onPress={() => setBsYear(y)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {y} BS
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {BS_MONTHS.map((m) => {
                const active = bsMonth === m.value;
                return (
                  <TouchableOpacity
                    key={m.value}
                    onPress={() => setBsMonth(m.value)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {m.name} ({m.nepali})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {Array.from({ length: 32 }, (_, idx) => idx + 1).map((d) => {
                const active = bsDay === d;
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setBsDay(d)}
                    style={[
                      styles.dayNumChip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {String(d).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setPublishNow((v) => !v)}
              style={[styles.toggleRow, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons
                name={publishNow ? 'checkbox' : 'square-outline'}
                size={20}
                color={colors.text}
              />
              <Text variant="sm" weight="600" style={{ marginLeft: 10 }}>
                Publish immediately for students
              </Text>
            </TouchableOpacity>

            {errorText ? (
              <Text variant="xs" style={{ color: '#FCA5A5', marginTop: 10 }}>
                {errorText}
              </Text>
            ) : null}
          </ScrollView>

          <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => void handleCreate()}
              disabled={saving}
              style={[styles.primaryBtn, { backgroundColor: colors.text, flex: 1 }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text variant="sm" weight="700" style={{ color: colors.background }}>
                  Create Routine
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ============================================================================
// 3. ADMIN EXAM ROUTINE PICKER MODAL (BS Date, NPT Time, Subject, Room, Type)
// ============================================================================
export function AdminExamEditorModal({
  visible,
  editingExam,
  initialSemester,
  options,
  onClose,
  onSaved,
}: {
  visible: boolean;
  editingExam: EditorExamRow | null;
  initialSemester: number;
  options: RoutineOptionsCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, radii } = useTheme();
  const [semester, setSemester] = useState<number>(initialSemester || 1);
  const [subjectName, setSubjectName] = useState<string>('');
  const [subjectCode, setSubjectCode] = useState<string>('');
  const [customSubjectMode, setCustomSubjectMode] = useState(false);

  const [calendar, setCalendar] = useState<'BS' | 'AD'>('BS');
  const [year, setYear] = useState<number>(2083);
  const [month, setMonth] = useState<string>('06');
  const [day, setDay] = useState<number>(15);
  const [weekday, setWeekday] = useState<string>('');

  const [startTime, setStartTime] = useState<string>('11:30 AM');
  const [endTime, setEndTime] = useState<string>('2:30 PM');
  const [room, setRoom] = useState<string>('');
  const [customRoomMode, setCustomRoomMode] = useState(false);
  const [examType, setExamType] = useState<string>('Final Examination');

  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const semesterSubjects = useMemo(() => {
    const core = options.subjectsBySemester?.[semester] || [];
    const electives = semester >= 7 ? options.electives || [] : [];
    return [...core, ...electives];
  }, [options, semester]);

  useEffect(() => {
    if (!visible) return;
    if (editingExam) {
      const sem = editingExam.semester || 1;
      setSemester(sem);
      const known = [
        ...(options.subjectsBySemester?.[sem] || []),
        ...(sem >= 7 ? options.electives || [] : []),
      ];
      const matched = known.find(
        (s) => s.title.toLowerCase() === (editingExam.subject_name || '').toLowerCase()
      );
      setSubjectName(editingExam.subject_name || '');
      setSubjectCode(editingExam.subject_code || matched?.code || '');
      setCustomSubjectMode(!matched);

      const cal: 'BS' | 'AD' = editingExam.calendar === 'AD' ? 'AD' : 'BS';
      setCalendar(cal);
      const parsedDate = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(editingExam.exam_date || '');
      if (parsedDate) {
        setYear(Number(parsedDate[1]));
        setMonth(parsedDate[2].padStart(2, '0'));
        setDay(Number(parsedDate[3]));
      } else {
        setYear(cal === 'AD' ? 2026 : 2083);
        setMonth('06');
        setDay(15);
      }

      setWeekday(editingExam.weekday || '');
      const tParts = String(editingExam.exam_time || '')
        .split(/\s*[–-]\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      setStartTime(tParts[0] || '11:30 AM');
      setEndTime(tParts[1] || '2:30 PM');

      const rm = editingExam.room || '';
      setRoom(rm);
      setCustomRoomMode(Boolean(rm) && !options.rooms.includes(rm));
      setExamType(editingExam.exam_type || 'Final Examination');
    } else {
      setSemester(initialSemester || 1);
      setSubjectName('');
      setSubjectCode('');
      setCustomSubjectMode(false);
      setCalendar('BS');
      setYear(2083);
      setMonth('06');
      setDay(15);
      setWeekday('');
      setStartTime('11:30 AM');
      setEndTime('2:30 PM');
      setRoom('');
      setCustomRoomMode(false);
      setExamType('Final Examination');
    }
    setErrorText(null);
  }, [visible, editingExam, initialSemester, options]);

  if (!visible) return null;

  const formattedDate = `${year}/${month}/${String(day).padStart(2, '0')}`;
  const formattedTime = startTime && endTime ? `${startTime} – ${endTime}` : startTime || '';

  const handleCalendarSwitch = (nextCal: 'BS' | 'AD') => {
    setCalendar(nextCal);
    if (nextCal === 'AD' && year > 2050) setYear(2026);
    if (nextCal === 'BS' && year < 2050) setYear(2083);
    if (nextCal === 'AD' && day > 31) setDay(31);
  };

  const handleSave = async () => {
    const cleanSubj = subjectName.trim();
    if (!cleanSubj) {
      setErrorText('Please choose a subject.');
      return;
    }
    setSaving(true);
    setErrorText(null);
    try {
      const payload = {
        semester,
        subject_name: cleanSubj,
        subject_code: subjectCode.trim() || null,
        calendar,
        exam_date: formattedDate,
        exam_time: formattedTime || null,
        room: room.trim() || null,
        weekday: weekday || null,
        exam_type: examType || null,
      };
      const url = editingExam ? `/api/routine/${editingExam.id}` : '/api/routine';
      const res = await apiFetch(url, {
        method: editingExam ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save exam.');
      onSaved();
      onClose();
    } catch (err: any) {
      setErrorText(err?.message || 'Could not save exam.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!editingExam) return;
    Alert.alert(
      'Delete Exam?',
      `Remove "${editingExam.subject_name}" on ${editingExam.exam_date}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const res = await apiFetch(`/api/routine/${editingExam.id}`, { method: 'DELETE' });
              const data = await res.json().catch(() => null);
              if (!res.ok) throw new Error(data?.error || 'Could not delete exam.');
              onSaved();
              onClose();
            } catch (err: any) {
              setErrorText(err?.message || 'Could not delete exam.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const yearChoices = calendar === 'AD' ? AD_YEARS : BS_YEARS;
  const maxDays = calendar === 'AD' ? 31 : 32;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.sheetOverlay}
      >
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
          ]}
        >
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Caption color="muted" style={{ letterSpacing: 0.7 }}>
                ADMIN · EXAM ROUTINE ({calendar})
              </Caption>
              <Heading level={3} style={{ marginTop: 2 }}>
                {editingExam ? 'Edit Exam' : 'Add Exam'}
              </Heading>
            </View>
            <TouchableOpacity onPress={onClose} style={[styles.closeIconBtn, { backgroundColor: colors.surfaceRaised }]}>
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetScrollBody}>
            <SectionLabel>SEMESTER</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                const active = semester === sem;
                return (
                  <TouchableOpacity
                    key={sem}
                    onPress={() => {
                      setSemester(sem);
                      if (!editingExam) {
                        setSubjectName('');
                        setSubjectCode('');
                        setCustomSubjectMode(false);
                      }
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      Sem {ROMANS[sem - 1]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <SectionLabel>CHOOSE SUBJECT {subjectCode ? `· ${subjectCode}` : ''}</SectionLabel>
            <View style={styles.chipWrap}>
              {semesterSubjects.map((s) => {
                const active = !customSubjectMode && subjectName.toLowerCase() === s.title.toLowerCase();
                return (
                  <TouchableOpacity
                    key={`${s.code}:${s.title}`}
                    onPress={() => {
                      setSubjectName(s.title);
                      setSubjectCode(s.code || '');
                      setCustomSubjectMode(false);
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {s.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => {
                  setCustomSubjectMode(true);
                  if (semesterSubjects.some((s) => s.title === subjectName)) {
                    setSubjectName('');
                    setSubjectCode('');
                  }
                }}
                style={[
                  styles.chip,
                  { backgroundColor: customSubjectMode ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                ]}
              >
                <Text variant="xs" weight="600" style={{ color: customSubjectMode ? colors.background : colors.textSecondary }}>
                  + Custom
                </Text>
              </TouchableOpacity>
            </View>
            {customSubjectMode && (
              <TextInput
                value={subjectName}
                onChangeText={setSubjectName}
                placeholder="Enter custom subject name"
                placeholderTextColor={colors.textMuted}
                style={[styles.inputBox, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]}
              />
            )}

            <SectionLabel>CALENDAR & DATE ({formattedDate} {calendar})</SectionLabel>
            <View style={[styles.chipWrap, { marginBottom: 8 }]}>
              {(['BS', 'AD'] as const).map((cal) => {
                const active = calendar === cal;
                return (
                  <TouchableOpacity
                    key={cal}
                    onPress={() => handleCalendarSwitch(cal)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {cal === 'BS' ? 'BS (Nepali Bikram Sambat)' : 'AD (English)'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {yearChoices.map((y) => {
                const active = year === y;
                return (
                  <TouchableOpacity
                    key={y}
                    onPress={() => setYear(y)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {y} {calendar}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {(calendar === 'BS' ? BS_MONTHS : AD_MONTHS).map((m) => {
                const active = month === m.value;
                return (
                  <TouchableOpacity
                    key={m.value}
                    onPress={() => setMonth(m.value)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {'nepali' in m ? `${m.name} (${m.nepali})` : m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {Array.from({ length: maxDays }, (_, idx) => idx + 1).map((d) => {
                const active = day === d;
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setDay(d)}
                    style={[
                      styles.dayNumChip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="700" style={{ color: active ? colors.background : colors.text }}>
                      {String(d).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <SectionLabel>WEEKDAY (OPTIONAL)</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {WEEKDAYS_NEPALI.map((w) => {
                const active = weekday === w.value;
                return (
                  <TouchableOpacity
                    key={w.value}
                    onPress={() => setWeekday(active ? '' : w.value)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {w.short} ({w.nepali})
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <SectionLabel>EXAM TIME (NEPALI TIME · {formattedTime})</SectionLabel>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {options.examTimePresets.map((preset) => {
                const active = formattedTime === preset;
                return (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => {
                      const [s, e] = preset.split(/\s*[–-]\s*/);
                      if (s) setStartTime(s.trim());
                      if (e) setEndTime(e.trim());
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {preset}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Caption color="muted" style={{ marginBottom: 4 }}>Start Time</Caption>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 8 }}>
              {NPT_TIME_POINTS.map((t) => {
                const active = startTime === t;
                return (
                  <TouchableOpacity
                    key={`start:${t}`}
                    onPress={() => setStartTime(t)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Caption color="muted" style={{ marginBottom: 4 }}>End Time</Caption>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {NPT_TIME_POINTS.map((t) => {
                const active = endTime === t;
                return (
                  <TouchableOpacity
                    key={`end:${t}`}
                    onPress={() => setEndTime(t)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <SectionLabel>EXAM TYPE</SectionLabel>
            <View style={styles.chipWrap}>
              {options.examTypes.map((et) => {
                const active = examType === et;
                return (
                  <TouchableOpacity
                    key={et}
                    onPress={() => setExamType(et)}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {et}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <SectionLabel>ROOM / HALL (OPTIONAL)</SectionLabel>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                onPress={() => {
                  setRoom('');
                  setCustomRoomMode(false);
                }}
                style={[
                  styles.chip,
                  { backgroundColor: !customRoomMode && !room ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                ]}
              >
                <Text variant="xs" weight="600" style={{ color: !customRoomMode && !room ? colors.background : colors.text }}>
                  TBA
                </Text>
              </TouchableOpacity>
              {options.rooms.map((rm) => {
                const active = !customRoomMode && room === rm;
                return (
                  <TouchableOpacity
                    key={rm}
                    onPress={() => {
                      setRoom(rm);
                      setCustomRoomMode(false);
                    }}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                    ]}
                  >
                    <Text variant="xs" weight="600" style={{ color: active ? colors.background : colors.text }}>
                      {rm}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity
                onPress={() => {
                  setCustomRoomMode(true);
                  if (options.rooms.includes(room)) setRoom('');
                }}
                style={[
                  styles.chip,
                  { backgroundColor: customRoomMode ? colors.text : colors.surfaceRaised, borderColor: colors.border },
                ]}
              >
                <Text variant="xs" weight="600" style={{ color: customRoomMode ? colors.background : colors.textSecondary }}>
                  + Custom
                </Text>
              </TouchableOpacity>
            </View>
            {customRoomMode && (
              <TextInput
                value={room}
                onChangeText={setRoom}
                placeholder="Enter custom room or hall"
                placeholderTextColor={colors.textMuted}
                style={[styles.inputBox, { backgroundColor: colors.surfaceRaised, color: colors.text, borderColor: colors.border }]}
              />
            )}

            {errorText ? (
              <Text variant="xs" style={{ color: '#FCA5A5', marginTop: 10 }}>
                {errorText}
              </Text>
            ) : null}
          </ScrollView>

          <View style={[styles.sheetFooter, { borderTopColor: colors.border }]}>
            {editingExam ? (
              <TouchableOpacity
                onPress={handleDelete}
                disabled={saving}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text variant="sm" weight="600" style={{ color: '#FCA5A5' }}>
                  Delete
                </Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => void handleSave()}
              disabled={saving}
              style={[styles.primaryBtn, { backgroundColor: colors.text, flex: 1 }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text variant="sm" weight="700" style={{ color: colors.background }}>
                  {editingExam ? 'Save Changes' : 'Add Exam'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    maxHeight: '88%',
    borderTopWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  closeIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScrollBody: {
    paddingBottom: 20,
  },
  sectionLabel: {
    marginTop: 14,
    marginBottom: 8,
    letterSpacing: 0.7,
    fontWeight: '700',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  dayNumChip: {
    width: 38,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputBox: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  toggleRow: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: {
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
