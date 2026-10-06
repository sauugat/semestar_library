import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import {
  generateRoomCode,
  normalizeRoomCode,
  isValidRoomCode,
} from '@/services/ludo-online/room-code';

export default function OnlineLudoEntryScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const [inputCode, setInputCode] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCreateRoom = () => {
    setErrorMessage(null);
    const newRoomCode = generateRoomCode();
    router.push(`/games/ludo/online/${newRoomCode}?intent=create` as any);
  };

  const handleJoinRoom = () => {
    setErrorMessage(null);
    const normalized = normalizeRoomCode(inputCode);
    if (!normalized) {
      setErrorMessage('Please enter a 6-character room code.');
      return;
    }

    if (!isValidRoomCode(normalized)) {
      setErrorMessage('Invalid room code. Codes are 6 characters (e.g. ABCD23).');
      return;
    }

    router.push(`/games/ludo/online/${normalized}?intent=join` as any);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.contentContainer,
          {
            paddingHorizontal: spacing.md,
            paddingTop: spacing.lg,
            paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header Section */}
        <View style={[styles.headerSection, { marginBottom: spacing.xl }]}>
          <Heading style={[styles.mainTitle, { color: colors.text }]}>ONLINE LUDO</Heading>
          <Subheading style={[styles.subTitle, { color: colors.textSecondary }]}>
            Play privately with friends across campus.
          </Subheading>
          <Text variant="xs" style={{ color: colors.textMuted, marginTop: 6 }}>
            2–4 players • Bots supported • Private room codes
          </Text>
        </View>

        {/* Create Room Card */}
        <Card
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderStrong,
              borderRadius: radii.card,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <View style={styles.cardHeaderRow}>
            <View
              style={[
                styles.iconBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="md" weight="700" style={{ color: colors.text }}>
                Create Private Room
              </Text>
              <Text variant="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
                Start a new lobby and share the code with friends
              </Text>
            </View>
          </View>

          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton
              title="Create Room"
              onPress={handleCreateRoom}
              leftIcon={<Ionicons name="sparkles-outline" size={18} color={colors.primaryText} />}
            />
          </View>
        </Card>

        {/* Divider / OR */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text variant="xs" weight="700" style={{ color: colors.textMuted, marginHorizontal: 12 }}>
            OR JOIN EXISTING
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Join Room Card */}
        <Card
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderStrong,
              borderRadius: radii.card,
            },
          ]}
        >
          <View style={styles.cardHeaderRow}>
            <View
              style={[
                styles.iconBox,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="enter-outline" size={24} color={colors.textSecondary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="md" weight="700" style={{ color: colors.text }}>
                Join Private Room
              </Text>
              <Text variant="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
                Enter a 6-character room code from your classmate
              </Text>
            </View>
          </View>

          <View style={{ marginTop: spacing.md }}>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: errorMessage ? colors.error : colors.border,
                  color: colors.text,
                  borderRadius: radii.md,
                },
              ]}
              placeholder="e.g. ABCD23"
              placeholderTextColor={colors.textMuted}
              value={inputCode}
              onChangeText={(text) => {
                setInputCode(text.toUpperCase());
                if (errorMessage) setErrorMessage(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              returnKeyType="join"
              onSubmitEditing={handleJoinRoom}
            />

            {errorMessage && (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                <Text variant="xs" style={{ color: colors.error, marginLeft: 4 }}>
                  {errorMessage}
                </Text>
              </View>
            )}

            <View style={{ marginTop: spacing.sm }}>
              <SecondaryButton
                title="Join Room"
                onPress={handleJoinRoom}
                leftIcon={<Ionicons name="arrow-forward" size={18} color={colors.text} />}
              />
            </View>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
  },
  headerSection: {
    paddingTop: 8,
  },
  mainTitle: {
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  subTitle: {
    fontSize: 15,
    lineHeight: 20,
    marginTop: 2,
  },
  card: {
    padding: 18,
    borderWidth: 1.5,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  input: {
    height: 48,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
});
