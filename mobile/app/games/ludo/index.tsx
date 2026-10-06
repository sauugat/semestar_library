import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/constants/useTheme';
import { Text, Heading, Subheading, Caption } from '@/components/ui/Typography';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button, PrimaryButton, SecondaryButton } from '@/components/ui/Button';
import {
  AsyncStorageLudoStorageAdapter,
  inspectSavedSession,
  restoreLocalLudoSession,
  clearSavedSession,
  type SavedSessionInspection,
  type PlayerColor,
} from '@/services/ludo';

const LUDO_COLOR_MAP: Record<string, { name: string; hex: string }> = {
  red: { name: 'Red', hex: '#DC2626' },
  green: { name: 'Green', hex: '#059669' },
  yellow: { name: 'Yellow', hex: '#D97706' },
  blue: { name: 'Blue', hex: '#2563EB' },
};

function getColorMeta(color: string | null | undefined): { name: string; hex: string } {
  if (color && LUDO_COLOR_MAP[color]) {
    return LUDO_COLOR_MAP[color];
  }
  return { name: 'Player', hex: '#6B7280' };
}

export default function LudoLandingScreen() {
  const router = useRouter();
  const { colors, spacing, radii } = useTheme();
  const insets = useSafeAreaInsets();

  const [inspection, setInspection] = useState<SavedSessionInspection | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);

  const storage = React.useMemo(() => new AsyncStorageLudoStorageAdapter(), []);

  // Re-inspect storage whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      setIsLoading(true);

      inspectSavedSession(storage)
        .then((res) => {
          if (isMounted) {
            setInspection(res);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            setInspection({
              status: 'corrupted',
              error: err instanceof Error ? err.message : 'Unknown storage inspection error',
            });
            setIsLoading(false);
          }
        });

      return () => {
        isMounted = false;
      };
    }, [storage])
  );

  const handleResumeGame = () => {
    if (isActionPending) return;
    setIsActionPending(true);
    router.push('/games/ludo/local' as any);
    setTimeout(() => {
      setIsActionPending(false);
    }, 600);
  };

  const handleNewGamePress = () => {
    if (isActionPending) return;

    if (inspection?.status === 'resumable') {
      Alert.alert(
        'Start a new game?',
        'Your current offline Ludo game will be replaced.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start New Game',
            style: 'destructive',
            onPress: () => {
              router.push('/games/ludo/setup?replace=1' as any);
            },
          },
        ]
      );
    } else if (inspection?.status === 'corrupted') {
      Alert.alert(
        'Replace saved game?',
        "The existing Ludo save can't be resumed. Starting a new game will replace it.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Continue',
            style: 'destructive',
            onPress: () => {
              router.push('/games/ludo/setup?replace=1' as any);
            },
          },
        ]
      );
    } else {
      router.push('/games/ludo/setup' as any);
    }
  };

  const handleDeleteCorrupted = async () => {
    if (isActionPending) return;
    setIsActionPending(true);

    try {
      await clearSavedSession(storage);
      const refreshed = await inspectSavedSession(storage);
      setInspection(refreshed);
    } catch (err: any) {
      Alert.alert('Error', 'Failed to remove corrupted save.');
    } finally {
      setIsActionPending(false);
    }
  };

  const formatTimestamp = (ts: number): string => {
    const elapsedMinutes = Math.floor((Date.now() - ts) / 60000);
    if (elapsedMinutes < 1) return 'Just now';
    if (elapsedMinutes === 1) return '1 minute ago';
    if (elapsedMinutes < 60) return `${elapsedMinutes} minutes ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours === 1) return '1 hour ago';
    if (elapsedHours < 24) return `${elapsedHours} hours ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        {
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
          paddingBottom: Math.max(insets.bottom + spacing.lg, spacing.xl),
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero Header */}
      <View style={[styles.headerSection, { marginBottom: spacing.lg }]}>
        <Heading style={[styles.mainTitle, { color: colors.text }]}>LUDO</Heading>
        <Subheading style={[styles.subTitle, { color: colors.textSecondary }]}>
          Play locally with friends or bots.
        </Subheading>
        <Text variant="xs" style={{ color: colors.textMuted, marginTop: 4 }}>
          Pass-and-play offline board match for 2 to 4 players
        </Text>
      </View>

      {/* Saved Game / Inspection Section */}
      <View style={{ marginBottom: spacing.lg }}>
        {isLoading ? (
          <Card
            style={[
              styles.loadingCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.card,
              },
            ]}
          >
            <ActivityIndicator size="small" color={colors.primary} />
            <Text variant="sm" style={{ color: colors.textMuted, marginLeft: 10 }}>
              Checking saved game...
            </Text>
          </Card>
        ) : inspection?.status === 'resumable' ? (
          <Card
            style={[
              styles.savedCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderStrong,
                borderRadius: radii.card,
              },
            ]}
          >
            <View style={styles.savedCardHeader}>
              <View style={styles.savedBadgeRow}>
                <Badge
                  label={inspection.gameStatus === 'finished' ? 'GAME FINISHED' : 'IN PROGRESS'}
                  variant={inspection.gameStatus === 'finished' ? 'neutral' : 'success'}
                  size="sm"
                />
                <Caption style={{ color: colors.textMuted, marginLeft: 8 }}>
                  {formatTimestamp(inspection.savedAt)}
                </Caption>
              </View>
              <Text variant="xs" weight="700" style={{ color: colors.textSecondary }}>
                LOCAL MATCH
              </Text>
            </View>

            {/* Players summary */}
            <View style={styles.playersSummaryRow}>
              {inspection.activeSeats.map((seat) => (
                <View key={seat.color} style={styles.playerPill}>
                  <View
                    style={[
                      styles.colorDot,
                      { backgroundColor: getColorMeta(seat.color).hex },
                    ]}
                  />
                  <Text
                    variant="xs"
                    weight="600"
                    style={{ color: colors.text }}
                    numberOfLines={1}
                  >
                    {seat.displayName}
                  </Text>
                  {seat.status === 'bot' && (
                    <Text variant="xs" style={{ color: colors.textMuted, marginLeft: 2 }}>
                      (Bot)
                    </Text>
                  )}
                </View>
              ))}
            </View>

            {/* Current Turn or Finished Winner */}
            {inspection.gameStatus === 'playing' && inspection.currentTurn && (
              <View
                style={[
                  styles.turnInfoBox,
                  { backgroundColor: colors.surfaceRaised, borderRadius: radii.md },
                ]}
              >
                <Text variant="xs" style={{ color: colors.textMuted }}>
                  Current Turn:
                </Text>
                <View style={styles.turnPlayerRow}>
                  <View
                    style={[
                      styles.colorDotSmall,
                      { backgroundColor: getColorMeta(inspection.currentTurn).hex },
                    ]}
                  />
                  <Text variant="sm" weight="700" style={{ color: colors.text }}>
                    {getColorMeta(inspection.currentTurn).name} Player
                  </Text>
                </View>
              </View>
            )}

            {/* Action buttons */}
            <View style={[styles.savedActionButtons, { marginTop: spacing.md }]}>
              <PrimaryButton
                title={inspection.gameStatus === 'finished' ? 'View Result' : 'Resume Game'}
                loading={isActionPending}
                onPress={handleResumeGame}
                leftIcon={
                  <Ionicons
                    name={inspection.gameStatus === 'finished' ? 'trophy-outline' : 'play-outline'}
                    size={18}
                    color={colors.primaryText}
                  />
                }
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <SecondaryButton
                title="New Game"
                disabled={isActionPending}
                onPress={handleNewGamePress}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ) : inspection?.status === 'corrupted' ? (
          <Card
            style={[
              styles.corruptedCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
                borderRadius: radii.card,
              },
            ]}
          >
            <View style={styles.corruptedHeader}>
              <Ionicons name="alert-circle-outline" size={24} color={colors.error} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text variant="sm" weight="700" style={{ color: colors.error }}>
                  Saved game can't be resumed
                </Text>
                <Text variant="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
                  The saved Ludo game is damaged or from an unsupported version.
                </Text>
              </View>
            </View>

            <View style={[styles.savedActionButtons, { marginTop: spacing.md }]}>
              <Button
                title="Delete Saved Game"
                variant="danger"
                loading={isActionPending}
                onPress={handleDeleteCorrupted}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <SecondaryButton
                title="New Game"
                disabled={isActionPending}
                onPress={handleNewGamePress}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ) : (
          /* status === 'none' */
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleNewGamePress}
            accessibilityRole="button"
            accessibilityLabel="Start Offline Game"
          >
            <Card
              style={[
                styles.modeCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderStrong,
                  borderRadius: radii.card,
                },
              ]}
            >
              <View style={styles.cardContent}>
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
                  <Ionicons name="phone-portrait-outline" size={26} color={colors.text} />
                </View>
                <View style={styles.cardTextContainer}>
                  <Text variant="md" weight="700" style={{ color: colors.text }}>
                    Offline Play
                  </Text>
                  <Text variant="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
                    Play on this device • No internet needed
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
              </View>

              <View style={{ marginTop: spacing.md }}>
                <PrimaryButton
                  title="Start Offline Game"
                  onPress={handleNewGamePress}
                  leftIcon={<Ionicons name="add" size={20} color={colors.primaryText} />}
                />
              </View>
            </Card>
          </TouchableOpacity>
        )}
      </View>

      {/* Online Multiplayer (Coming Soon) */}
      <View>
        <Card
          style={[
            styles.disabledModeCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderSubtle,
              borderRadius: radii.card,
              opacity: 0.65,
            },
          ]}
        >
          <View style={styles.cardContent}>
            <View
              style={[
                styles.iconBox,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.borderSubtle,
                  borderRadius: radii.md,
                },
              ]}
            >
              <Ionicons name="globe-outline" size={26} color={colors.textMuted} />
            </View>
            <View style={styles.cardTextContainer}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="md" weight="700" style={{ color: colors.textSecondary }}>
                  Online Multiplayer
                </Text>
              </View>
              <Text variant="xs" style={{ color: colors.textMuted, marginTop: 2 }}>
                Play online with classmates across campus
              </Text>
            </View>
            <Badge label="Coming Soon" variant="neutral" size="sm" />
          </View>
        </Card>
      </View>
    </ScrollView>
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
    paddingTop: 4,
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
  loadingCard: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  savedCard: {
    padding: 18,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  savedCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  savedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playersSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  playerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  colorDotSmall: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  turnInfoBox: {
    padding: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  turnPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  savedActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  corruptedCard: {
    padding: 16,
    borderWidth: 1.5,
  },
  corruptedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modeCard: {
    padding: 16,
    borderWidth: 1.5,
  },
  disabledModeCard: {
    padding: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
});
