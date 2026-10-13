import React from 'react';
import { PagerTabs } from '@/components/navigation/PagerTabs';
import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { NavScrollProvider } from '@/context/NavScrollContext';
import { useAuth } from '@/context/AuthContext';
import { useAdminMode } from '@/context/AdminModeContext';
import { resolveAppRole } from '@/utils/roles';

export default function TabLayout() {
  const { user } = useAuth();
  const { isInAdminMode } = useAdminMode();
  const appRole = resolveAppRole(user);
  const isTeacher = user?.role === 'teacher' || user?.role === 'faculty';

  return (
    <NavScrollProvider>
      <PagerTabs
        tabBar={(props: any) => <FloatingTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <PagerTabs.Screen
          name="index"
          options={{
            title: isInAdminMode ? 'Dashboard' : isTeacher ? 'Dashboard' : 'Home',
            headerShown: false,
            tabBarAccessibilityLabel: isInAdminMode ? 'Dashboard' : isTeacher ? 'Dashboard' : 'Home',
          }}
        />
        <PagerTabs.Screen
          name="library"
          options={{
            title: isInAdminMode ? 'Users' : isTeacher ? 'My Materials' : 'Library',
            headerShown: false,
            tabBarAccessibilityLabel: isInAdminMode ? 'Users' : isTeacher ? 'My Materials' : 'Library',
          }}
        />
        <PagerTabs.Screen
          name="chat"
          options={{
            title: isInAdminMode ? 'Academics' : 'Chat',
            headerShown: false,
            tabBarAccessibilityLabel: isInAdminMode ? 'Academics' : 'Chat',
          }}
        />
        <PagerTabs.Screen
          name="games"
          options={{
            title: isInAdminMode ? 'Content' : isTeacher ? 'Notices' : 'Games',
            headerShown: false,
            tabBarAccessibilityLabel: isInAdminMode ? 'Content' : isTeacher ? 'Notices' : 'Games',
          }}
        />
        <PagerTabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            headerShown: false,
            tabBarAccessibilityLabel: 'Profile',
          }}
        />
      </PagerTabs>
    </NavScrollProvider>
  );
}
