import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';

export interface AdminActionConfirmModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  targetName: string;
  targetSubtitle?: string;
  actionType?: 'destructive' | 'neutral';
  confirmLabel?: string;
  requireReason?: boolean;
  reasonPlaceholder?: string;
  isSubmitting?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}

export function AdminActionConfirmModal({
  visible,
  title,
  subtitle,
  targetName,
  targetSubtitle,
  actionType = 'neutral',
  confirmLabel = 'Confirm Action',
  requireReason = true,
  reasonPlaceholder = 'Mandatory administrative justification (minimum 3 characters)...',
  isSubmitting = false,
  error = null,
  onConfirm,
  onClose,
}: AdminActionConfirmModalProps) {
  const { colors, radii } = useTheme();
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setReason('');
      setLocalError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (error) {
      setLocalError(error);
    }
  }, [error]);

  const handleConfirm = () => {
    const cleanReason = reason.trim();
    if (requireReason && cleanReason.length < 3) {
      setLocalError('An administrative reason of at least 3 characters is required.');
      return;
    }
    setLocalError(null);
    onConfirm(cleanReason);
  };

  const isReasonValid = !requireReason || reason.trim().length >= 3;
  const canSubmit = isReasonValid && !isSubmitting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.avoidingWrap}
          >
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  borderRadius: radii.lg,
                },
              ]}
            >
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Heading level={3} style={{ color: colors.text }}>
                    {title}
                  </Heading>
                  {subtitle && (
                    <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>
                      {subtitle}
                    </Caption>
                  )}
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={isSubmitting}
                  style={[styles.closeIcon, { borderColor: colors.border }]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Target info card */}
              <View
                style={[
                  styles.targetBox,
                  {
                    backgroundColor: colors.surfaceRaised,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                  },
                ]}
              >
                <Caption style={{ color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Target Record
                </Caption>
                <Text style={[styles.targetName, { color: colors.text }]}>
                  {targetName}
                </Text>
                {targetSubtitle && (
                  <Caption style={{ color: colors.textSecondary, marginTop: 2 }}>
                    {targetSubtitle}
                  </Caption>
                )}
              </View>

              {/* Error banner */}
              {(localError || error) && (
                <View
                  style={[
                    styles.errorBox,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
                  <Text style={[styles.errorText, { color: colors.text }]}>
                    {localError || error}
                  </Text>
                </View>
              )}

              {/* Administrative Reason Input */}
              {requireReason && (
                <View style={styles.inputWrap}>
                  <View style={styles.inputLabelRow}>
                    <Caption style={{ color: colors.textSecondary, fontWeight: '600' }}>
                      Audit Log Reason
                    </Caption>
                    <Caption style={{ color: colors.textTertiary }}>Required</Caption>
                  </View>
                  <TextInput
                    style={[
                      styles.textInput,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        borderRadius: radii.md,
                      },
                    ]}
                    placeholder={reasonPlaceholder}
                    placeholderTextColor={colors.textTertiary}
                    value={reason}
                    onChangeText={(val) => {
                      setReason(val);
                      if (localError) setLocalError(null);
                    }}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    editable={!isSubmitting}
                  />
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    {
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                  onPress={onClose}
                  disabled={isSubmitting}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '600' }}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    {
                      backgroundColor: canSubmit ? colors.text : colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                  onPress={handleConfirm}
                  disabled={!canSubmit}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color={colors.background} />
                  ) : (
                    <Text
                      style={[
                        styles.confirmBtnText,
                        {
                          color: canSubmit ? colors.background : colors.textTertiary,
                        },
                      ]}
                    >
                      {confirmLabel}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  avoidingWrap: {
    width: '100%',
    maxWidth: 420,
  },
  card: {
    borderWidth: 1,
    padding: 20,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  closeIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  targetBox: {
    padding: 12,
    borderWidth: 1,
    marginTop: 14,
  },
  targetName: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  inputWrap: {
    marginTop: 14,
  },
  inputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    padding: 10,
    fontSize: 14,
    minHeight: 70,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
