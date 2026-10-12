import React from 'react';
import { PagerTabs } from '@/components/navigation/PagerTabs';
import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { NavScrollProvider } from '@/context/NavScrollContext';
import { useAuth } from '@/context/AuthContext';

export default function TabLayout() {
  const { user } = useAuth();
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
            title: isTeacher ? 'Dashboard' : 'Home',
            headerShown: false,
            tabBarAccessibilityLabel: isTeacher ? 'Dashboard' : 'Home',
          }}
        />
        <PagerTabs.Screen
          name="library"
          options={{
            title: isTeacher ? 'My Materials' : 'Library',
            headerShown: false,
            tabBarAccessibilityLabel: isTeacher ? 'My Materials' : 'Library',
          }}
        />
        <PagerTabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            headerShown: false,
            tabBarAccessibilityLabel: 'Chat',
          }}
        />
        <PagerTabs.Screen
          name="games"
          options={{
            title: isTeacher ? 'Notices' : 'Games',
            headerShown: false,
            tabBarAccessibilityLabel: isTeacher ? 'Notices' : 'Games',
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
