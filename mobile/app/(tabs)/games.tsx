import React from 'react';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { GamesView } from '@/components/games/GamesView';
import { TeacherNoticesView } from '@/components/teacher/TeacherNoticesView';
import { useAuth } from '@/context/AuthContext';

export default function GamesScreen() {
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher' || user?.role === 'faculty';

  return (
    <TabSwipeContainer tabIndex={3}>
      {isTeacher ? <TeacherNoticesView /> : <GamesView />}
    </TabSwipeContainer>
  );
}
