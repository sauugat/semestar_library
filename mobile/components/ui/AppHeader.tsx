import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBackPress?: () => void;
  leading?: React.ReactNode;
  rightAction?: React.ReactNode;
  centerTitle?: boolean;
  bordered?: boolean;
  style?: ViewStyle;
}

export function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBackPress,
  leading,
  rightAction,
  centerTitle = false,
  bordered = true,
  style,
}: AppHeaderProps) {
  const router = useRouter();
  const { colors, spacing, typography, touchTarget } = useTheme();

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      router.back();
    }
  };

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: colors.surface,
          borderBottomColor: bordered ? colors.border : 'transparent',
          borderBottomWidth: bordered ? StyleSheet.hairlineWidth : 0,
          paddingHorizontal: spacing.normal,
        },
        style,
      ]}
    >
      <View style={styles.leftContainer}>
        {leading ? (
          leading
        ) : showBack ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            activeOpacity={0.7}
            onPress={handleBack}
            style={[
              styles.iconButton,
              {
                minWidth: touchTarget.min,
                minHeight: touchTarget.min,
              },
            ]}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View
        style={[
          styles.titleContainer,
          centerTitle && styles.titleCentered,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            typography.lg,
            { color: colors.text },
            centerTitle && { textAlign: 'center' },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[
              styles.subtitle,
              typography.xs,
              { color: colors.textSecondary },
              centerTitle && { textAlign: 'center' },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.rightContainer}>
        {rightAction ? rightAction : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 44,
  },
  titleContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  titleCentered: {
    alignItems: 'center',
  },
  title: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  subtitle: {
    marginTop: 1,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minWidth: 44,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
