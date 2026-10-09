import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';
import { Button } from '@/components/ui/Button';

export interface SemesterMultiSelectSheetProps {
  visible: boolean;
  onClose: () => void;
  selectedSemesters: number[];
  allSemesters: boolean;
  onApply: (result: { allSemesters: boolean; semesters: number[] }) => void;
}

const AVAILABLE_SEMESTERS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Enterprise-grade monochrome Semester Multi-Select Sheet.
 * Respects strict monochrome design system (Black, White, Charcoal, Gray).
 */
export function SemesterMultiSelectSheet({
  visible,
  onClose,
  selectedSemesters: initialSemesters,
  allSemesters: initialAll,
  onApply,
}: SemesterMultiSelectSheetProps) {
  const insets = useSafeAreaInsets();
  const { colors, radii } = useTheme();

  const [isAll, setIsAll] = useState(initialAll ?? true);
  const [selectedList, setSelectedList] = useState<number[]>(initialSemesters || []);

  useEffect(() => {
    if (visible) {
      setIsAll(initialAll ?? true);
      setSelectedList(initialSemesters || []);
    }
  }, [visible, initialAll, initialSemesters]);

  const toggleAll = () => {
    // If tapping All Semesters, check it and clear individual selections
    setIsAll(true);
    setSelectedList([]);
  };

  const toggleSemester = (sem: number) => {
    if (isAll) {
      // Switching from All Semesters to a specific semester
      setIsAll(false);
      setSelectedList([sem]);
    } else {
      if (selectedList.includes(sem)) {
        const next = selectedList.filter((s) => s !== sem);
        if (next.length === 0) {
          // Empty selection is never allowed: revert to All Semesters
          setIsAll(true);
          setSelectedList([]);
        } else {
          setSelectedList(next);
        }
      } else {
        const next = [...selectedList, sem].sort((a, b) => a - b);
        // If all 8 are selected, canonicalize to All Semesters
        if (next.length === AVAILABLE_SEMESTERS.length) {
          setIsAll(true);
          setSelectedList([]);
        } else {
          setSelectedList(next);
        }
      }
    }
  };

  const handleApply = () => {
    if (isAll || selectedList.length === 0) {
      onApply({ allSemesters: true, semesters: [] });
    } else {
      onApply({ allSemesters: false, semesters: [...selectedList].sort((a, b) => a - b) });
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={[
                styles.sheetContainer,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                  paddingBottom: Math.max(insets.bottom, 16),
                },
              ]}
            >
              {/* Top Drag Indicator */}
              <View style={styles.dragHandleContainer}>
                <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />
              </View>

              {/* Sheet Header */}
              <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <Text variant="md" weight="700" color="primary">
                  Select Semesters
                </Text>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={[styles.closeBtn, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
                  accessibilityLabel="Close"
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Semesters Options List */}
              <ScrollView
                style={styles.optionsList}
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
                keyboardShouldPersistTaps="handled"
              >
                {/* 1. All Semesters Row */}
                <TouchableOpacity
                  style={[
                    styles.optionRow,
                    isAll && [styles.optionRowSelected, { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong }],
                  ]}
                  onPress={toggleAll}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isAll }}
                >
                  <View
                    style={[
                      styles.checkboxBox,
                      {
                        borderColor: isAll ? colors.text : colors.border,
                        backgroundColor: isAll ? colors.text : 'transparent',
                      },
                    ]}
                  >
                    {isAll && (
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color={colors.background}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text
                      variant="sm"
                      weight={isAll ? '700' : '500'}
                      style={{ color: isAll ? colors.text : colors.textSecondary }}
                    >
                      All Semesters
                    </Text>
                    <Text variant="xs" color="muted" style={{ marginTop: 2 }}>
                      Publish post for everyone across campus
                    </Text>
                  </View>
                </TouchableOpacity>

                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                {/* 2. Individual Semesters */}
                {AVAILABLE_SEMESTERS.map((sem) => {
                  const checked = !isAll && selectedList.includes(sem);
                  return (
                    <TouchableOpacity
                      key={sem}
                      style={[
                        styles.optionRow,
                        checked && [styles.optionRowSelected, { backgroundColor: colors.surfaceRaised, borderColor: colors.borderStrong }],
                      ]}
                      onPress={() => toggleSemester(sem)}
                      activeOpacity={0.7}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                    >
                      <View
                        style={[
                          styles.checkboxBox,
                          {
                            borderColor: checked ? colors.text : colors.border,
                            backgroundColor: checked ? colors.text : 'transparent',
                          },
                        ]}
                      >
                        {checked && (
                          <Ionicons
                            name="checkmark"
                            size={14}
                            color={colors.background}
                          />
                        )}
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text
                          variant="sm"
                          weight={checked ? '700' : '500'}
                          style={{ color: checked ? colors.text : colors.textSecondary }}
                        >
                          Semester {sem}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Bottom Action Footer */}
              <View style={[styles.footer, { borderTopColor: colors.border }]}>
                <Button
                  title="Apply Selection"
                  variant="primary"
                  size="md"
                  style={{ width: '100%' }}
                  onPress={handleApply}
                />
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    maxHeight: '85%',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  optionsList: {
    maxHeight: 380,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionRowSelected: {
    borderWidth: 1,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    marginVertical: 8,
    marginHorizontal: 8,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
  },
});
