import React from 'react';
import { View, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from './Typography';

export interface SearchSuggestionRowProps {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Shared Monochrome Search Suggestion Row for Home Search and Library Search.
 * Strictly complies with Semester Library Black / White / Gray design system:
 * - Icon container: #1C1C1E
 * - Icon: #D1D1D6
 * - Title: #FFFFFF (white)
 * - Description: #A1A1AA (gray)
 * - Chevron: #71717A (gray)
 * - Charcoal card surface: colors.surface
 */
export function SearchSuggestionRow({
  label,
  description,
  icon,
  onPress,
  style,
}: SearchSuggestionRowProps) {
  const { colors, radii } = useTheme();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radii.lg,
        },
        style,
      ]}
      activeOpacity={0.7}
      onPress={onPress}
      accessibilityLabel={`Search ${label}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: '#1C1C1E', borderRadius: radii.md }]}>
        <Ionicons name={icon} size={20} color="#D1D1D6" />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="sm" weight="700" style={{ color: '#FFFFFF' }}>
          {label}
        </Text>
        <Caption color="muted" numberOfLines={1} style={{ marginTop: 2, color: '#A1A1AA' }}>
          {description}
        </Caption>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#71717A" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
