import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  style?: ViewStyle;
}

export function BottomSheet({
  visible,
  onClose,
  children,
  style,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors, radii, spacing } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <TouchableWithoutFeedback>
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surface,
                  borderTopLeftRadius: radii.sheet,
                  borderTopRightRadius: radii.sheet,
                  borderColor: colors.border,
                  borderTopWidth: 1,
                  paddingBottom: Math.max(insets.bottom, spacing.normal),
                },
                style,
              ]}
            >
              {/* Drag Handle */}
              <View style={styles.handleContainer}>
                <View
                  style={[
                    styles.handle,
                    {
                      backgroundColor: colors.borderStrong,
                      borderRadius: radii.pill,
                    },
                  ]}
                />
              </View>

              {children}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '85%',
  },
  handleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 36,
    height: 4,
  },
});
