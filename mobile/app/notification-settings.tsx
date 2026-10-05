import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/constants/useTheme';
import { Text, Caption } from '@/components/ui/Typography';
import {
  getAdvancedPreferences,
  updateAdvancedPreferences,
  AdvancedNotificationPreferences,
} from '@/services/notifications';

type DeliveryMode = 'push_inbox' | 'inbox_only' | 'off';

interface ModeOption {
  key: DeliveryMode;
  label: string;
  desc: string;
}

const DELIVERY_MODES: ModeOption[] = [
  { key: 'push_inbox', label: 'Push + Inbox', desc: 'Alerts on device & saved to inbox' },
  { key: 'inbox_only', label: 'Inbox only', desc: 'Silent in-app history only' },
  { key: 'off', label: 'Off', desc: 'Suppress notifications' },
];

export default function NotificationSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [loading, setLoading] = useState(true);

  const [prefs, setPrefs] = useState<AdvancedNotificationPreferences>({
    muteChat: false,
    notifyNotes: true,
    notifyPosts: true,
    notifyNotices: true,
    hideLockscreenPreview: false,
    deliveryMessages: 'push_inbox',
    deliveryActivity: 'push_inbox',
    deliveryAcademic: 'push_inbox',
    deliverySystem: 'push_inbox',
    quietHoursEnabled: false,
    quietHoursStart: '22:30',
    quietHoursEnd: '07:00',
    timezone: 'Asia/Kathmandu',
  });

  useEffect(() => {
    void (async () => {
      try {
        const data = await getAdvancedPreferences();
        if (data) {
          setPrefs(data);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpdate = async (updates: Partial<AdvancedNotificationPreferences>) => {
    const updated = { ...prefs, ...updates };
    setPrefs(updated);
    try {
      const res = await updateAdvancedPreferences(updates);
      if (!res.success) {
        Alert.alert('Error', res.error || 'Failed to save settings.');
      }
    } catch {
      Alert.alert('Error', 'Network error saving settings.');
    }
  };

  const renderDeliveryPicker = (
    title: string,
    subtitle: string,
    currentMode: DeliveryMode,
    onChange: (mode: DeliveryMode) => void
  ) => {
    return (
      <View style={[styles.sectionBlock, { borderBottomColor: colors.border }]}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.categoryTitle, { color: colors.text }]}>{title}</Text>
          <Caption color="muted">{subtitle}</Caption>
        </View>

        <View style={styles.modesContainer}>
          {DELIVERY_MODES.map((option) => {
            const isSelected = currentMode === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.modeButton,
                  {
                    backgroundColor: isSelected ? colors.surfaceRaised : colors.surface,
                    borderColor: isSelected ? colors.text : colors.border,
                  },
                ]}
                activeOpacity={0.7}
                onPress={() => onChange(option.key)}
              >
                <View style={styles.modeRadioRow}>
                  <View
                    style={[
                      styles.radioCircle,
                      { borderColor: isSelected ? colors.text : colors.textMuted },
                    ]}
                  >
                    {isSelected && (
                      <View
                        style={[
                          styles.radioInner,
                          { backgroundColor: colors.text },
                        ]}
                      />
                    )}
                  </View>
                  <Text
                    style={[
                      styles.modeLabel,
                      {
                        color: colors.text,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </View>
                <Caption color="muted" style={styles.modeDesc}>
                  {option.desc}
                </Caption>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Overview Banner */}
      <View
        style={[
          styles.introCard,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
          },
        ]}
      >
        <Ionicons name="notifications-outline" size={24} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.introTitle, { color: colors.text }]}>
            In-App & Push Delivery
          </Text>
          <Caption color="muted" style={{ lineHeight: 18 }}>
            Notifications are always safely retained in your Notification Center inbox, while push alerts to your device can be tailored below.
          </Caption>
        </View>
      </View>

      {/* 1. Category Delivery Channels */}
      <View style={[styles.cardGroup, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {renderDeliveryPicker(
          'Academic Updates',
          'Official notices, routines, and uploaded study materials',
          prefs.deliveryAcademic,
          (mode) => handleUpdate({ deliveryAcademic: mode })
        )}

        {renderDeliveryPicker(
          'Messages & Mentions',
          'Class group chats, direct replies, and @mentions',
          prefs.deliveryMessages,
          (mode) => handleUpdate({ deliveryMessages: mode })
        )}

        {renderDeliveryPicker(
          'Social & Activity',
          'Comments, replies, and reactions on campus feed posts',
          prefs.deliveryActivity,
          (mode) => handleUpdate({ deliveryActivity: mode })
        )}

        {renderDeliveryPicker(
          'System & Security',
          'Account security alerts and campus system notices',
          prefs.deliverySystem,
          (mode) => handleUpdate({ deliverySystem: mode })
        )}
      </View>

      {/* 2. Quiet Hours */}
      <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          Quiet Hours
        </Text>
        <Caption color="muted">
          Suppress device push sounds and vibrations during study or sleep hours. Notifications remain securely in your inbox.
        </Caption>
      </View>

      <View
        style={[
          styles.cardGroup,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            marginTop: 12,
          },
        ]}
      >
        <View style={[styles.switchRow, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[styles.switchLabel, { color: colors.text }]}>
              Enable Quiet Hours
            </Text>
            <Caption color="muted">
              {prefs.quietHoursEnabled
                ? `Active from ${prefs.quietHoursStart} to ${prefs.quietHoursEnd} (${prefs.timezone})`
                : 'Turn on scheduled quiet hours'}
            </Caption>
          </View>
          <Switch
            value={prefs.quietHoursEnabled}
            onValueChange={(val) => handleUpdate({ quietHoursEnabled: val })}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
          />
        </View>

        {prefs.quietHoursEnabled && (
          <View style={styles.quietHoursDetailBlock}>
            <View style={styles.timeRow}>
              <View style={[styles.timeBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                <Caption color="muted">START TIME</Caption>
                <Text style={[styles.timeValue, { color: colors.text }]}>
                  {prefs.quietHoursStart}
                </Text>
              </View>

              <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />

              <View style={[styles.timeBox, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                <Caption color="muted">END TIME</Caption>
                <Text style={[styles.timeValue, { color: colors.text }]}>
                  {prefs.quietHoursEnd}
                </Text>
              </View>
            </View>

            <View style={styles.presetButtonsRow}>
              {[
                { label: '10:30 PM - 7:00 AM', start: '22:30', end: '07:00' },
                { label: '11:00 PM - 6:00 AM', start: '23:00', end: '06:00' },
                { label: '10:00 PM - 8:00 AM', start: '22:00', end: '08:00' },
              ].map((preset) => (
                <TouchableOpacity
                  key={preset.label}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor:
                        prefs.quietHoursStart === preset.start && prefs.quietHoursEnd === preset.end
                          ? colors.text
                          : colors.surfaceRaised,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() =>
                    handleUpdate({
                      quietHoursStart: preset.start,
                      quietHoursEnd: preset.end,
                    })
                  }
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color:
                        prefs.quietHoursStart === preset.start && prefs.quietHoursEnd === preset.end
                          ? colors.surface
                          : colors.text,
                    }}
                  >
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* 3. Privacy & Lockscreen */}
      <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Privacy</Text>
      </View>

      <View
        style={[
          styles.cardGroup,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            marginTop: 12,
          },
        ]}
      >
        <View style={styles.switchRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={[styles.switchLabel, { color: colors.text }]}>
              Hide Lockscreen Preview
            </Text>
            <Caption color="muted">
              Hides message body and student names on your device lockscreen banner
            </Caption>
          </View>
          <Switch
            value={prefs.hideLockscreenPreview}
            onValueChange={(val) => handleUpdate({ hideLockscreenPreview: val })}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    margin: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  introTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardGroup: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  sectionBlock: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  categoryTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  modesContainer: {
    gap: 8,
  },
  modeButton: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  modeRadioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  radioCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modeLabel: {
    fontSize: 14,
  },
  modeDesc: {
    marginLeft: 24,
    fontSize: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  quietHoursDetailBlock: {
    padding: 16,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  timeBox: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  timeValue: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  presetButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
});
