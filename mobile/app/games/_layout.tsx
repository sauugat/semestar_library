import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '@/constants/useTheme';

export default function GamesLayout() {
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
          title: 'Games',
          headerBackTitle: 'Home',
        }}
      />
      <Stack.Screen
        name="tic-tac-toe"
        options={{
          title: 'Tic Tac Toe',
          headerBackTitle: 'Games',
        }}
      />
    </Stack>
  );
}
