import React from 'react';
import { PagerTabs } from '@/components/navigation/PagerTabs';
import { FloatingTabBar } from '@/components/navigation/FloatingTabBar';
import { NavScrollProvider } from '@/context/NavScrollContext';

export default function TabLayout() {
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
            title: 'Home',
            headerShown: false,
            tabBarAccessibilityLabel: 'Home',
          }}
        />
        <PagerTabs.Screen
          name="library"
          options={{
            title: 'Library',
            headerShown: false,
            tabBarAccessibilityLabel: 'Library',
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
            title: 'Games',
            headerShown: false,
            tabBarAccessibilityLabel: 'Games',
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
