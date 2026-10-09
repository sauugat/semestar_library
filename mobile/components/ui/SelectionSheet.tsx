import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Modal,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text } from '@/components/ui/Typography';

export interface SelectionOption<T = string> {
  id: T;
  label: string;
  sublabel?: string;
  badge?: string;
}

export interface SelectionSheetProps<T = string> {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SelectionOption<T>[];
  selectedId?: T | null;
  onSelect: (option: SelectionOption<T>) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyText?: string;
  customActionLabel?: string;
  onCustomAction?: () => void;
}

/**
 * Enterprise-grade SelectionSheet for Semester Library.
 * Used for Semester, Subject, and Unit/Chapter selectors.
 *
 * Requirements:
 * - Minimum 44dp row heights (48dp target for comfortable touch)
 * - Clean monochrome palette: black / charcoal / gray / white
 * - Search filter support when searchable is true
 * - Clear checkmark for currently selected item
 * - Optional custom action button (e.g. "+ Custom Subject")
 */
export function SelectionSheet<T = string>({
  visible,
  onClose,
  title,
  options,
  selectedId,
  onSelect,
  searchable = false,
  searchPlaceholder = 'Search...',
  emptyText = 'No options available',
  customActionLabel,
  onCustomAction,
}: SelectionSheetProps<T>) {
  const insets = useSafeAreaInsets();
  const { colors, radii } = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  // Reset search when visibility changes
  React.useEffect(() => {
    if (!visible) {
      setSearchQuery('');
    }
  }, [visible]);

  const filteredOptions = useMemo(() => {
    if (!searchable || !searchQuery.trim()) return options;
    const query = searchQuery.trim().toLowerCase();
    return options.filter((opt) => {
      const matchLabel = opt.label.toLowerCase().includes(query);
      const matchSub = opt.sublabel?.toLowerCase().includes(query);
      const matchBadge = opt.badge?.toLowerCase().includes(query);
      return matchLabel || matchSub || matchBadge;
    });
  }, [options, searchable, searchQuery]);

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
              {/* Drag Handle */}
              <View style={styles.handleContainer}>
                <View style={[styles.handle, { backgroundColor: colors.borderStrong || '#3f3f46' }]} />
              </View>

              {/* Header Row */}
              <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
                <Text variant="md" weight="700" style={{ color: colors.text }}>
                  {title}
                </Text>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Close selection"
                  style={styles.closeBtn}
                >
                  <Ionicons name="close" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Search Field (if enabled) */}
              {searchable && (
                <View style={styles.searchContainer}>
                  <View style={[styles.searchBox, { backgroundColor: colors.surfaceSubtle || '#18181b', borderColor: colors.border }]}>
                    <Ionicons name="search" size={16} color={colors.textMuted} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.searchInput, { color: colors.text }]}
                      placeholder={searchPlaceholder}
                      placeholderTextColor={colors.textMuted}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCorrect={false}
                      clearButtonMode="while-editing"
                    />
                    {searchQuery.length > 0 && Platform.OS === 'android' && (
                      <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

              {/* Options List */}
              <FlatList
                data={filteredOptions}
                keyExtractor={(item, index) => String(item.id ?? index)}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text variant="sm" color="muted" style={{ textAlign: 'center' }}>
                      {searchQuery.trim() ? 'No matches found' : emptyText}
                    </Text>
                  </View>
                }
                ListFooterComponent={
                  customActionLabel && onCustomAction ? (
                    <TouchableOpacity
                      onPress={() => {
                        onClose();
                        onCustomAction();
                      }}
                      activeOpacity={0.7}
                      style={[
                        styles.customActionRow,
                        {
                          backgroundColor: colors.surfaceSubtle || '#18181b',
                          borderColor: colors.border,
                          borderRadius: radii.card,
                        },
                      ]}
                    >
                      <Ionicons name="add-circle-outline" size={20} color={colors.primary} style={{ marginRight: 10 }} />
                      <Text variant="sm" weight="700" style={{ color: colors.primary }}>
                        {customActionLabel}
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
                renderItem={({ item }) => {
                  const isSelected = selectedId !== undefined && selectedId !== null && item.id === selectedId;

                  return (
                    <TouchableOpacity
                      onPress={() => {
                        onSelect(item);
                        onClose();
                      }}
                      activeOpacity={0.7}
                      style={[
                        styles.row,
                        {
                          backgroundColor: isSelected ? '#262626' : '#141414',
                          borderColor: isSelected ? '#3f3f46' : '#222222',
                          borderWidth: 1,
                        },
                      ]}
                    >
                      <View style={styles.rowTextContainer}>
                        {item.badge && (
                          <View style={[styles.badge, { backgroundColor: isSelected ? '#333333' : '#1f1f1f' }]}>
                            <Text variant="xs" weight="700" style={{ color: '#a1a1aa' }}>
                              {item.badge}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text
                            variant="sm"
                            weight={isSelected ? '700' : '500'}
                            style={{
                              color: isSelected ? '#FFFFFF' : '#F5F5F5',
                            }}
                          >
                            {item.label}
                          </Text>
                          {item.sublabel ? (
                            <Text variant="xs" style={{ color: isSelected ? '#d4d4d8' : '#a1a1aa', marginTop: 2 }}>
                              {item.sublabel}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      {isSelected ? (
                        <View style={[styles.checkCircle, { backgroundColor: '#383838' }]}>
                          <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                        </View>
                      ) : (
                        <View style={[styles.emptyCircle, { borderColor: '#3f3f46' }]} />
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
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
    maxHeight: '80%',
    width: '100%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: {
    padding: 4,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
    padding: 0,
  },
  list: {
    maxHeight: 420,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginVertical: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTextContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
  customActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
