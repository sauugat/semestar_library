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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';

export interface SubjectFormData {
  code: string;
  name: string;
  semester: number;
  department: string;
  creditHours: number;
  nature?: string | null;
  reason: string;
}

export interface AdminSubjectFormModalProps {
  visible: boolean;
  mode: 'create' | 'edit';
  initialSubject?: {
    id: string;
    code: string;
    name: string;
    semester: number;
    department?: string;
    creditHours?: number;
    nature?: string | null;
  } | null;
  isSubmitting?: boolean;
  error?: string | null;
  onSubmit: (data: SubjectFormData) => Promise<void> | void;
  onClose: () => void;
}

export function AdminSubjectFormModal({
  visible,
  mode,
  initialSubject,
  isSubmitting = false,
  error = null,
  onSubmit,
  onClose,
}: AdminSubjectFormModalProps) {
  const { colors, radii } = useTheme();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [semester, setSemester] = useState<number>(1);
  const [department, setDepartment] = useState('BIT');
  const [creditHours, setCreditHours] = useState('3.0');
  const [nature, setNature] = useState('Theory & Practical');
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      if (mode === 'edit' && initialSubject) {
        setCode(initialSubject.code);
        setName(initialSubject.name);
        setSemester(initialSubject.semester || 1);
        setDepartment(initialSubject.department || 'BIT');
        setCreditHours(String(initialSubject.creditHours || 3.0));
        setNature(initialSubject.nature || 'Theory & Practical');
        setReason('');
      } else {
        setCode('');
        setName('');
        setSemester(1);
        setDepartment('BIT');
        setCreditHours('3.0');
        setNature('Theory & Practical');
        setReason('');
      }
      setLocalError(null);
    }
  }, [visible, mode, initialSubject]);

  useEffect(() => {
    if (error) setLocalError(error);
  }, [error]);

  const handleSubmit = () => {
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim();
    const cleanReason = reason.trim();
    const parsedCredits = parseFloat(creditHours);

    if (!cleanCode) {
      setLocalError('Subject code is required (e.g. BCT101).');
      return;
    }
    if (!cleanName) {
      setLocalError('Subject name is required.');
      return;
    }
    if (semester < 1 || semester > 8) {
      setLocalError('Valid academic semester (1–8) is required.');
      return;
    }
    if (isNaN(parsedCredits) || parsedCredits < 0) {
      setLocalError('Valid credit hours number is required.');
      return;
    }
    if (cleanReason.length < 3) {
      setLocalError('Administrative audit reason must be at least 3 characters.');
      return;
    }

    setLocalError(null);
    onSubmit({
      code: cleanCode,
      name: cleanName,
      semester,
      department: department.trim() || 'BIT',
      creditHours: parsedCredits,
      nature: nature.trim() || null,
      reason: cleanReason,
    });
  };

  const isFormValid =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    reason.trim().length >= 3 &&
    !isSubmitting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
        >
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.lg,
              },
            ]}
          >
            {/* Header */}
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Heading level={3} style={{ color: colors.text }}>
                  {mode === 'create' ? 'Add Canonical Subject' : 'Edit Canonical Subject'}
                </Heading>
                <Caption style={{ color: colors.textSecondary }}>
                  {mode === 'create'
                    ? 'Publish new course into the curriculum catalog'
                    : `Update course metadata for ${initialSubject?.code || 'subject'}`}
                </Caption>
              </View>
              <TouchableOpacity
                onPress={onClose}
                disabled={isSubmitting}
                style={[styles.closeIcon, { borderColor: colors.border }]}
              >
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingVertical: 14 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Error Box */}
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

              {/* Semester Edit Conflict Warning */}
              {mode === 'edit' && initialSubject && semester !== initialSubject.semester && (
                <View
                  style={[
                    styles.warningBox,
                    {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <Ionicons name="shield-outline" size={16} color={colors.text} style={{ marginRight: 6 }} />
                  <Text style={[styles.warningText, { color: colors.textSecondary }]}>
                    Changing semester from Sem {initialSubject.semester} to Sem {semester}:
                    Server will safely reject (HTTP 409) if existing faculty, notes, or coursework are linked.
                  </Text>
                </View>
              )}

              {/* Subject Code */}
              <View style={styles.fieldGroup}>
                <Caption style={{ color: colors.textSecondary, marginBottom: 4 }}>
                  Course Code *
                </Caption>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                      borderRadius: radii.md,
                    },
                  ]}
                  placeholder="e.g. BCT101"
                  placeholderTextColor={colors.textTertiary}
                  value={code}
                  onChangeText={(val) => {
                    setCode(val);
                    if (localError) setLocalError(null);
                  }}
                  autoCapitalize="characters"
                  editable={!isSubmitting}
                />
              </View>

              {/* Subject Name */}
              <View style={styles.fieldGroup}>
                <Caption style={{ color: colors.textSecondary, marginBottom: 4 }}>
                  Course Name *
                </Caption>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                      borderRadius: radii.md,
                    },
                  ]}
                  placeholder="e.g. Object-Oriented Programming"
                  placeholderTextColor={colors.textTertiary}
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    if (localError) setLocalError(null);
                  }}
                  editable={!isSubmitting}
                />
              </View>

              {/* Semester Selector 1-8 */}
              <View style={styles.fieldGroup}>
                <Caption style={{ color: colors.textSecondary, marginBottom: 6 }}>
                  Academic Semester (1–8) *
                </Caption>
                <View style={styles.semesterGrid}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => {
                    const isSelected = semester === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => setSemester(s)}
                        style={[
                          styles.semesterChip,
                          {
                            backgroundColor: isSelected ? colors.text : colors.background,
                            borderColor: colors.border,
                            borderRadius: radii.sm,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '700',
                            color: isSelected ? colors.background : colors.text,
                          }}
                        >
                          S{s}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Department & Credit Hours Row */}
              <View style={styles.rowFields}>
                <View style={[styles.fieldGroup, { flex: 1, marginRight: 8 }]}>
                  <Caption style={{ color: colors.textSecondary, marginBottom: 4 }}>
                    Department
                  </Caption>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        borderRadius: radii.md,
                      },
                    ]}
                    placeholder="BIT"
                    placeholderTextColor={colors.textTertiary}
                    value={department}
                    onChangeText={setDepartment}
                    autoCapitalize="characters"
                    editable={!isSubmitting}
                  />
                </View>

                <View style={[styles.fieldGroup, { flex: 1, marginLeft: 8 }]}>
                  <Caption style={{ color: colors.textSecondary, marginBottom: 4 }}>
                    Credit Hours
                  </Caption>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.text,
                        borderRadius: radii.md,
                      },
                    ]}
                    placeholder="3.0"
                    placeholderTextColor={colors.textTertiary}
                    value={creditHours}
                    onChangeText={setCreditHours}
                    keyboardType="numeric"
                    editable={!isSubmitting}
                  />
                </View>
              </View>

              {/* Course Nature */}
              <View style={styles.fieldGroup}>
                <Caption style={{ color: colors.textSecondary, marginBottom: 4 }}>
                  Course Nature
                </Caption>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                      borderRadius: radii.md,
                    },
                  ]}
                  placeholder="e.g. Theory & Practical"
                  placeholderTextColor={colors.textTertiary}
                  value={nature}
                  onChangeText={setNature}
                  editable={!isSubmitting}
                />
              </View>

              {/* Mandatory Reason */}
              <View style={styles.fieldGroup}>
                <View style={styles.reasonLabelRow}>
                  <Caption style={{ color: colors.textSecondary, fontWeight: '600' }}>
                    Audit Log Reason *
                  </Caption>
                  <Caption style={{ color: colors.textTertiary }}>Min 3 chars</Caption>
                </View>
                <TextInput
                  style={[
                    styles.textArea,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                      borderRadius: radii.md,
                    },
                  ]}
                  placeholder={mode === 'create' ? 'e.g. Curriculum update for new semester batch' : 'e.g. Course syllabus revision'}
                  placeholderTextColor={colors.textTertiary}
                  value={reason}
                  onChangeText={(val) => {
                    setReason(val);
                    if (localError) setLocalError(null);
                  }}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                  editable={!isSubmitting}
                />
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View style={[styles.modalActions, { borderTopColor: colors.border }]}>
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
                  styles.submitBtn,
                  {
                    backgroundColor: isFormValid ? colors.text : colors.border,
                    borderRadius: radii.md,
                  },
                ]}
                onPress={handleSubmit}
                disabled={!isFormValid}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text
                    style={{
                      color: isFormValid ? colors.background : colors.textTertiary,
                      fontWeight: '700',
                    }}
                  >
                    {mode === 'create' ? 'Create Subject' : 'Save Changes'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
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
  keyboardWrap: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
  },
  modalCard: {
    borderWidth: 1,
    padding: 20,
    width: '100%',
    maxHeight: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 12,
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
  fieldGroup: {
    marginBottom: 12,
  },
  rowFields: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  textArea: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 56,
  },
  semesterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  semesterChip: {
    width: 40,
    height: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reasonLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  warningText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 130,
  },
});
