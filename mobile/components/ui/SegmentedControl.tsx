import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { useTheme } from '@/constants/useTheme';

export interface SegmentItem {
  key: string;
  label: string;
  count?: number;
}

export interface SegmentedControlProps {
  items: SegmentItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  style?: ViewStyle;
}

export function SegmentedControl({
  items,
  selectedKey,
  onSelect,
  style,
}: SegmentedControlProps) {
  const { colors, radii, spacing, typography, touchTarget } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceSubtle,
          borderRadius: radii.button + 2,
          padding: 3,
          minHeight: touchTarget.min,
        },
        style,
      ]}
    >
      {items.map((item) => {
        const isSelected = item.key === selectedKey;
        return (
          <TouchableOpacity
            key={item.key}
            activeOpacity={0.8}
            onPress={() => onSelect(item.key)}
            style={[
              styles.segment,
              {
                borderRadius: radii.button,
                backgroundColor: isSelected ? colors.surfaceRaised : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                styles.label,
                typography.sm,
                {
                  color: isSelected ? colors.text : colors.textMuted,
                  fontWeight: isSelected ? '700' : '500',
                },
              ]}
            >
              {item.label}
            </Text>
            {typeof item.count === 'number' && item.count > 0 && (
              <View
                style={[
                  styles.countBadge,
                  {
                    backgroundColor: isSelected ? colors.primaryText : colors.surface,
                    borderRadius: radii.pill,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countText,
                    typography.xs,
                    {
                      color: isSelected ? colors.primary : colors.textSecondary,
                    },
                  ]}
                >
                  {item.count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  label: {
    textAlign: 'center',
  },
  countBadge: {
    marginLeft: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
