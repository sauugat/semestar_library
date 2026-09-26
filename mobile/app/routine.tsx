import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const MOCK_ROUTINE = [
  { time: '06:30 AM - 08:00 AM', subject: 'C Programming (Theory)', room: 'Hall 201', teacher: 'Er. Saugat Subedi' },
  { time: '08:15 AM - 09:45 AM', subject: 'Digital Logic', room: 'Hall 203', teacher: 'Prof. Bhandari' },
  { time: '10:00 AM - 12:00 PM', subject: 'C Programming Lab', room: 'Computer Lab 2', teacher: 'Lab Instructor' },
];

export default function RoutineScreen() {
  const { colors, spacing, radii } = useTheme();
  const [selectedDay, setSelectedDay] = useState('Sun');

  return (
    <ScrollView contentContainerStyle={[styles.container, { padding: spacing.md, backgroundColor: colors.background }]}>
      {/* Day Selector */}
      <View style={[styles.dayRow, { marginBottom: spacing.md }]}>
        {DAYS.map((day) => (
          <TouchableOpacity
            key={day}
            onPress={() => setSelectedDay(day)}
            style={[
              styles.dayPill,
              {
                backgroundColor: selectedDay === day ? colors.primary : colors.surface,
                borderColor: selectedDay === day ? colors.primary : colors.border,
                borderRadius: radii.md,
                paddingVertical: spacing.sm,
              },
            ]}
          >
            <Text
              variant="sm"
              weight="700"
              style={{ color: selectedDay === day ? '#FFFFFF' : colors.text, textAlign: 'center' }}
            >
              {day}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Subheading style={{ marginBottom: spacing.sm }}>Classes for {selectedDay}day</Subheading>

      {MOCK_ROUTINE.map((item, idx) => (
        <Card key={idx} variant="elevated" padding="md" style={{ marginBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}>
            <Ionicons name="time-outline" size={16} color={colors.primary} style={{ marginRight: spacing.xs }} />
            <Text variant="sm" color="accent" weight="700">
              {item.time}
            </Text>
          </View>
          <Text variant="md" weight="700" style={{ marginBottom: 2 }}>
            {item.subject}
          </Text>
          <Caption color="secondary">
            Room: {item.room} • {item.teacher}
          </Caption>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayPill: {
    flex: 1,
    marginHorizontal: 3,
    borderWidth: 1,
  },
});
