import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { apiFetch } from '@/services/api';
import {
  BS_MONTHS,
  BS_YEARS,
  NPT_TIME_POINTS,
  formatSlotNptLabel,
  getBsDaysInMonth,
  getBsWeekday,
  type RoutineOptionsCatalog,
} from '@/constants/nepaliCalendar';

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
const WORKING_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const EXAM_TYPES_CLEAN = [
  'Final Examination',
  'Pre-board Examination',
  'Midterm Examination',
  'Practical Examination',
  'Makeup Examination',
];

export interface RoutineSlotItem {
  id: number;
  slot_order: number;
  start_time: string;
  end_time: string;
  duration_minutes: number;
  label: string;
  is_break: boolean;
}

export interface RoutineEntryItem {
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

export interface ClassRoutineModel {
  id: number;
  semester: number;
  academic_session: string;
  slots: RoutineSlotItem[];
  entries: RoutineEntryItem[];
}

export interface ExamRoutineItem {
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

interface PickerOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface ActivePickerConfig {
  title: string;
  options: PickerOption[];
  selectedValue: string;
  mode?: 'list' | 'day-grid';
  onSelect: (val: string) => void;
}

function SelectButton({
  label,
  value,
  placeholder,
  onPress,
  compact = false,
}: {
  label?: string;
  value?: string;
  placeholder: string;
  onPress: () => void;
  compact?: boolean;
}) {
  const { colors, radii } = useTheme();
  const hasValue = Boolean(value);
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[
        compact ? styles.selectBtnCompact : styles.selectBtn,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: hasValue ? colors.text : colors.border,
          borderRadius: radii.sm,
        },
      ]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        {label ? (
          <Caption color="muted" style={{ fontSize: 10, marginBottom: 1 }}>
            {label}
          </Caption>
        ) : null}
        <Text
          variant="xs"
          weight={hasValue ? '700' : '500'}
          numberOfLines={1}
          style={{ color: hasValue ? colors.text : colors.textSecondary }}
        >
          {value || placeholder}
        </Text>
      </View>
      <Ionicons
        name="chevron-down"
        size={13}
        color={hasValue ? colors.text : colors.textSecondary}
        style={{ marginLeft: 4 }}
      />
    </TouchableOpacity>
  );
}

