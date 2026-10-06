import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { PrimaryButton } from '@/components/ui/Button';
import {
  AsyncStorageLudoStorageAdapter,
  createLocalLudoSession,
  inspectSavedSession,
  clearSavedSession,
  createDefaultSetup,
  setSeatType,
  setBotDifficulty,
  setPlayerName,
  validateSetupState,
  buildLocalLudoConfig,
  type SetupSeatState,
  type PlayerColor,
  type BotDifficulty,
} from '@/services/ludo';

const LUDO_COLOR_MAP: Record<PlayerColor, { name: string; hex: string; bg: string }> = {
  red: { name: 'RED', hex: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
  green: { name: 'GREEN', hex: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
  yellow: { name: 'YELLOW', hex: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)' },
  blue: { name: 'BLUE', hex: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
};

export default function LudoSetupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ replace?: string }>();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const [playerCount, setPlayerCount] = useState<2 | 3 | 4>(2);
  const [seats, setSeats] = useState<SetupSeatState[]>(() => createDefaultSetup(2));
  const [isStarting, setIsStarting] = useState(false);

  const storage = React.useMemo(() => new AsyncStorageLudoStorageAdapter(), []);

  const handlePlayerCountChange = (count: 2 | 3 | 4) => {
    if (count === playerCount) return;
    setPlayerCount(count);
    setSeats(createDefaultSetup(count));
  };

  const handleSeatTypeToggle = (color: PlayerColor, newType: 'human' | 'bot') => {
    setSeats((prev) => setSeatType(prev, color, newType));
  };

  const handleDifficultyChange = (color: PlayerColor, difficulty: BotDifficulty) => {
    setSeats((prev) => setBotDifficulty(prev, color, difficulty));
  };

  const handleNameChange = (color: PlayerColor, text: string) => {
    setSeats((prev) => setPlayerName(prev, color, text));
  };

  // Validation
  const validation = validateSetupState(seats, playerCount);
  const activeSeats = seats.filter((s) => s.status === 'active');
  const hasHumanError = validation.errors.some((e) =>
    e.toLowerCase().includes('at least one human')
  );

  const executeStartGame = async () => {
    setIsStarting(true);

    try {
      const configRes = buildLocalLudoConfig(seats);
      if (!configRes.valid) {
        Alert.alert('Configuration Error', configRes.errors.join('\n'));
        setIsStarting(false);
        return;
      }

      // Safe creation: createLocalLudoSession creates and saves the session directly,
      // atomically overwriting previous storage. We DO NOT clear the old save beforehand.
      // If save throws, the previous save remains intact in storage.
      await createLocalLudoSession(configRes.config, { storage });

      // Only navigate once initial save is confirmed durable!
      router.replace('/games/ludo/local' as any);
    } catch {
      // User-friendly error message, no raw error exposed, allow retry
      Alert.alert('Save Error', "Game couldn't be saved. Please try again.");
      setIsStarting(false);
    }
  };

  const handleStartGame = async () => {
    if (!validation.valid || isStarting) return;

    // Direct route protection: if user entered setup directly without replace confirmation,
    // inspect storage and require explicit user authorization before overwriting existing data.
    if (params.replace !== '1') {
      try {
        const existing = await inspectSavedSession(storage);
        if (existing.status === 'resumable') {
          Alert.alert(
            'Start a new game?',
            'Your current offline Ludo game will be replaced.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Start New Game',
                style: 'destructive',
                onPress: () => {
                  void executeStartGame();
                },
              },
            ]
          );
          return;
        } else if (existing.status === 'corrupted') {
          Alert.alert(
            'Replace saved game?',
            "The existing Ludo save can't be resumed. Starting a new game will replace it.",
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Continue',
                style: 'destructive',
                onPress: () => {
                  void executeStartGame();
                },
              },
            ]
          );
          return;
        }
      } catch {}
    }

    await executeStartGame();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.contentContainer,
          {
            paddingHorizontal: spacing.md,
            paddingTop: spacing.md,
            paddingBottom: Math.max(insets.bottom + spacing.xl, 40),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={{ marginBottom: spacing.md }}>
          <Heading style={{ color: colors.text }}>New Offline Game</Heading>
          <Caption style={{ color: colors.textMuted, marginTop: 4 }}>
            Choose number of players and configure each seat
          </Caption>
        </View>

        {/* Player Count Presets */}
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="sm" weight="700" style={{ color: colors.text, marginBottom: spacing.xs }}>
            Player Count
          </Text>
          <View
            style={[
              styles.segmentedRow,
              { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderRadius: radii.md },
            ]}
          >
            {([2, 3, 4] as const).map((count) => {
              const isSelected = count === playerCount;
              return (
                <TouchableOpacity
                  key={count}
                  onPress={() => handlePlayerCountChange(count)}
                  style={[
                    styles.segmentButton,
                    isSelected && {
                      backgroundColor: colors.surfaceRaised,
                      borderColor: colors.borderStrong,
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.15,
                      shadowRadius: 2,
                      elevation: 2,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${count} Players`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    variant="sm"
                    weight={isSelected ? '700' : '500'}
                    style={{ color: isSelected ? colors.text : colors.textMuted }}
                  >
                    {count} Players
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Validation Warning if No Human */}
        {hasHumanError && (
          <Card
            style={[
              styles.warningCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
                borderRadius: radii.card,
                marginBottom: spacing.md,
              },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
              <Text variant="sm" weight="600" style={{ color: colors.error, marginLeft: 8 }}>
                At least one human player is required.
              </Text>
            </View>
          </Card>
        )}

        {/* Seat Cards */}
        <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
          {activeSeats.map((seat) => {
            const meta = LUDO_COLOR_MAP[seat.color];
            const isBot = seat.playerType === 'bot';
            const nameTrimmed = (seat.displayName || '').trim();
            const isNameTooLong = nameTrimmed.length > 32;

            return (
              <Card
                key={seat.color}
                style={[
                  styles.seatCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderRadius: radii.card,
                  },
                ]}
              >
                {/* Seat Header with Color Badge */}
                <View style={styles.seatHeaderRow}>
                  <View style={styles.colorIndicatorRow}>
                    <View style={[styles.colorSquare, { backgroundColor: meta.hex }]} />
                    <Text variant="sm" weight="800" style={{ color: colors.text, letterSpacing: 0.5 }}>
                      {meta.name}
                    </Text>
                  </View>

                  {/* Human / Bot Switch */}
                  <View
                    style={[
                      styles.seatTypeSwitch,
                      { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                    ]}
                  >
                    <TouchableOpacity
                      onPress={() => handleSeatTypeToggle(seat.color, 'human')}
                      style={[
                        styles.typeTab,
                        !isBot && {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.borderStrong,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${meta.name} Human`}
                      accessibilityState={{ selected: !isBot }}
                    >
                      <Text
                        variant="xs"
                        weight={!isBot ? '700' : '500'}
                        style={{ color: !isBot ? colors.text : colors.textMuted }}
                      >
                        Human
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleSeatTypeToggle(seat.color, 'bot')}
                      style={[
                        styles.typeTab,
                        isBot && {
                          backgroundColor: colors.surfaceRaised,
                          borderColor: colors.borderStrong,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`${meta.name} Bot`}
                      accessibilityState={{ selected: isBot }}
                    >
                      <Text
                        variant="xs"
                        weight={isBot ? '700' : '500'}
                        style={{ color: isBot ? colors.text : colors.textMuted }}
                      >
                        Bot
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Seat Details */}
                {!isBot ? (
                  /* Human Name Input */
                  <View style={{ marginTop: spacing.sm }}>
                    <Input
                      label="Display Name"
                      value={seat.displayName}
                      onChangeText={(t) => handleNameChange(seat.color, t)}
                      placeholder="Player Name"
                      maxLength={40}
                      error={isNameTooLong ? 'Name cannot exceed 32 characters' : undefined}
                      helper="Name on this device (max 32 characters)"
                      containerStyle={{ marginBottom: 0 }}
                    />
                  </View>
                ) : (
                  /* Bot Difficulty Selector */
                  <View style={{ marginTop: spacing.sm }}>
                    <Text
                      variant="xs"
                      weight="600"
                      style={{ color: colors.textSecondary, marginBottom: spacing.xs }}
                    >
                      Difficulty
                    </Text>
                    <View
                      style={[
                        styles.difficultyRow,
                        { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle },
                      ]}
                    >
                      {(['easy', 'normal', 'hard'] as const).map((diff) => {
                        const isDiffSelected = seat.botDifficulty === diff;
                        return (
                          <TouchableOpacity
                            key={diff}
                            onPress={() => handleDifficultyChange(seat.color, diff)}
                            style={[
                              styles.diffButton,
                              isDiffSelected && {
                                backgroundColor: colors.surfaceRaised,
                                borderColor: colors.borderStrong,
                              },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`${diff} difficulty`}
                            accessibilityState={{ selected: isDiffSelected }}
                          >
                            <Text
                              variant="xs"
                              weight={isDiffSelected ? '700' : '500'}
                              style={{ color: isDiffSelected ? colors.text : colors.textMuted }}
                            >
                              {diff.charAt(0).toUpperCase() + diff.slice(1)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </Card>
            );
          })}
        </View>

        {/* Start Button */}
        <PrimaryButton
          title="Start Game"
          disabled={!validation.valid || isStarting}
          loading={isStarting}
          onPress={handleStartGame}
          leftIcon={<Ionicons name="play" size={18} color={colors.primaryText} />}
        />
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
  segmentedRow: {
    flexDirection: 'row',
    padding: 3,
    borderWidth: 1,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  warningCard: {
    padding: 12,
    borderWidth: 1,
  },
  seatCard: {
    padding: 16,
    borderWidth: 1,
  },
  seatHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  colorIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  colorSquare: {
    width: 16,
    height: 16,
    borderRadius: 4,
    marginRight: 8,
  },
  seatTypeSwitch: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  difficultyRow: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  diffButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
