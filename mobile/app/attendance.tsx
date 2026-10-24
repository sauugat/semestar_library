import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/constants/useTheme';
import { EmptyState } from '@/components/ui/EmptyState';
import { resolveAppRole } from '@/utils/roles';
import { TeacherAttendanceView } from '@/components/teacher/TeacherAttendanceView';
import { StudentAttendanceView } from '@/components/student/StudentAttendanceView';

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user, isLoading } = useAuth();
  const appRole = resolveAppRole(user);
  const params = useLocalSearchParams<{
    subjectId?: string;
    subjectCode?: string;
    cohortId?: string;
    date?: string;
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
          description="Please sign in to your Semester Library account to access attendance."
          actionTitle="Sign In"
          onAction={() => router.replace('/login' as any)}
        />
      </View>
    );
  }

  if (appRole === 'student') {
    return <StudentAttendanceView onClose={handleClose} />;
  }

  if (appRole === 'teacher' || appRole === 'admin') {
    return (
      <TeacherAttendanceView
        initialSubjectId={params.subjectId || params.subjectCode}
        initialCohortId={params.cohortId}
        initialDate={params.date}
        onClose={handleClose}
      />
    );
  }

  return (
    <View style={[styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <EmptyState
        icon="alert-circle-outline"
        title="Access Restricted"
        description="Your account role is not authorized to access attendance."
        actionTitle="Go Back"
        onAction={handleClose}
      />
    </View>
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
