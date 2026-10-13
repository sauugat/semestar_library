import React from 'react';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { GamesView } from '@/components/games/GamesView';
import { TeacherNoticesView } from '@/components/teacher/TeacherNoticesView';
import { AdminContentView } from '@/components/admin/AdminContentView';
import { UnrecognizedRoleView } from '@/components/admin/UnrecognizedRoleView';
import { useAuth } from '@/context/AuthContext';
import { useAdminMode } from '@/context/AdminModeContext';
import { resolveAppRole } from '@/utils/roles';

export default function GamesScreen() {
  const { user } = useAuth();
  const { isInAdminMode } = useAdminMode();
  const appRole = resolveAppRole(user);

  const isTeacher = appRole === 'teacher';

  if (isInAdminMode) {
    return (
      <TabSwipeContainer tabIndex={3}>
        <AdminContentView />
      </TabSwipeContainer>
    );
  }

  if (appRole === 'unknown') {
    return <UnrecognizedRoleView />;
  }

  return (
    <TabSwipeContainer tabIndex={3}>
      {isTeacher ? <TeacherNoticesView /> : <GamesView />}
    </TabSwipeContainer>
  );
}