function OptionPickerModal({
  config,
  onClose,
}: {
  config: ActivePickerConfig | null;
  onClose: () => void;
}) {
  const { colors, radii } = useTheme();
  if (!config) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={styles.pickerBackdrop}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {}}
          style={[
            styles.pickerCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg },
          ]}
        >
          <View style={styles.pickerHeader}>
            <Text variant="md" weight="700">
              {config.title}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>

          {config.mode === 'day-grid' ? (
            <View style={styles.dayGrid}>
              {config.options.map((opt) => {
                const active = opt.value === config.selectedValue;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    activeOpacity={0.75}
                    onPress={() => {
                      config.onSelect(opt.value);
                      onClose();
                    }}
                    style={[
                      styles.dayGridCell,
                      {
                        backgroundColor: active ? colors.text : colors.surfaceRaised,
                        borderColor: active ? colors.text : colors.border,
                        borderRadius: radii.sm,
                      },
                    ]}
                  >
                    <Text
                      variant="xs"
                      weight="700"
                      style={{ color: active ? colors.background : colors.text }}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {config.options.map((opt) => {
                const active = opt.value === config.selectedValue;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    activeOpacity={0.75}
                    onPress={() => {
                      config.onSelect(opt.value);
                      onClose();
                    }}
                    style={[
                      styles.pickerRow,
                      {
                        backgroundColor: active ? colors.text : 'transparent',
                        borderBottomColor: colors.border,
                        borderRadius: active ? radii.sm : 0,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="sm"
                        weight={active ? '700' : '500'}
                        style={{ color: active ? colors.background : colors.text }}
                      >
                        {opt.label}
                      </Text>
                      {opt.sublabel ? (
                        <Caption
                          style={{
                            color: active ? colors.background : colors.textSecondary,
                            opacity: active ? 0.8 : 1,
                          }}
                        >
                          {opt.sublabel}
                        </Caption>
                      ) : null}
                    </View>
                    {active && <Ionicons name="checkmark" size={16} color={colors.background} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ============================================================================
// 1. ADMIN EXAM SCHEDULE TABLE MODAL (Semester Subjects + Tap-to-Open Pickers)
// ============================================================================

interface ExamDraftRow {
  subjectName: string;
  subjectCode: string;
  existingId: number | null;
  room: string | null;
  month: string; // '' | '01'..'12'
  day: string; // '' | '01'..'32'
  startTime: string;
  endTime: string;
  examType: string;
}

function parseExamTimeParts(timeStr?: string | null) {
  const parts = String(timeStr || '')
    .split(/\s*[–-]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    startTime: parts[0] || '11:30 AM',
    endTime: parts[1] || '2:30 PM',
  };
}

export function AdminExamTableModal({
  visible,
  initialSemester,
  existingExams,
  options,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initialSemester: number;
  existingExams: ExamRoutineItem[];
  options: RoutineOptionsCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, radii } = useTheme();
  const [semester, setSemester] = useState<number>(initialSemester || 1);
  const [bsYear, setBsYear] = useState<number>(2083);
  const [rows, setRows] = useState<ExamDraftRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<ActivePickerConfig | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSemester(initialSemester || 1);
    setError('');
  }, [visible, initialSemester]);

  // Build subject rows whenever modal opens, semester changes, or existing exams update
  useEffect(() => {
    if (!visible) return;
    const core = options.subjectsBySemester[semester] || [];
    const electives = semester >= 7 ? options.electives || [] : [];
    const semSubjects = [...core, ...electives];
    const semExams = existingExams.filter((e) => Number(e.semester) === semester);

    // Infer BS year from existing exam in this semester if available
    const firstDated = semExams.find((e) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(e.exam_date || ''));
    if (firstDated) {
      const y = Number(firstDated.exam_date.slice(0, 4));
      if (y >= 2080 && y <= 2085) setBsYear(y);
    }

    const matchedIds = new Set<number>();
    const built: ExamDraftRow[] = semSubjects.map((sub) => {
      const ex =
        semExams.find((e) => e.subject_name.toLowerCase() === sub.title.toLowerCase()) || null;
      if (ex) matchedIds.add(ex.id);
      let month = '';
      let day = '';
      if (ex?.exam_date) {
        const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(ex.exam_date.trim());
        if (m) {
          month = m[2].padStart(2, '0');
          day = m[3].padStart(2, '0');
        }
      }
      const { startTime, endTime } = parseExamTimeParts(ex?.exam_time);
      return {
        subjectName: sub.title,
        subjectCode: ex?.subject_code || sub.code || '',
        existingId: ex ? ex.id : null,
        room: ex?.room || null,
        month,
        day,
        startTime,
        endTime,
        examType: ex?.exam_type || 'Final Examination',
      };
    });

    for (const extra of semExams) {
      if (!matchedIds.has(extra.id)) {
        const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec((extra.exam_date || '').trim());
        const { startTime, endTime } = parseExamTimeParts(extra.exam_time);
        built.push({
          subjectName: extra.subject_name,
          subjectCode: extra.subject_code || '',
          existingId: extra.id,
          room: extra.room || null,
          month: m ? m[2].padStart(2, '0') : '',
          day: m ? m[3].padStart(2, '0') : '',
          startTime,
          endTime,
          examType: extra.exam_type || 'Final Examination',
        });
      }
    }
    setRows(built);
  }, [visible, semester, existingExams, options]);

  const updateRow = (index: number, patch: Partial<ExamDraftRow>) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        if (patch.month !== undefined && next.day) {
          const maxDay = getBsDaysInMonth(bsYear, Number(next.month));
          if (Number(next.day) > maxDay) {
            next.day = String(maxDay).padStart(2, '0');
          }
        }
        return next;
      })
    );
  };

  const handleClearRow = (index: number) => {
    const target = rows[index];
    if (!target) return;
    if (!target.existingId) {
      updateRow(index, { month: '', day: '' });
      return;
    }
    Alert.alert('Remove Exam', `Remove "${target.subjectName}" from the published exam schedule?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          setError('');
          try {
            const res = await apiFetch(`/api/routine/${target.existingId}`, { method: 'DELETE' });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'Could not remove exam.');
            updateRow(index, { existingId: null, month: '', day: '' });
            onSaved();
          } catch (err: any) {
            setError(err?.message || 'Could not remove exam.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const handleSaveAll = async () => {
    const ready = rows.filter((r) => r.month && r.day);
    if (!ready.length) {
      setError('Select Month and Day for at least one subject.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const row of ready) {
        const weekday = getBsWeekday(bsYear, Number(row.month), Number(row.day)) || null;
        const exam_time =
          row.startTime && row.endTime
            ? `${row.startTime} – ${row.endTime}`
            : row.startTime || null;
        const payload = {
          semester,
          subject_name: row.subjectName,
          subject_code: row.subjectCode || null,
          calendar: 'BS',
          exam_date: `${bsYear}/${row.month}/${row.day}`,
          weekday,
          exam_time,
          exam_type: row.examType || null,
          room: row.room || null,
        };
        const res = await apiFetch(`/api/routine${row.existingId ? `/${row.existingId}` : ''}`, {
          method: row.existingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `Could not save ${row.subjectName}.`);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save exam schedule.');
    } finally {
      setSaving(false);
    }
  };

  const monthOptions: PickerOption[] = (options.bsMonths || BS_MONTHS).map((m) => ({
    value: m.value,
    label: m.name,
    sublabel: m.nepali,
  }));

  const timeOptions: PickerOption[] = NPT_TIME_POINTS.map((t) => ({ value: t, label: t }));
  const typeOptions: PickerOption[] = EXAM_TYPES_CLEAN.map((t) => ({ value: t, label: t }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Caption color="muted" style={styles.eyebrow}>
                ADMIN · EXAM SCHEDULE
              </Caption>
              <Heading level={3}>Semester Exam Table</Heading>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Top Bar: Semester & BS Year Selectors */}
          <View style={styles.topPickerRow}>
            <View style={{ flex: 1 }}>
              <SelectButton
                label="Semester"
                value={`Semester ${ROMANS[semester - 1]}`}
                placeholder="Semester"
                onPress={() =>
                  setPicker({
                    title: 'Select Semester',
                    selectedValue: String(semester),
                    options: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({
                      value: String(s),
                      label: `Semester ${ROMANS[s - 1]}`,
                    })),
                    onSelect: (val) => setSemester(Number(val)),
                  })
                }
              />
            </View>
            <View style={{ width: 120 }}>
              <SelectButton
                label="BS Year"
                value={`${bsYear} BS`}
                placeholder="Year"
                onPress={() =>
                  setPicker({
                    title: 'Select BS Year',
                    selectedValue: String(bsYear),
                    options: (options.bsYears || BS_YEARS).map((y) => ({
                      value: String(y),
                      label: `${y} BS`,
                    })),
                    onSelect: (val) => setBsYear(Number(val)),
                  })
                }
              />
            </View>
          </View>

          {/* Subject Rows */}
          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {rows.map((row, idx) => {
              const monthObj = (options.bsMonths || BS_MONTHS).find((m) => m.value === row.month);
              const weekday =
                row.month && row.day
                  ? getBsWeekday(bsYear, Number(row.month), Number(row.day))
                  : '';
              const maxDays = row.month ? getBsDaysInMonth(bsYear, Number(row.month)) : 32;
              const shortType = row.examType.replace(' Examination', '');

              return (
                <View
                  key={`${row.subjectName}-${idx}`}
                  style={[
                    styles.examSubjectCard,
                    {
                      backgroundColor: colors.background,
                      borderColor: row.month && row.day ? colors.text : colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  {/* Subject Name + Auto Weekday + Clear */}
                  <View style={styles.examSubjectHeader}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text variant="sm" weight="700" numberOfLines={2}>
                        {row.subjectName}
                      </Text>
                      {row.subjectCode ? (
                        <Caption color="muted">{row.subjectCode}</Caption>
                      ) : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {weekday ? (
                        <View
                          style={[
                            styles.weekdayBadge,
                            { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                          ]}
                        >
                          <Text variant="xs" weight="700">
                            {weekday.slice(0, 3)}
                          </Text>
                        </View>
                      ) : null}
                      {(row.existingId || row.month || row.day) && (
                        <TouchableOpacity
                          onPress={() => handleClearRow(idx)}
                          style={[styles.iconClearBtn, { backgroundColor: colors.surfaceRaised }]}
                        >
                          <Ionicons name="close" size={14} color={colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Row 1 of Pickers: Month | Day | Start | End */}
                  <View style={styles.examPickerRow}>
                    <View style={{ flex: 1.25 }}>
                      <SelectButton
                        compact
                        label="Month"
                        value={monthObj ? monthObj.name : ''}
                        placeholder="Month"
                        onPress={() =>
                          setPicker({
                            title: 'Select BS Month',
                            selectedValue: row.month,
                            options: monthOptions,
                            onSelect: (val) => updateRow(idx, { month: val }),
                          })
                        }
                      />
                    </View>
                    <View style={{ width: 68 }}>
                      <SelectButton
                        compact
                        label="Day"
                        value={row.day ? String(Number(row.day)) : ''}
                        placeholder="Day"
                        onPress={() =>
                          setPicker({
                            title: monthObj ? `Day (${monthObj.name} ${bsYear})` : 'Select BS Day',
                            selectedValue: row.day,
                            mode: 'day-grid',
                            options: Array.from({ length: maxDays }, (_, i) => {
                              const pad = String(i + 1).padStart(2, '0');
                              return { value: pad, label: String(i + 1) };
                            }),
                            onSelect: (val) => updateRow(idx, { day: val }),
                          })
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <SelectButton
                        compact
                        label="Start"
                        value={row.startTime}
                        placeholder="Start"
                        onPress={() =>
                          setPicker({
                            title: 'Start Time (NPT)',
                            selectedValue: row.startTime,
                            options: timeOptions,
                            onSelect: (val) => updateRow(idx, { startTime: val }),
                          })
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <SelectButton
                        compact
                        label="End"
                        value={row.endTime}
                        placeholder="End"
                        onPress={() =>
                          setPicker({
                            title: 'End Time (NPT)',
                            selectedValue: row.endTime,
                            options: timeOptions,
                            onSelect: (val) => updateRow(idx, { endTime: val }),
                          })
                        }
                      />
                    </View>
                  </View>

                  {/* Row 2: Exam Type */}
                  <View style={{ marginTop: 6 }}>
                    <SelectButton
                      compact
                      label="Exam Type"
                      value={shortType}
                      placeholder="Exam Type"
                      onPress={() =>
                        setPicker({
                          title: 'Select Exam Type',
                          selectedValue: row.examType,
                          options: typeOptions,
                          onSelect: (val) => updateRow(idx, { examType: val }),
                        })
                      }
                    />
                  </View>
                </View>
              );
            })}

            {error ? (
              <Caption style={{ color: '#ef4444', marginTop: 8 }}>{error}</Caption>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.secondaryBtn, { borderColor: colors.border, borderRadius: radii.md }]}
            >
              <Text variant="xs" weight="700">
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={saving}
              onPress={handleSaveAll}
              style={[styles.primaryBtn, { backgroundColor: colors.text, borderRadius: radii.md }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text variant="xs" weight="700" style={{ color: colors.background }}>
                  Save Schedule
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <OptionPickerModal config={picker} onClose={() => setPicker(null)} />
    </Modal>
  );
}

// ============================================================================
// 2. ADMIN CLASS PERIOD EDITOR MODAL (Tap-to-Open Pickers)
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
  routine: ClassRoutineModel | null;
  initialDay: string;
  initialSlotId: number | null;
  options: RoutineOptionsCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors, radii } = useTheme();
  const nonBreakSlots = useMemo(
    () => (routine?.slots || []).filter((s) => !s.is_break),
    [routine]
  );

  const [day, setDay] = useState(initialDay || 'Monday');
  const [slotId, setSlotId] = useState<number>(initialSlotId || nonBreakSlots[0]?.id || 0);
  const [classType, setClassType] = useState('Theory');
  const [subjectName, setSubjectName] = useState('');
  const [customSubject, setCustomSubject] = useState('');
  const [facultyName, setFacultyName] = useState('');
  const [customFaculty, setCustomFaculty] = useState('');
  const [facultyType, setFacultyType] = useState('FT');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<ActivePickerConfig | null>(null);

  const semesterSubjects = useMemo(() => {
    if (!routine) return [];
    const core = options.subjectsBySemester[routine.semester] || [];
    const electives = routine.semester >= 7 ? options.electives || [] : [];
    return [...core, ...electives];
  }, [routine, options]);

  const existingEntry = useMemo(() => {
    if (!routine) return null;
    return (
      routine.entries.find(
        (e) => e.day_of_week === day && Number(e.slot_id) === Number(slotId)
      ) || null
    );
  }, [routine, day, slotId]);

  useEffect(() => {
    if (!visible) return;
    setDay(WORKING_DAYS.includes(initialDay) ? initialDay : 'Monday');
    setSlotId(initialSlotId || nonBreakSlots[0]?.id || 0);
    setError('');
  }, [visible, initialDay, initialSlotId, nonBreakSlots]);

  useEffect(() => {
    if (!visible) return;
    if (existingEntry) {
      setClassType(existingEntry.is_empty ? 'Empty' : existingEntry.class_type || 'Theory');
      setFacultyType(existingEntry.faculty_type || 'FT');
      const matchedSub = semesterSubjects.find(
        (s) => s.title.toLowerCase() === (existingEntry.subject_name || '').toLowerCase()
      );
      if (matchedSub) {
        setSubjectName(matchedSub.title);
        setCustomSubject('');
      } else if (existingEntry.subject_name) {
        setSubjectName('__custom__');
        setCustomSubject(existingEntry.subject_name);
      } else {
        setSubjectName('');
        setCustomSubject('');
      }
      const matchedFac = options.teachers.find(
        (t) => t.toLowerCase() === (existingEntry.faculty_name || '').toLowerCase()
      );
      if (matchedFac) {
        setFacultyName(matchedFac);
        setCustomFaculty('');
      } else if (existingEntry.faculty_name) {
        setFacultyName('__custom__');
        setCustomFaculty(existingEntry.faculty_name);
      } else {
        setFacultyName('');
        setCustomFaculty('');
      }
    } else {
      setClassType('Theory');
      setSubjectName('');
      setCustomSubject('');
      setFacultyName('');
      setCustomFaculty('');
      setFacultyType('FT');
    }
  }, [visible, existingEntry, semesterSubjects, options.teachers]);

  if (!routine) return null;

  const hideSubjectDetails = classType === 'Break' || classType === 'Empty';
  const currentSlot = nonBreakSlots.find((s) => s.id === slotId);

  const handleSave = async () => {
    const finalSubject =
      classType === 'Empty'
        ? null
        : classType === 'Break'
          ? 'Break'
          : (subjectName === '__custom__' ? customSubject : subjectName).trim();

    if (!hideSubjectDetails && !finalSubject) {
      setError('Please choose a subject.');
      return;
    }

    const finalFaculty = hideSubjectDetails
      ? null
      : (facultyName === '__custom__' ? customFaculty : facultyName).trim() || null;

    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/api/routine/class/admin/${routine.id}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day_of_week: day,
          slot_id: slotId,
          subject_name: finalSubject,
          faculty_name: finalFaculty,
          faculty_type: hideSubjectDetails ? null : facultyType,
          class_type: classType,
          is_empty: classType === 'Empty',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save period.');
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save period.');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = () => {
    if (!existingEntry) return;
    Alert.alert('Clear Period', 'Remove the assigned class from this time slot?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            const res = await apiFetch(
              `/api/routine/class/admin/${routine.id}/entries/${existingEntry.id}`,
              { method: 'DELETE' }
            );
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || 'Could not clear period.');
            onSaved();
            onClose();
          } catch (err: any) {
            setError(err?.message || 'Could not clear period.');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg },
          ]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Caption color="muted" style={styles.eyebrow}>
                ADMIN · SEM {ROMANS[routine.semester - 1]} CLASS ROUTINE
              </Caption>
              <Heading level={3}>
                {existingEntry && !existingEntry.is_empty ? 'Edit Class Period' : 'Assign Class Period'}
              </Heading>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 10 }}>
              <View style={styles.twoCol}>
                <View style={{ flex: 1 }}>
                  <SelectButton
                    label="Day"
                    value={day}
                    placeholder="Select Day"
                    onPress={() =>
                      setPicker({
                        title: 'Select Day',
                        selectedValue: day,
                        options: WORKING_DAYS.map((d) => ({ value: d, label: d })),
                        onSelect: (val) => setDay(val),
                      })
                    }
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <SelectButton
                    label="Class Type"
                    value={classType}
                    placeholder="Type"
                    onPress={() =>
                      setPicker({
                        title: 'Select Class Type',
                        selectedValue: classType,
                        options: (options.classTypes || ['Theory', 'Practical', 'Lab', 'Break', 'Empty']).map(
                          (t) => ({ value: t, label: t })
                        ),
                        onSelect: (val) => setClassType(val),
                      })
                    }
                  />
                </View>
              </View>

              <SelectButton
                label="Time Slot (NPT)"
                value={currentSlot ? formatSlotNptLabel(currentSlot) : ''}
                placeholder="Select Time Slot"
                onPress={() =>
                  setPicker({
                    title: 'Select Time Slot (NPT)',
                    selectedValue: String(slotId),
                    options: nonBreakSlots.map((s) => ({
                      value: String(s.id),
                      label: formatSlotNptLabel(s),
                      sublabel: `${s.duration_minutes} min`,
                    })),
                    onSelect: (val) => setSlotId(Number(val)),
                  })
                }
              />

              {!hideSubjectDetails && (
                <>
                  <SelectButton
                    label={`Subject (Sem ${ROMANS[routine.semester - 1]})`}
                    value={subjectName === '__custom__' ? 'Custom Subject' : subjectName}
                    placeholder="Select Subject"
                    onPress={() =>
                      setPicker({
                        title: 'Select Subject',
                        selectedValue: subjectName,
                        options: [
                          ...semesterSubjects.map((s) => ({
                            value: s.title,
                            label: s.title,
                            sublabel: s.code || undefined,
                          })),
                          { value: '__custom__', label: '+ Custom Subject' },
                        ],
                        onSelect: (val) => setSubjectName(val),
                      })
                    }
                  />
                  {subjectName === '__custom__' && (
                    <TextInput
                      value={customSubject}
                      onChangeText={setCustomSubject}
                      placeholder="Enter custom subject name"
                      placeholderTextColor={colors.textSecondary}
                      style={[
                        styles.input,
                        { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                      ]}
                    />
                  )}

                  <View style={styles.twoCol}>
                    <View style={{ flex: 1.4 }}>
                      <SelectButton
                        label="Teacher"
                        value={facultyName === '__custom__' ? 'Custom Teacher' : facultyName}
                        placeholder="Optional"
                        onPress={() =>
                          setPicker({
                            title: 'Select Teacher',
                            selectedValue: facultyName,
                            options: [
                              { value: '', label: 'None' },
                              ...options.teachers.map((t) => ({ value: t, label: t })),
                              { value: '__custom__', label: '+ Custom Teacher' },
                            ],
                            onSelect: (val) => setFacultyName(val),
                          })
                        }
                      />
                    </View>
                    <View style={{ flex: 0.9 }}>
                      <SelectButton
                        label="Faculty Type"
                        value={facultyType}
                        placeholder="Type"
                        onPress={() =>
                          setPicker({
                            title: 'Select Faculty Type',
                            selectedValue: facultyType,
                            options: (options.facultyTypes || []).map((f) => ({
                              value: f.value,
                              label: f.label,
                            })),
                            onSelect: (val) => setFacultyType(val),
                          })
                        }
                      />
                    </View>
                  </View>

                  {facultyName === '__custom__' && (
                    <TextInput
                      value={customFaculty}
                      onChangeText={setCustomFaculty}
                      placeholder="Enter teacher name"
                      placeholderTextColor={colors.textSecondary}
                      style={[
                        styles.input,
                        { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
                      ]}
                    />
                  )}
                </>
              )}

              {error ? <Caption style={{ color: '#ef4444' }}>{error}</Caption> : null}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            {existingEntry ? (
              <TouchableOpacity
                disabled={saving}
                onPress={handleClear}
                style={[styles.dangerBtn, { borderRadius: radii.md }]}
              >
                <Text variant="xs" weight="700" style={{ color: '#ef4444' }}>
                  Clear
                </Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <TouchableOpacity
              disabled={saving}
              onPress={handleSave}
              style={[styles.primaryBtn, { backgroundColor: colors.text, borderRadius: radii.md }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text variant="xs" weight="700" style={{ color: colors.background }}>
                  Save Period
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <OptionPickerModal config={picker} onClose={() => setPicker(null)} />
    </Modal>
  );
}

// ============================================================================
// 3. ADMIN CREATE NEW CLASS ROUTINE MODAL (Tap-to-Open Pickers)
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
  const [semester, setSemester] = useState(initialSemester || 1);
  const [session, setSession] = useState(options.sessionPresets[2] || '2083 BS (Ashwin–Chaitra)');
  const [bsYear, setBsYear] = useState(2083);
  const [bsMonth, setBsMonth] = useState('06');
  const [bsDay, setBsDay] = useState('01');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<ActivePickerConfig | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSemester(initialSemester || 1);
    setError('');
  }, [visible, initialSemester]);

  const monthObj = (options.bsMonths || BS_MONTHS).find((m) => m.value === bsMonth);
  const maxDays = getBsDaysInMonth(bsYear, Number(bsMonth));

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/routine/class/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semester,
          academic_session: session,
          effective_date: `${bsYear}/${bsMonth}/${bsDay} BS`,
          status: 'published',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not create routine.');
      if (data?.routine?.id) {
        await apiFetch(`/api/routine/class/admin/${data.routine.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ replaceExisting: true }),
        });
      }
      onCreated(semester);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create routine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View
          style={[
            styles.sheetCard,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg },
          ]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Caption color="muted" style={styles.eyebrow}>
                ADMIN · NEW TIMETABLE
              </Caption>
              <Heading level={3}>Create Class Routine</Heading>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised }]}
            >
              <Ionicons name="close" size={18} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            <View style={{ gap: 10 }}>
              <SelectButton
                label="Semester"
                value={`Semester ${ROMANS[semester - 1]}`}
                placeholder="Select Semester"
                onPress={() =>
                  setPicker({
                    title: 'Select Semester',
                    selectedValue: String(semester),
                    options: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => ({
                      value: String(s),
                      label: `Semester ${ROMANS[s - 1]}`,
                    })),
                    onSelect: (val) => setSemester(Number(val)),
                  })
                }
              />

              <SelectButton
                label="Academic Session (BS)"
                value={session}
                placeholder="Select Session"
                onPress={() =>
                  setPicker({
                    title: 'Select Academic Session',
                    selectedValue: session,
                    options: (options.sessionPresets || []).map((s) => ({ value: s, label: s })),
                    onSelect: (val) => setSession(val),
                  })
                }
              />

              <View style={styles.threeCol}>
                <View style={{ flex: 1 }}>
                  <SelectButton
                    label="Year (BS)"
                    value={`${bsYear}`}
                    placeholder="Year"
                    onPress={() =>
                      setPicker({
                        title: 'Select BS Year',
                        selectedValue: String(bsYear),
                        options: (options.bsYears || BS_YEARS).map((y) => ({
                          value: String(y),
                          label: `${y} BS`,
                        })),
                        onSelect: (val) => setBsYear(Number(val)),
                      })
                    }
                  />
                </View>
                <View style={{ flex: 1.2 }}>
                  <SelectButton
                    label="Month (BS)"
                    value={monthObj ? monthObj.name : ''}
                    placeholder="Month"
                    onPress={() =>
                      setPicker({
                        title: 'Select BS Month',
                        selectedValue: bsMonth,
                        options: (options.bsMonths || BS_MONTHS).map((m) => ({
                          value: m.value,
                          label: m.name,
                          sublabel: m.nepali,
                        })),
                        onSelect: (val) => setBsMonth(val),
                      })
                    }
                  />
                </View>
                <View style={{ flex: 0.8 }}>
                  <SelectButton
                    label="Day"
                    value={String(Number(bsDay))}
                    placeholder="Day"
                    onPress={() =>
                      setPicker({
                        title: 'Select BS Day',
                        selectedValue: bsDay,
                        mode: 'day-grid',
                        options: Array.from({ length: maxDays }, (_, i) => {
                          const pad = String(i + 1).padStart(2, '0');
                          return { value: pad, label: String(i + 1) };
                        }),
                        onSelect: (val) => setBsDay(val),
                      })
                    }
                  />
                </View>
              </View>

              {error ? <Caption style={{ color: '#ef4444' }}>{error}</Caption> : null}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.secondaryBtn, { borderColor: colors.border, borderRadius: radii.md }]}
            >
              <Text variant="xs" weight="700">
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={saving}
              onPress={handleCreate}
              style={[styles.primaryBtn, { backgroundColor: colors.text, borderRadius: radii.md }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background} />
              ) : (
                <Text variant="xs" weight="700" style={{ color: colors.background }}>
                  Create & Publish
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <OptionPickerModal config={picker} onClose={() => setPicker(null)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.68)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    maxHeight: '90%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eyebrow: {
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topPickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  body: {
    marginBottom: 12,
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  selectBtnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: 1,
  },
  examSubjectCard: {
    padding: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  examSubjectHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  weekdayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  iconClearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  examPickerRow: {
    flexDirection: 'row',
    gap: 6,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 8,
  },
  threeCol: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 10,
  },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  secondaryBtn: {
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  dangerBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 20,
  },
  pickerCard: {
    borderWidth: 1,
    padding: 16,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayGridCell: {
    width: '12.6%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
