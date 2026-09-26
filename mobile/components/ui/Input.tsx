import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  isPassword?: boolean;
  containerStyle?: ViewStyle;
}

export function Input({
  label,
  error,
  helper,
  leftIcon,
  isPassword = false,
  containerStyle,
  style,
  ...props
}: InputProps) {
  const { colors, spacing, radii, typography } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <View style={[styles.container, { marginBottom: spacing.md }, containerStyle]}>
      {label && (
        <Text style={[styles.label, typography.sm, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
          {label}
        </Text>
      )}

      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: colors.surfaceSubtle,
            borderColor: error ? colors.error : isFocused ? colors.primary : colors.border,
            borderRadius: radii.md,
            paddingHorizontal: spacing.md,
          },
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={18}
            color={error ? colors.error : isFocused ? colors.primary : colors.textMuted}
            style={{ marginRight: spacing.sm }}
          />
        )}

        <TextInput
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPassword && !showPassword}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={[
            styles.input,
            typography.md,
            { color: colors.text },
            style,
          ]}
          {...props}
        />

        {isPassword && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowPassword(!showPassword)}
            style={{ padding: spacing.xs }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <Text style={[styles.error, typography.xs, { color: colors.error, marginTop: spacing.xs }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[styles.helper, typography.xs, { color: colors.textMuted, marginTop: spacing.xs }]}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontWeight: '600',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.2,
    minHeight: 48,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
  },
  error: {
    fontWeight: '500',
  },
  helper: {},
});
