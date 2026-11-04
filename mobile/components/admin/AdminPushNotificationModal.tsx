import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Caption } from '@/components/ui/Typography';
import { sendAdminPushNotification } from '@/services/notifications';

export interface AdminPushNotificationModalProps {
  visible: boolean;
  onClose: () => void;
}

const AUDIENCE_CHOICES: Array<{
  id: 'all' | 'students_only' | 'teachers_only' | 'semester';
  label: string;
  desc: string;
}> = [
  { id: 'all', label: 'Everyone', desc: 'All students, CRs, teachers, and staff' },
  { id: 'students_only', label: 'Students Only', desc: 'All enrolled students and CRs' },
  { id: 'teachers_only', label: 'Teachers Only', desc: 'All faculty accounts' },
  { id: 'semester', label: 'Specific Semesters', desc: 'Target selected semesters (1–8)' },
];

const PRIORITY_CHOICES: Array<{
  id: 'normal' | 'high' | 'urgent';
  label: string;
}> = [
  { id: 'normal', label: 'Normal' },
  { id: 'high', label: 'High (Recommended)' },
  { id: 'urgent', label: 'Urgent (Bypass Quiet Hours)' },
];

export function AdminPushNotificationModal({
  visible,
  onClose,
}: AdminPushNotificationModalProps) {
  const { colors, spacing, radii } = useTheme();

  const [title, setTitle] = useState('Semester Library');
  const [body, setBody] = useState('');
  const [targetAudience, setTargetAudience] = useState<'all' | 'students_only' | 'teachers_only' | 'semester'>('all');
  const [targetSemesters, setTargetSemesters] = useState<number[]>([]);
  const [priority, setPriority] = useState<'normal' | 'high' | 'urgent'>('high');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const toggleSemester = (sem: number) => {
    setTargetSemesters((prev) =>
      prev.includes(sem) ? prev.filter((s) => s !== sem) : [...prev, sem].sort((a, b) => a - b)
    );
  };

  const handleSend = async () => {
    if (!body.trim()) {
      setErrorMsg('Please enter a notification message.');
      return;
    }
    if (targetAudience === 'semester' && targetSemesters.length === 0) {
      setErrorMsg('Please select at least one semester to target.');
      return;
    }

    setSending(true);
    setErrorMsg(null);
    try {
      const res = await sendAdminPushNotification({
        title: title.trim() || 'Semester Library',
        body: body.trim(),
        targetAudience,
        targetSemesters: targetAudience === 'semester' ? targetSemesters : undefined,
        priority,
      });

      setBody('');
      Alert.alert(
        'Notification Sent',
        res.message || `Broadcast delivered to ${res.recipientCount || 0} users.`
      );
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Could not send push notification.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => {
        if (!sending) onClose();
      }}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            disabled={sending}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text variant="sm" weight="600" color="secondary">
              Cancel
            </Text>
          </TouchableOpacity>

          <Heading style={{ fontSize: 16 }}>Push Notification</Heading>

          <TouchableOpacity
            onPress={handleSend}
            disabled={sending || !body.trim()}
            style={[
              styles.sendBtn,
              {
                backgroundColor: body.trim() && !sending ? colors.text : colors.surfaceRaised,
                borderRadius: radii.md,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Text
                variant="xs"
                weight="700"
                style={{ color: body.trim() ? colors.surface : colors.textMuted }}
              >
                Send
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* App POV Identity Banner */}
          <View
            style={[
              styles.povCard,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                borderRadius: radii.md,
              },
            ]}
          >
            <View style={[styles.appBadge, { backgroundColor: colors.text }]}>
              <Ionicons name="shield-checkmark" size={18} color={colors.surface} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text variant="sm" weight="700">
                App Official Broadcast (Semester Library POV)
              </Text>
              <Caption color="muted">
                Sent directly as an official system notification from Semester Library to user devices and in-app inboxes.
              </Caption>
            </View>
          </View>

          {errorMsg && (
            <View
              style={[
                styles.errorBox,
                {
                  backgroundColor: '#FEF2F2',
                  borderColor: '#FCA5A5',
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="alert-circle" size={16} color="#DC2626" style={{ marginRight: 6 }} />
              <Text variant="xs" weight="600" style={{ color: '#DC2626', flex: 1 }}>
                {errorMsg}
              </Text>
            </View>
          )}

          {/* Notification Title */}
          <Text variant="xs" weight="700" color="secondary" style={styles.label}>
            NOTIFICATION HEADLINE / SENDER TITLE
          </Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Semester Library"
            placeholderTextColor={colors.textMuted}
            maxLength={100}
            editable={!sending}
            style={[
              styles.input,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
                borderRadius: radii.md,
              },
            ]}
          />

          {/* Notification Body */}
          <Text variant="xs" weight="700" color="secondary" style={[styles.label, { marginTop: spacing.md }]}>
            NOTIFICATION MESSAGE *
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write the official notice or announcement to push..."
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={1000}
            editable={!sending}
            textAlignVertical="top"
            style={[
              styles.textarea,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
                borderRadius: radii.md,
              },
            ]}
          />
          <Caption color="muted" style={{ alignSelf: 'flex-end', marginTop: 4 }}>
            {body.length} / 1,000
          </Caption>

          {/* Target Audience */}
          <Text variant="xs" weight="700" color="secondary" style={[styles.label, { marginTop: spacing.md }]}>
            TARGET AUDIENCE
          </Text>
          <View style={{ gap: 8 }}>
            {AUDIENCE_CHOICES.map((opt) => {
              const selected = targetAudience === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  activeOpacity={0.7}
                  onPress={() => setTargetAudience(opt.id)}
                  style={[
                    styles.choiceRow,
                    {
                      backgroundColor: selected ? colors.surfaceRaised : colors.surface,
                      borderColor: selected ? colors.text : colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text variant="sm" weight="700">
                      {opt.label}
                    </Text>
                    <Caption color="muted">{opt.desc}</Caption>
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={18}
                    color={selected ? colors.text : colors.textMuted}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {targetAudience === 'semester' && (
            <View style={{ marginTop: spacing.sm }}>
              <Caption color="muted" style={{ marginBottom: 8 }}>
                Select Semesters:
              </Caption>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => {
                  const active = targetSemesters.includes(sem);
                  return (
                    <TouchableOpacity
                      key={sem}
                      onPress={() => toggleSemester(sem)}
                      style={[
                        styles.semChip,
                        {
                          backgroundColor: active ? colors.text : colors.surface,
                          borderColor: active ? colors.text : colors.border,
                          borderRadius: radii.sm,
                        },
                      ]}
                    >
                      <Text
                        variant="xs"
                        weight="700"
                        style={{ color: active ? colors.surface : colors.text }}
                      >
                        Sem {sem}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Priority */}
          <Text variant="xs" weight="700" color="secondary" style={[styles.label, { marginTop: spacing.lg }]}>
            DELIVERY PRIORITY
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {PRIORITY_CHOICES.map((p) => {
              const active = priority === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPriority(p.id)}
                  style={[
                    styles.priorityChip,
                    {
                      backgroundColor: active ? colors.text : colors.surface,
                      borderColor: active ? colors.text : colors.border,
                      borderRadius: radii.md,
                    },
                  ]}
                >
                  <Text
                    variant="xs"
                    weight="700"
                    style={{ color: active ? colors.surface : colors.text }}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  povCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  appBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  label: {
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 9,
    fontSize: 14,
  },
  textarea: {
    borderWidth: 1,
    padding: 12,
    minHeight: 110,
    fontSize: 14,
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
  },
  semChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  priorityChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
});
