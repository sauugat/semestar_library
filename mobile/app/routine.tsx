import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useAuth } from '@/context/AuthContext';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { apiFetch } from '@/services/api';

const SEMESTER_NUMS = [1, 2, 3, 4, 5, 6, 7, 8];

interface RoutineEntry {
  id: number;
  semester: number;
  subject_name: string;
  subject_code?: string;
  exam_date?: string;
  calendar?: string;
  exam_time?: string;
  room?: string;
  weekday?: string;
  exam_type?: string;
}

const DEFAULT_CLASS_SCHEDULE: Record<number, RoutineEntry[]> = {
  1: [
    { id: 101, semester: 1, subject_name: 'C Programming', subject_code: 'BIT 101', exam_time: '06:30 AM - 08:00 AM', room: 'Hall 201', weekday: 'Sun - Thu' },
    { id: 102, semester: 1, subject_name: 'Digital Logic', subject_code: 'BIT 102', exam_time: '08:15 AM - 09:45 AM', room: 'Hall 203', weekday: 'Sun - Thu' },
    { id: 103, semester: 1, subject_name: 'Mathematics I', subject_code: 'MTH 101', exam_time: '10:00 AM - 11:30 AM', room: 'Hall 201', weekday: 'Mon - Fri' },
    { id: 104, semester: 1, subject_name: 'Computer Fundamentals', subject_code: 'BIT 103', exam_time: '11:45 AM - 01:15 PM', room: 'Lab 1', weekday: 'Tue & Thu' },
  ],
  2: [
    { id: 201, semester: 2, subject_name: 'Object Oriented Programming (C++)', subject_code: 'BIT 104', exam_time: '06:30 AM - 08:00 AM', room: 'Hall 202', weekday: 'Sun - Thu' },
    { id: 202, semester: 2, subject_name: 'Data Structures & Algorithms', subject_code: 'BIT 105', exam_time: '08:15 AM - 09:45 AM', room: 'Hall 204', weekday: 'Sun - Thu' },
    { id: 203, semester: 2, subject_name: 'Microprocessor Systems', subject_code: 'BIT 106', exam_time: '10:00 AM - 11:30 AM', room: 'Lab 2', weekday: 'Sun - Wed' },
    { id: 204, semester: 2, subject_name: 'Mathematics II (Discrete Structures)', subject_code: 'MTH 102', exam_time: '11:45 AM - 01:15 PM', room: 'Hall 202', weekday: 'Mon - Fri' },
  ],
};

export default function RoutineScreen() {
  const { colors, spacing, radii } = useTheme();
  const { user } = useAuth();

  // Determine user semester number from user.semester (e.g. "Semester 2" -> 2)
  const initialSem = (() => {
    const match = (user?.semester || '').match(/\d+/);
    return match ? Number(match[0]) : 1;
  })();

  const [selectedSem, setSelectedSem] = useState<number>(initialSem);
  const [routines, setRoutines] = useState<RoutineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRoutine = useCallback(async (sem: number) => {
    try {
      const res = await apiFetch(`/api/routine?semester=${sem}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setRoutines(data);
          return;
        }
      }
      // Fallback to standard semester schedule if database routine is empty
      setRoutines(DEFAULT_CLASS_SCHEDULE[sem] || []);
    } catch (err) {
      console.warn('Routine fetch error:', err);
      setRoutines(DEFAULT_CLASS_SCHEDULE[sem] || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRoutine(selectedSem);
  }, [selectedSem, fetchRoutine]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchRoutine(selectedSem);
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <View style={{ marginBottom: spacing.md }}>
        <Heading style={{ fontSize: 22 }}>Academic Routine</Heading>
        <Caption color="muted">Class Schedules & Examination Timetables</Caption>
      </View>

      {/* Semester Selector Horizontal Scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingBottom: 6 }}
        style={{ marginBottom: spacing.md }}
      >
        {SEMESTER_NUMS.map((sem) => {
          const isSelected = selectedSem === sem;
          return (
            <TouchableOpacity
              key={sem}
              activeOpacity={0.7}
              onPress={() => setSelectedSem(sem)}
              style={[
                styles.semPill,
                {
                  backgroundColor: isSelected ? colors.primary : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.border,
                  borderRadius: radii.full,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                },
              ]}
            >
              <Text
                variant="sm"
                weight="700"
                style={{
                  color: isSelected ? colors.primaryText : colors.text,
                }}
              >
                Sem {sem}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Subheading style={{ marginBottom: spacing.sm }}>
        Semester {selectedSem} Schedule ({routines.length} {routines.length === 1 ? 'Subject' : 'Subjects'})
      </Subheading>

      {loading ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="sm" color="muted" style={{ marginTop: 12 }}>
            Loading routine…
          </Text>
        </View>
      ) : routines.length === 0 ? (
        <Card variant="elevated" padding="lg" style={{ alignItems: 'center', marginVertical: 20 }}>
          <Ionicons name="calendar-outline" size={32} color={colors.textMuted} style={{ marginBottom: 8 }} />
          <Text variant="md" weight="700">No Routine Published</Text>
          <Caption color="muted" style={{ textAlign: 'center', marginTop: 4 }}>
            Routine for Semester {selectedSem} has not been published by the administration yet.
          </Caption>
        </Card>
      ) : (
        routines.map((item) => (
          <Card
            key={item.id}
            variant="elevated"
            padding="md"
            style={[styles.routineCard, { borderColor: colors.border, marginBottom: spacing.sm }]}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="time-outline" size={15} color={colors.primary} style={{ marginRight: 6 }} />
                <Text variant="xs" color="primary" weight="700">
                  {item.exam_time || 'Time TBA'}
                </Text>
              </View>

              {item.subject_code ? (
                <View
                  style={[
                    styles.codeBadge,
                    { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                  ]}
                >
                  <Text variant="xs" weight="700" color="secondary">
                    {item.subject_code}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text variant="md" weight="700" style={{ marginBottom: 4 }}>
              {item.subject_name}
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
              {item.room ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="business-outline" size={13} color={colors.textSecondary} style={{ marginRight: 4 }} />
                  <Caption color="secondary">{item.room}</Caption>
                </View>
              ) : null}

              {(item.weekday || item.exam_date) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} style={{ marginRight: 4 }} />
                  <Caption color="secondary">{item.exam_date || item.weekday}</Caption>
                </View>
              ) : null}

              {item.exam_type ? (
                <View
                  style={[
                    styles.codeBadge,
                    { backgroundColor: colors.primaryLight, borderColor: colors.primary },
                  ]}
                >
                  <Text variant="xs" weight="700" color="primary">
                    {item.exam_type}
                  </Text>
                </View>
              ) : null}
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  semPill: {
    borderWidth: 1,
  },
  routineCard: {
    borderRadius: 14,
    borderWidth: 1,
  },
  codeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
});
