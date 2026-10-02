import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  right?: React.ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
  destructive?: boolean;
  showDivider?: boolean;
  style?: ViewStyle;
}

export function ListRow({
  title,
  subtitle,
  left,
  leftIcon,
  right,
  showChevron = false,
  onPress,
  destructive = false,
  showDivider = false,
  style,
}: ListRowProps) {
  const { colors, spacing, typography, touchTarget } = useTheme();

  const content = (
    <View
      style={[
        styles.row,
        {
          minHeight: touchTarget.comfortable,
          paddingVertical: spacing.compact,
          paddingHorizontal: spacing.normal,
          borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: colors.borderSubtle,
        },
        style,
      ]}
    >
      {left ? (
        <View style={styles.leftContainer}>{left}</View>
      ) : leftIcon ? (
        <View
          style={[
            styles.iconContainer,
            {
              backgroundColor: destructive ? colors.errorBg : colors.surfaceSubtle,
              borderRadius: 8,
              marginRight: spacing.compact,
            },
          ]}
        >
          <Ionicons
            name={leftIcon}
            size={18}
            color={destructive ? colors.error : colors.textSecondary}
          />
        </View>
      ) : null}

      <View style={styles.contentContainer}>
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            typography.md,
            { color: destructive ? colors.error : colors.text },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={2}
            style={[
              styles.subtitle,
              typography.sm,
              { color: colors.textSecondary, marginTop: 2 },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.rightContainer}>
        {right}
        {showChevron && (
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textMuted}
            style={{ marginLeft: 4 }}
          />
        )}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        accessibilityRole="button"
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftContainer: {
    marginRight: 12,
  },
  iconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontWeight: '600',
  },
  subtitle: {
    fontWeight: '400',
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
});
