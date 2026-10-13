import React from 'react';
import { TabSwipeContainer } from '@/components/navigation/TabSwipeContainer';
import { ProfileView } from '@/components/ProfileView';
import { AdminProfileView } from '@/components/admin/AdminProfileView';
import { useAuth } from '@/context/AuthContext';
import { useAdminMode } from '@/context/AdminModeContext';
import { resolveAppRole } from '@/utils/roles';

export default function ProfileScreen() {
  const { user } = useAuth();
  const { isInAdminMode } = useAdminMode();
  const appRole = resolveAppRole(user);

  if (isInAdminMode) {
    return (
      <TabSwipeContainer tabIndex={4}>
        <AdminProfileView />
      </TabSwipeContainer>
    );
  }

  return (
    <TabSwipeContainer tabIndex={4}>
      <ProfileView isTab={true} />
    </TabSwipeContainer>
  );
}
