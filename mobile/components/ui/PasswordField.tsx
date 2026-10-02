import React, { useState, forwardRef } from 'react';
import { TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TextField, TextFieldProps } from './TextField';
import { useTheme } from '@/constants/useTheme';

export type PasswordFieldProps = Omit<TextFieldProps, 'rightNode'>;

export const PasswordField = forwardRef<TextInput, PasswordFieldProps>(function PasswordField(
  props,
  ref
) {
  const { colors, touchTarget } = useTheme();
  const [showPassword, setShowPassword] = useState(false);

  const toggleButton = (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
      activeOpacity={0.7}
      onPress={() => setShowPassword((prev) => !prev)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[
        styles.eyeButton,
        { width: touchTarget.min, height: touchTarget.min },
      ]}
    >
      <Ionicons
        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
        size={20}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  );

  return (
    <TextField
      ref={ref}
      secureTextEntry={!showPassword}
      autoCapitalize="none"
      autoCorrect={false}
      rightNode={toggleButton}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  eyeButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
