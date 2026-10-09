import React from 'react';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { ProfileView } from '@/components/ProfileView';

export default function ProfileScreen() {
  return (
    <TabSwipeContainer tabIndex={4}>
      <ProfileView isTab={true} />
    </TabSwipeContainer>
  );
}
