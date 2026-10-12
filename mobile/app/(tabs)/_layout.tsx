import React from 'react';
import { PagerTabs } from '@/components/navigation/PagerTabs';
import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { NavScrollProvider } from '@/context/NavScrollContext';
import { useAuth } from '@/context/AuthContext';
import { resolveAppRole } from '@/utils/roles';

export default function TabLayout() {
  const { user } = useAuth();
  const appRole = resolveAppRole(user);
  const isTeacher = user?.role === 'teacher' || user?.role === 'faculty';
  const isAdmin = appRole === 'admin';

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
            title: isAdmin ? 'Dashboard' : isTeacher ? 'Dashboard' : 'Home',
            headerShown: false,
            tabBarAccessibilityLabel: isAdmin ? 'Dashboard' : isTeacher ? 'Dashboard' : 'Home',
          }}
        />
        <PagerTabs.Screen
          name="library"
          options={{
            title: isAdmin ? 'Users' : isTeacher ? 'My Materials' : 'Library',
            headerShown: false,
            tabBarAccessibilityLabel: isAdmin ? 'Users' : isTeacher ? 'My Materials' : 'Library',
          }}
        />
        <PagerTabs.Screen
          name="chat"
          options={{
            title: isAdmin ? 'Academics' : 'Chat',
            headerShown: false,
            tabBarAccessibilityLabel: isAdmin ? 'Academics' : 'Chat',
          }}
        />
        <PagerTabs.Screen
          name="games"
          options={{
            title: isAdmin ? 'Content' : isTeacher ? 'Notices' : 'Games',
            headerShown: false,
            tabBarAccessibilityLabel: isAdmin ? 'Content' : isTeacher ? 'Notices' : 'Games',
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
