import React, { forwardRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

export interface SearchFieldProps extends TextInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
  loading?: boolean;
  pill?: boolean;
  containerStyle?: ViewStyle;
}

export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField(
  {
    value,
    onChangeText,
    onClear,
    loading = false,
    pill = true,
    placeholder = 'Search materials, posts, notices...',
    containerStyle,
    style,
    ...props
  },
  ref
) {
  const { colors, radii, spacing, typography, touchTarget } = useTheme();

  const handleClear = () => {
    onChangeText('');
    onClear?.();
  };

  return (
    <View
      style={[
        styles.container,
        {
          minHeight: touchTarget.comfortable,
          backgroundColor: colors.inputBackground,
          borderColor: colors.inputBorder,
          borderRadius: pill ? radii.pill : radii.input,
          paddingHorizontal: spacing.compact,
        },
        containerStyle,
      ]}
    >
      <Ionicons
        name="search-outline"
        size={18}
        color={colors.textMuted}
        style={{ marginRight: spacing.tight }}
      />

      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never" // We provide our own cross-platform touchable clear button
        style={[
          styles.input,
          typography.md,
          { color: colors.text },
          style,
        ]}
        {...props}
      />

      {loading ? (
        <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginLeft: 4 }} />
      ) : value ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Clear search input"
          activeOpacity={0.7}
          onPress={handleClear}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.clearButton}
        >
          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    width: '100%',
  },
  input: {
    flex: 1,
    paddingVertical: 10,
  },
  clearButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
