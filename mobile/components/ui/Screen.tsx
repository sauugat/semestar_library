import React from 'react';
import { View, StyleSheet, ViewStyle, StatusBar as RNStatusBar } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/constants/useTheme';

export interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  edges?: Edge[];
  statusBarStyle?: 'light' | 'dark' | 'auto';
  backgroundColor?: string;
  withHorizontalPadding?: boolean;
}

/**
 * Standardized Screen container that guarantees safe-area compliance across
 * Android 3-button navigation, gesture bars, punch-hole cameras, and iOS notches.
 */
export function Screen({
  children,
  style,
  edges = ['top', 'left', 'right'],
  statusBarStyle,
  backgroundColor,
  withHorizontalPadding = false,
}: ScreenProps) {
  const { colors, isDark, spacing } = useTheme();

  const bg = backgroundColor ?? colors.background;
  const barStyle = statusBarStyle ?? (isDark ? 'light' : 'dark');

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.safeArea,
        { backgroundColor: bg },
        style,
      ]}
    >
      <StatusBar style={barStyle} />
      <View
        style={[
          styles.container,
          withHorizontalPadding && { paddingHorizontal: spacing.screenHorizontal },
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
});
