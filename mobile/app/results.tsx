import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { EmptyState } from '@/components/ui/EmptyState';
import { resolveAppRole } from '@/utils/roles';
import { StudentResultsView } from '@/components/student/StudentResultsView';
import { TeacherMarksView } from '@/components/teacher/TeacherMarksView';

export default function ResultsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, isLoading } = useAuth();
  const appRole = resolveAppRole(user);
  const params = useLocalSearchParams<{
    semester?: string;
    subjectId?: string;
  }>();

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/library' as any);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.text} />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={[styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <EmptyState
          icon="lock-closed-outline"
          title="Sign In Required"
          description="Please sign in to view your academic results and grades."
          actionTitle="Sign In"
          onAction={() => router.replace('/login' as any)}
        />
      </View>
    );
  }

  if (appRole === 'teacher' || appRole === 'admin') {
    return (
      <TeacherMarksView
        initialSubjectId={params.subjectId}
        onClose={handleClose}
      />
    );
  }

  return (
    <StudentResultsView
      initialSemester={params.semester ? Number(params.semester) : undefined}
      onClose={handleClose}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
