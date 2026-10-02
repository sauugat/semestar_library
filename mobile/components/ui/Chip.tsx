import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  count?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export function Chip({
  label,
  selected = false,
  onPress,
  count,
  icon,
  size = 'md',
  style,
}: ChipProps) {
  const { colors, radii, spacing, typography, touchTarget } = useTheme();

  const isSm = size === 'sm';

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      activeOpacity={0.7}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      style={[
        styles.chip,
        {
          minHeight: isSm ? 34 : Math.min(touchTarget.min, 40),
          borderRadius: radii.pill,
          backgroundColor: selected ? colors.primary : colors.surfaceSubtle,
          borderColor: selected ? colors.primary : colors.border,
          paddingHorizontal: isSm ? spacing.tight + 2 : spacing.compact + 2,
        },
        style,
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={isSm ? 14 : 16}
          color={selected ? colors.primaryText : colors.textSecondary}
          style={{ marginRight: 6 }}
        />
      )}
      <Text
        style={[
          styles.label,
          isSm ? typography.xs : typography.sm,
          {
            color: selected ? colors.primaryText : colors.text,
            fontWeight: selected ? '700' : '500',
          },
        ]}
      >
        {label}
      </Text>
      {typeof count === 'number' && (
        <View
          style={[
            styles.countBadge,
            {
              backgroundColor: selected ? colors.primaryText : colors.surfaceRaised,
              borderRadius: radii.pill,
            },
          ]}
        >
          <Text
            style={[
              typography.xs,
              {
                fontSize: 10,
                color: selected ? colors.primary : colors.textMuted,
                fontWeight: '700',
              },
            ]}
          >
            {count}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 8,
  },
  label: {
    textAlign: 'center',
  },
  countBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});
