import React, { useState, forwardRef, useRef } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  TextInputProps,
  TouchableOpacity,
  ViewStyle,
  NativeSyntheticEvent,
  TextInputFocusEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { useKeyboardAwareForm } from './KeyboardAwareForm';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
  helper?: string;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightNode?: React.ReactNode;
  containerStyle?: ViewStyle;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  {
    label,
    error,
    helper,
    leftIcon,
    rightNode,
    containerStyle,
    style,
    onFocus,
    onBlur,
    ...props
  },
  ref
) {
  const { colors, spacing, radii, typography, touchTarget } = useTheme();
  const { onInputFocus, onInputBlur } = useKeyboardAwareForm();
  const [isFocused, setIsFocused] = useState(false);
  const containerRef = useRef<View>(null);

  const handleFocus = (e: any) => {
    setIsFocused(true);
    onFocus?.(e);
    if (containerRef.current) {
      onInputFocus?.(containerRef.current);
    }
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    onBlur?.(e);
    onInputBlur?.();
  };

  const borderColor = error
    ? colors.error
    : isFocused
    ? colors.inputFocusBorder
    : colors.inputBorder;

  return (
    <View
      ref={containerRef}
      collapsable={false}
      style={[styles.container, { marginBottom: spacing.normal }, containerStyle]}
    >
      {label && (
        <Text
          style={[
            styles.label,
            typography.sm,
            { color: colors.textSecondary, marginBottom: spacing.tight },
          ]}
        >
          {label}
        </Text>
      )}

      <View
        style={[
          styles.inputWrapper,
          {
            minHeight: touchTarget.comfortable,
            backgroundColor: colors.inputBackground,
            borderColor,
            borderRadius: radii.input,
            paddingHorizontal: spacing.compact,
          },
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={18}
            color={error ? colors.error : isFocused ? colors.primary : colors.textMuted}
            style={{ marginRight: spacing.tight }}
          />
        )}

        <TextInput
          ref={ref}
          placeholderTextColor={colors.textMuted}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            typography.md,
            { color: colors.text },
            style,
          ]}
          {...props}
        />

        {rightNode}
      </View>

      {error ? (
        <Text style={[styles.message, typography.xs, { color: colors.error, marginTop: spacing.micro }]}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[styles.message, typography.xs, { color: colors.textMuted, marginTop: spacing.micro }]}>
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
    borderWidth: 1,
  },
  input: {
    flex: 1,
    paddingVertical: 10,
  },
  message: {
    fontWeight: '500',
  },
});
