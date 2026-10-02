import React, { createContext, useContext, forwardRef } from 'react';
import {
  Keyboard,
  StyleProp,
  ViewStyle,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  KeyboardAwareScrollView,
  KeyboardAwareScrollViewProps,
  KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

/**
 * ============================================================================
 * TEXT INPUT RULE (PERMANENT ARCHITECTURE RULE):
 * ============================================================================
 * No user-facing TextInput, TextField, PasswordField, multiline editor,
 * search box, chat composer, or comment composer may ever be added in a fixed
 * layout without the shared keyboard primitives.
 *
 * Use:
 * - Forms / long input pages:
 *     -> KeyboardAwareForm backed by KeyboardAwareScrollView
 * - Chat / comments / sticky footers:
 *     -> KeyboardStickyView (from react-native-keyboard-controller)
 * - Simple isolated input:
 *     -> Compatible keyboard-aware container when needed
 *
 * RULE: When an input is focused, the ENTIRE field must remain visible above the
 * keyboard (label, border, typed text/caret, password eye, and validation/error).
 * Chaining focus (Next / Done) must remain seamless.
 * ============================================================================
 */

export interface KeyboardAwareFormContextType {
  registerInput?: (id: string, layout: { y: number; height: number }) => void;
  onInputFocused?: (idOrNode: any) => void;
  onInputFocus?: (node: any) => void;
  onInputBlur?: () => void;
}

const KeyboardAwareFormContext = createContext<KeyboardAwareFormContextType>({
  registerInput: () => {},
  onInputFocused: () => {},
  onInputFocus: () => {},
  onInputBlur: () => {},
});

export const useKeyboardAwareForm = () => useContext(KeyboardAwareFormContext);

export interface KeyboardAwareFormProps extends KeyboardAwareScrollViewProps {
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  clearance?: number; // Distance in dp between keyboard top and focused input (default: 28)
  dismissKeyboardOnTap?: boolean;
}

/**
 * Enterprise-grade KeyboardAwareForm for Semester Library.
 * Backed by react-native-keyboard-controller's native KeyboardAwareScrollView.
 * Provides native 60fps/120fps keyboard-synchronized scrolling, full caret/field
 * visibility, and zero ad-hoc listener conflicts.
 */
export const KeyboardAwareForm = forwardRef<KeyboardAwareScrollViewRef, KeyboardAwareFormProps>(
  function KeyboardAwareForm(
    {
      children,
      contentContainerStyle,
      style,
      clearance = 28,
      bottomOffset,
      dismissKeyboardOnTap = true,
      keyboardShouldPersistTaps = 'handled',
      showsVerticalScrollIndicator = false,
      extraKeyboardSpace = 0,
      ...restProps
    },
    ref
  ) {
    const effectiveBottomOffset = bottomOffset !== undefined ? bottomOffset : clearance;

    const content = (
      <KeyboardAwareScrollView
        ref={ref}
        style={[{ flex: 1 }, style]}
        contentContainerStyle={contentContainerStyle}
        bottomOffset={effectiveBottomOffset}
        extraKeyboardSpace={extraKeyboardSpace}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        {...restProps}
      >
        {children}
      </KeyboardAwareScrollView>
    );

    return (
      <KeyboardAwareFormContext.Provider
        value={{
          registerInput: () => {},
          onInputFocused: () => {},
          onInputFocus: () => {},
          onInputBlur: () => {},
        }}
      >
        {dismissKeyboardOnTap ? (
          <TouchableWithoutFeedback
            onPress={() => Keyboard.dismiss()}
            accessible={false}
          >
            <View style={{ flex: 1 }} collapsable={false}>
              {content}
            </View>
          </TouchableWithoutFeedback>
        ) : (
          content
        )}
      </KeyboardAwareFormContext.Provider>
    );
  }
);
