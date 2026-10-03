import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ProfileView } from '@/components/ProfileView';

export default function StudentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileView targetStudentId={id} isTab={false} />;
}
