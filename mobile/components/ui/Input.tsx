import React, { useState, forwardRef, useRef } from 'react';
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
import { useKeyboardAwareForm } from './KeyboardAwareForm';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  isPassword?: boolean;
  containerStyle?: ViewStyle;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    helper,
    leftIcon,
    isPassword = false,
    containerStyle,
    style,
    ...props
  },
  ref
) {
  const { colors, spacing, radii, typography } = useTheme();
  const { onInputFocus, onInputBlur } = useKeyboardAwareForm();
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const containerRef = useRef<View>(null);

  return (
    <View
      ref={containerRef}
      collapsable={false}
      style={[styles.container, { marginBottom: spacing.md }, containerStyle]}
    >
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
            paddingHorizontal: 12,
          },
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={18}
            color={error ? colors.error : isFocused ? colors.primary : colors.textMuted}
            style={{ marginRight: 8 }}
          />
        )}

        <TextInput
          ref={ref}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPassword && !showPassword}
          {...props}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
            if (containerRef.current) {
              onInputFocus?.(containerRef.current);
            }
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
            onInputBlur?.();
          }}
          style={[
            styles.input,
            { color: colors.text, fontSize: 15 },
            style,
          ]}
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
});

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
