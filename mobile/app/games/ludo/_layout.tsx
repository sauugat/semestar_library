import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '@/constants/useTheme';

export default function LudoLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: '700',
        },
        headerShadowVisible: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Ludo',
          headerBackTitle: 'Games',
        }}
      />
      <Stack.Screen
        name="setup"
        options={{
          title: 'New Offline Game',
          headerBackTitle: 'Ludo',
        }}
      />
      <Stack.Screen
        name="local"
        options={{
          title: 'Offline Match',
          headerBackTitle: 'Ludo',
        }}
      />
    </Stack>
  );
}
